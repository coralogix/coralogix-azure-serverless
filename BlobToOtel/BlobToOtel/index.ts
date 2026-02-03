import { InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";

import * as logsAPI from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { gunzipSync } from "zlib";

// Init OTLP exporter
const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'blob-to-otel',
    'cx.application.name': process.env.CORALOGIX_APPLICATION || "NO_APPLICATION",
    'cx.subsystem.name': process.env.CORALOGIX_SUBSYSTEM || "NO_SUBSYSTEM"
});

const loggerProvider = new LoggerProvider({
    resource: resource
});

const isDirectMode = process.env.CORALOGIX_DIRECT_MODE?.toLowerCase() === 'true';
if (isDirectMode && !process.env.CORALOGIX_API_KEY) {
    throw new Error('CORALOGIX_API_KEY is required when CORALOGIX_DIRECT_MODE is true');
}

const otlpExporter = new OTLPLogExporter({
    ...(isDirectMode && {
        headers: {
            'Authorization': `Bearer ${process.env.CORALOGIX_API_KEY}`
        }
    })
});

loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(otlpExporter, {
        maxExportBatchSize: 1000,
        scheduledDelayMillis: 2000,
        exportTimeoutMillis: 60000,
        maxQueueSize: 100000,
    })
);

logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
const logger = logsAPI.logs.getLogger('azure-blob-logs');

// Set global variables

const newlinePattern: RegExp = process.env.NEWLINE_PATTERN ? new RegExp(process.env.NEWLINE_PATTERN.replace(/\\n/g, '\n').replace(/\\r/g, '\r')) : /(?:\r\n|\r|\n)/g;
const prefixFilter = process.env.PREFIX_FILTER;
const suffixFilter = process.env.SUFFIX_FILTER;
const prefixCheck = prefixFilter && prefixFilter !== 'NoFilter';
const suffixCheck = suffixFilter && suffixFilter !== 'NoFilter';

const eventHubTrigger = async function (context: InvocationContext, eventHubMessages: any[]): Promise<void> {
    const executionStartTime = Date.now();
    context.log(`Function execution started at ${new Date().toISOString()}`);
    
    try {
        let hasErrors = false;
        let totalProcessedLines = 0;
        let totalBatches = 0;
        let totalFlushes = 0;
        const processedBlobs: string[] = [];

        for (const message of eventHubMessages) {
            const parsedEvents = typeof message === 'string' ? JSON.parse(message) : message;

            if (!Array.isArray(parsedEvents)) {
                context.log('Skipping - this event has an invalid format:', message);
                continue;
            }

            for (const event of parsedEvents) {
                const blobURL = event.data.url;
                // Parse both container and blob path from the URL
                const urlParts = new URL(blobURL);
                const pathSegments = urlParts.pathname.split('/');
                const containerName = pathSegments[1];
                const blobPath = pathSegments.slice(2).join('/');

                if (prefixCheck && !blobPath.startsWith(prefixFilter)) {
                    context.log(`Skipping ${blobPath} - does not match prefix filter ${prefixFilter}`);
                    continue;
                }

                if (suffixCheck && !blobPath.endsWith(suffixFilter)) {
                    context.log(`Skipping ${blobPath} - does not match suffix filter ${suffixFilter}`);
                    continue;
                }

                context.log("Container:", containerName);
                context.log("Blob path:", blobPath);
                
                processedBlobs.push(`${containerName}/${blobPath}`);

                // Use the storage account connection string directly
                const storageConnectionString = process.env.BLOB_STORAGE_ACCOUNT_CONNECTION_STRING;
                const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
                const containerClient = blobServiceClient.getContainerClient(containerName);
                const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

                let blobData = await blockBlobClient.downloadToBuffer();
                if (blobPath.endsWith(".gz")) {
                    blobData = gunzipSync(blobData);
                }

                // Split blob content into lines and emit each line as a log record
                const lines = blobData.toString().split(newlinePattern);
                const totalRecords = lines.length;
                let processedLines = 0;
                let failedLines = 0;

                context.log(`Processing ${totalRecords} records from ${blobPath}`);

                // Process records in batches to avoid hitting OpenTelemetry limits
                const batchSize = 1000;
                const flushEveryNBatches = 2; // Flush every 2 batches for ~10k logs/sec

                for (let i = 0; i < totalRecords; i += batchSize) {
                    const batchEnd = Math.min(i + batchSize, totalRecords);
                    const batch = lines.slice(i, batchEnd);
                    const batchNumber = Math.floor(i/batchSize) + 1;
                    totalBatches++;

                    // Process current batch
                    for (let j = 0; j < batch.length; j++) {
                        const line = batch[j];
                        if (!line || !line.trim()) continue; // Skip empty lines

                        try {
                            const storageAccountName = event.topic ? event.topic.split('/').pop() : urlParts.hostname.split('.')[0];
                            const attributes: any = {
                                'log.type': 'BlobLogRecord',
                                'blob.container': containerName,
                                'blob.path': blobPath,
                                'blob.storage.account': storageAccountName
                            };
                            
                            if (event.data?.contentLength) {
                                attributes['blob.size'] = event.data.contentLength;
                            }
                            
                            logger.emit({
                                severityNumber: logsAPI.SeverityNumber.INFO,
                                severityText: 'INFO',
                                body: line,
                                attributes
                            });
                            processedLines++;
                        } catch (lineError) {
                            failedLines++;
                            hasErrors = true;
                            context.log(`Error emitting log at position ${i + j + 1}: ${lineError}`);
                        }
                    }

                    // Flush every N batches or on the last batch
                    const isLastBatch = batchEnd >= totalRecords;
                    const shouldFlush = (batchNumber % flushEveryNBatches === 0) || isLastBatch;

                    if (shouldFlush) {
                        try {
                            if (batchNumber % 100 === 0 || batchNumber === 1 || isLastBatch) {
                                context.log(`Processing batch ${batchNumber}/${Math.ceil(totalRecords / batchSize)} (${processedLines} logs processed)...`);
                            }
                            await loggerProvider.forceFlush();
                            totalFlushes++;
                        } catch (flushError) {
                            context.log(`Error flushing at batch ${batchNumber}: ${flushError}`);
                        }
                    }
                }

                totalProcessedLines += processedLines;
                
                const blobProcessingTime = Date.now() - executionStartTime;
                context.log(`Blob summary: ${processedLines}/${totalRecords} records processed, ${failedLines} failed, ${totalBatches} batches, ${totalFlushes} flushes, ${(blobProcessingTime / 1000).toFixed(2)}s`);
            }
        }

        // Final flush with longer wait to ensure queue drains
        context.log(`Flushing ${totalProcessedLines.toLocaleString()} logs to Coralogix...`);
        await loggerProvider.forceFlush();
        
        // Wait for queue to drain (1 second per 1000 logs, max 60s)
        const estimatedWait = Math.min(Math.ceil(totalProcessedLines / 1000), 60);
        if (estimatedWait > 1) {
            context.log(`Waiting ${estimatedWait}s for queue to drain...`);
            await new Promise(resolve => setTimeout(resolve, estimatedWait * 1000));
            await loggerProvider.forceFlush(); // Second flush
        }
        
        context.log(`All logs successfully sent to Coralogix`);

        try {
            // Success - continue to summary
        } catch (flushError) {
            context.log(`Final flush failed: ${flushError}`);

            try {
                logger.emit({
                    severityNumber: logsAPI.SeverityNumber.ERROR,
                    severityText: 'ERROR',
                    body: `Final flush failed: ${flushError}`,
                });
                await loggerProvider.forceFlush();
                context.log("Error log successfully sent to Coralogix");
            } catch (finalError) {
                context.log("Failed to send final error log to Coralogix:", finalError);
            }
        }

        const totalExecutionTime = Date.now() - executionStartTime;
        
        context.log('========================================');
        context.log('Execution Summary');
        context.log('========================================');
        context.log(`Blobs processed: ${processedBlobs.length}`);
        for (const blob of processedBlobs) {
            context.log(`  - ${blob}`);
        }
        context.log(`Total logs processed: ${totalProcessedLines.toLocaleString()}`);
        context.log(`Total batches: ${totalBatches.toLocaleString()}`);
        context.log(`Total flushes: ${totalFlushes + 1} (${totalFlushes} during processing + 1 final)`);
        context.log(`Execution time: ${(totalExecutionTime / 1000).toFixed(2)}s (${(totalExecutionTime / 60000).toFixed(2)} minutes)`);
        context.log(`Throughput: ${Math.round(totalProcessedLines / (totalExecutionTime / 1000)).toLocaleString()} logs/second`);
        context.log('========================================');

        if (hasErrors) {
            context.log('Function completed with some errors');
        }
    } catch (error) {
        const totalExecutionTime = Date.now() - executionStartTime;
        context.log(`Error processing messages after ${(totalExecutionTime / 1000).toFixed(2)}s:`, error);
        return;
    }
};

export { eventHubTrigger as default };
