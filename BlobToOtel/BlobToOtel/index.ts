import { AzureFunction, Context } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { gunzipSync } from "zlib";
import * as logsAPI from '@opentelemetry/api-logs';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

// Create a resource with your cx attributes
const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'blob-to-otel',
    'cx.application.name': 'cds-1933',
    'cx.subsystem.name': 'function'
});

// Initialize the Logger provider with resource
const loggerProvider = new LoggerProvider({
    resource: resource
});

// Configure OTLP exporter
const otlpExporter = new OTLPLogExporter({
    ...(process.env.CORALOGIX_API_KEY && {
        headers: {
            'Authorization': `Bearer ${process.env.CORALOGIX_API_KEY}`
        }
    })
});

loggerProvider.addLogRecordProcessor(
    new SimpleLogRecordProcessor(otlpExporter)
);

// Set global logger provider and get logger instance
logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
const logger = logsAPI.logs.getLogger('azure-blob-logs');

const eventHubTrigger: AzureFunction = async function (context: Context, eventHubMessages: any[]): Promise<void> {
    // Process each message from the Event Hub
    for (const message of eventHubMessages) {
        // Parse the message if it's a string
        const parsedEvents = typeof message === 'string' ? JSON.parse(message) : message;

        // Handle each event in the array
        for (const event of parsedEvents) {
            context.log(event);
            const blobURL = event.data.url;
            // Parse both container and blob path from the URL
            const urlParts = new URL(blobURL);
            const pathSegments = urlParts.pathname.split('/');
            const containerName = pathSegments[1]; // First segment after the leading slash
            const blobPath = pathSegments.slice(2).join('/'); // Everything after the container name

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
            const lines = blobData.toString().split(/\r?\n/);
            for (const line of lines) {
                if (line.trim()) { // Only process non-empty lines
                    context.log("line:", line);
                    logger.emit({
                        severityNumber: logsAPI.SeverityNumber.INFO,
                        severityText: 'INFO',
                        body: line,
                        attributes: {
                            'log.type': 'BlobLogRecord',
                            'blob.container': containerName,
                            'blob.path': blobPath
                        }
                    });
                }
            }

            context.log("Finished processing of:", blobPath);
        }
    }
    // After all processing is done, flush the logs
    await loggerProvider.forceFlush();
};

export { eventHubTrigger as default };
