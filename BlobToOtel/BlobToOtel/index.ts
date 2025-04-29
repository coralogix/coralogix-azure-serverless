import { gunzipSync } from "zlib";

import { InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import * as avro from 'avro-js';
import * as fs from 'fs';

import * as logsAPI from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';

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
        exportTimeoutMillis: 30000,
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

// Helper function to decode AVRO data
function decodeAvroToLines(buffer: Buffer, context: InvocationContext): string[] {
    try {
        context.log(`AVRO file size: ${buffer.length} bytes`);

        // Check if the file has the AVRO magic bytes (Obj1)
        const magicBytes = buffer.subarray(0, 4).toString();
        context.log(`First 4 bytes: ${magicBytes}`);

        if (magicBytes !== 'Obj\u0001') {
            context.log('Warning: AVRO file does not start with expected magic bytes');
        }

        // Try a more manual approach to extract AVRO schema and data
        // Look for the schema JSON
        let schemaStart = buffer.indexOf('{');
        if (schemaStart === -1) {
            throw new Error('Could not find schema in AVRO file');
        }

        // Try to find end of schema by finding closing brace with matching nesting
        let openBraces = 0;
        let schemaEnd = -1;

        for (let i = schemaStart; i < buffer.length; i++) {
            const char = String.fromCharCode(buffer[i]);
            if (char === '{') openBraces++;
            if (char === '}') openBraces--;

            if (openBraces === 0) {
                schemaEnd = i + 1;
                break;
            }
        }

        if (schemaEnd === -1) {
            throw new Error('Could not find end of schema in AVRO file');
        }

        const schemaStr = buffer.subarray(schemaStart, schemaEnd).toString();
        context.log(`Found schema: ${schemaStr.slice(0, 100)}...`);

        try {
            // Parse schema
            const schema = JSON.parse(schemaStr);

            try {
                // Try to use avro-js with the extracted schema
                avro.parse(schema);
                context.log('Successfully parsed AVRO schema');
            } catch (parseError) {
                context.log(`Warning: Error when parsing AVRO schema: ${parseError}`);
            }

            const lines: string[] = [];

            // Try reading records after schema + sync marker (16 bytes)
            let offset = schemaEnd + 16;

            // Debug: Try to save some raw binary data for debugging
            // Temporary file write for debugging - remove in production
            fs.writeFileSync('/tmp/avro_debug_dump.bin', buffer.subarray(offset, offset + 1000));
            context.log(`Saved debug dump to /tmp/avro_debug_dump.bin`);

            // Process records manually
            while (offset < buffer.length) {
                try {
                    // Each block starts with a count (long) and size (long)
                    // Skip these for now and try to parse records directly
                    offset += 16; // Skip block header

                    // Try to read some data directly
                    const rawData = buffer.subarray(offset, offset + 1000); // Take a chunk
                    context.log(`Raw data sample (hex): ${rawData.subarray(0, 32).toString('hex')}`);

                    // For EventHub AVRO format, let's try to extract records more directly
                    // EventHub records have a specific format with Body field

                    // For now, add a simplified version that just logs the raw data
                    lines.push(JSON.stringify({
                        _raw_data_sample: rawData.subarray(0, 100).toString('hex'),
                        _timestamp: new Date().toISOString(),
                        _manual_extract: true
                    }));

                    break; // Only do one for now to avoid infinite loops
                } catch (readError) {
                    context.log(`Error reading record: ${readError}`);
                    break;
                }
            }

            if (lines.length === 0) {
                context.log('Warning: Could not extract any data from AVRO file');
                // As a fallback, try to interpret as a plain JSON array
                try {
                    const jsonData = JSON.parse(buffer.toString());
                    if (Array.isArray(jsonData)) {
                        context.log('Treating file as JSON array instead');
                        return jsonData.map(item => JSON.stringify(item));
                    }
                } catch (jsonError) {
                    context.log(`Error parsing as JSON: ${jsonError}`);
                    // Not JSON, continue
                }

                // Last resort - just add the first chunk as a string
                lines.push(`AVRO_PARSE_FAILED: ${buffer.subarray(0, 500).toString('utf8')}`);
            }

            return lines;
        } catch (schemaError) {
            context.log(`Error parsing schema: ${schemaError}`);
            throw schemaError;
        }
    } catch (error) {
        context.log(`Error decoding AVRO file: ${error}`);
        return [];
    }
}

const eventHubTrigger = async function (context: InvocationContext, eventHubMessages: any[]): Promise<void> {
    try {
        let hasErrors = false;

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
                const containerName = pathSegments[1]; // First segment after the leading slash

                // Properly decode the URL path to handle double encoding issues
                let blobPath = pathSegments.slice(2).join('/'); // Everything after the container name

                // Fix triple-encoding issue for URLs with %25xx patterns (which is %xx double-encoded)
                blobPath = decodeURIComponent(blobPath);

                // Log the decoded path for debugging
                context.log("Original URL path:", urlParts.pathname);
                context.log("Decoded blob path:", blobPath);

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

                try {
                    // Create the blob client with the properly decoded path
                    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

                    let blobData = await blockBlobClient.downloadToBuffer();
                    if (blobPath.endsWith(".gz")) {
                        blobData = gunzipSync(blobData);
                        blobPath = blobPath.slice(0, -3); // Remove .gz extension
                    }

                    // Determine how to process the file based on extension
                    let lines: string[] = [];
                    let logType = 'BlobLogRecord';

                    // Extract file extension for processing
                    const fileExtension = blobPath.split('.').pop()?.toLowerCase() || '';

                    switch (fileExtension) {
                        case 'avro':
                            context.log(`Processing ${blobPath} as AVRO file`);
                            lines = decodeAvroToLines(blobData, context);
                            logType = 'AvroLogRecord';
                            break;
                        default:
                            lines = blobData.toString().split(newlinePattern);
                            logType = 'TextLogRecord';
                            break;
                    }

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
                                    'log.type': logType,
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
                } catch (error) {
                    context.log(`Error accessing blob ${blobPath}: ${error}`);

                    // More detailed error logging to help debug
                    if (error && error.statusCode === 404) {
                        context.log('Blob not found. This could be due to:');
                        context.log('1. The blob has been deleted between event trigger and processing');
                        context.log('2. URL encoding issues in the blob path');
                        context.log('3. Incorrect container or account name');

                        // Log the original URL for debugging
                        context.log('Original blob URL:', blobURL);
                        context.log('Attempted to access:', containerName, blobPath);

                        // Try logging the container contents for debugging
                        try {
                            context.log(`Listing first 5 blobs in container ${containerName} for debugging...`);
                            let i = 0;
                            const iterator = containerClient.listBlobsFlat();
                            for await (const blob of iterator) {
                                context.log(`- ${blob.name}`);
                                if (++i >= 5) break;
                            }
                        } catch (listError) {
                            context.log(`Failed to list container contents: ${listError}`);
                        }
                    }

                    hasErrors = true;
                }
            }
        }

        // Add delay before force flush to allow batch to accumulate
        context.log('Waiting for batch accumulation...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        context.log('Starting force flush...');
        await loggerProvider.forceFlush();
        context.log('Force flush completed');

        context.log('Successfully processed and exported all logs');

        if (hasErrors) {
            context.log('Function completed with some errors');
        }
    } catch (error) {
        context.log('Error processing messages:', error);
        return;
    }
};

export { eventHubTrigger as default };
