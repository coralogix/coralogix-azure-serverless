import { gunzipSync } from "zlib";

import { InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";

import * as logsAPI from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

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
        maxExportBatchSize: 512,
        scheduledDelayMillis: 1000,
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
    let hasErrors = false;

    // Process each message from the Event Hub
    for (const message of eventHubMessages) {
        // Parse the message if it's a string
        const parsedEvents = typeof message === 'string' ? JSON.parse(message) : message;

        // Validate that parsedEvents is an array and has at least one element
        if (!Array.isArray(parsedEvents) || parsedEvents.length === 0) {
            context.log('Skipping message - not a valid array of events');
            return;
        }

        // Validate that the first element has an eventType and is a BlobCreated event
        if (!parsedEvents[0].eventType || parsedEvents[0].eventType !== "Microsoft.Storage.BlobCreated") {
            context.log('Skipping message - event type is not BlobCreated');
            return;
        }

        // Handle each event in the array
        for (const event of parsedEvents) {
            const blobURL = event.data.url;
            // Parse both container and blob path from the URL
            const urlParts = new URL(blobURL);
            const pathSegments = urlParts.pathname.split('/');
            const containerName = pathSegments[1]; // First segment after the leading slash
            const blobPath = pathSegments.slice(2).join('/'); // Everything after the container name

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
            let processedLines = 0;
            let failedLines = 0;

            for (const line of lines) {
                if (!line.trim()) continue; // Skip empty lines

                try {
                    logger.emit({
                        severityNumber: logsAPI.SeverityNumber.INFO,
                        severityText: 'INFO',
                        body: line,
                        attributes: {
                            'log.type': 'BlobLogRecord',
                            'blob.container': containerName,
                            'blob.path': blobPath,
                            'blob.storage.account': event.topic.split('/').pop(),
                            'blob.size': event.data.contentLength
                        }
                    });
                    processedLines++;
                } catch (lineError) {
                    failedLines++;
                    hasErrors = true;
                    context.log(`Error processing line from ${blobPath}: ${lineError}`);
                }
            }

            context.log(`Processed ${processedLines} lines, failed ${failedLines} lines from ${blobPath}`);
        }
    }

    try {
        await loggerProvider.forceFlush();
        await loggerProvider.shutdown();
        context.log('Successfully processed and exported all logs');
    } catch (shutdownError) {
        context.log('Error during logger shutdown:', shutdownError);
        throw shutdownError;
    }

    if (hasErrors) {
        context.log('Function completed with some errors');
    }
};

export { eventHubTrigger as default };
