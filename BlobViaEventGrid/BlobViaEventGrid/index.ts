import { InvocationContext } from "@azure/functions";
import { gunzipSync } from "zlib";
import * as logsAPI from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

// Helper function to test if data is valid UTF-8
function isValidUTF8(buffer: Buffer): boolean {
    try {
        buffer.toString('utf8');
        return true;
    } catch {
        return false;
    }
}

// Helper function to detect probable encoding
function detectEncoding(buffer: Buffer): string {
    // Check for BOM markers
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return "UTF-8 with BOM";
    }
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return "UTF-16 LE";
    }
    if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
        return "UTF-16 BE";
    }
    
    // Test for UTF-8 validity
    if (isValidUTF8(buffer)) {
        return "UTF-8";
    }
    
    // Check if it's ASCII (subset of UTF-8)
    let isAscii = true;
    for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
        if (buffer[i] > 127) {
            isAscii = false;
            break;
        }
    }
    if (isAscii) {
        return "ASCII";
    }
    
    return "Binary/Unknown";
}

// Helper function for debug logging
function debugLog(context: InvocationContext, message: string, data?: any): void {
    const isDebugMode = process.env.DEBUG_MODE === "true";
    if (isDebugMode) {
        if (data !== undefined) {
            context.log(`[DEBUG] ${message}`, data);
        } else {
            context.log(`[DEBUG] ${message}`);
        }
    }
}

// Helper function to create enhanced log text with blob metadata (when enabled)
// Set ENABLE_BLOB_METADATA=true to include blob name and path in logs
function createLogText(message: string, blobName?: string, blobURL?: string): string {
    const enableBlobMetadata = process.env.ENABLE_BLOB_METADATA === "true";
    
    if (enableBlobMetadata && blobName && blobURL) {
        return JSON.stringify({
            message: message,
            blob_name: blobName,
            blob_url: blobURL,
        });
    }
    
    return message;
}

// Initialize OpenTelemetry logger
const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'blob-via-eventgrid',
    'cx.application.name': process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
    'cx.subsystem.name': process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
});

const loggerProvider = new LoggerProvider({
    resource: resource
});

const otlpExporter = new OTLPLogExporter({
    ...({
        headers: {
            'Authorization': `Bearer ${process.env.CORALOGIX_PRIVATE_KEY}`
        }
    })
});

loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(otlpExporter, {
        maxExportBatchSize: 1000,
        scheduledDelayMillis: 2000,
        exportTimeoutMillis: 60000,
    })
);

logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
const logger = logsAPI.logs.getLogger('azure-blob-logs');

const eventGridTrigger = async function (context: InvocationContext, eventGridEvent: any, myBlob: any): Promise<void> {
    
    const blobURL = eventGridEvent.data?.url;
    if (!blobURL) {
        context.error("No blob URL found in event data");
        return;
    }

    const blobName = blobURL.slice(blobURL.lastIndexOf("/") + 1);
    const isDebugMode = process.env.DEBUG_MODE === "true";
    
    context.log("Processing:", blobName);
    debugLog(context, "Blob URL:", blobURL);
    debugLog(context, "Debug mode enabled");
    debugLog(context, "myBlob type:", typeof myBlob);
    debugLog(context, "myBlob is null/undefined:", myBlob == null);
    
    // Debug: log the event grid event structure
    debugLog(context, "EventGrid event data:", JSON.stringify(eventGridEvent, null, 2));

    const newlinePattern: RegExp = process.env.NEWLINE_PATTERN ? RegExp(process.env.NEWLINE_PATTERN) : /(?:\r\n|\r|\n)/g;
    
    let totalRecords = 0; // Track total records found
    let finalProcessedCount = 0; // Final count that won't be affected by logger state
    
    try {
        // Check if myBlob is defined
        if (myBlob == null || myBlob === undefined) {
            const errorMsg = `myBlob is ${myBlob} for blob: ${blobName}. This could indicate a binding issue with the blob input.`;
            context.error(errorMsg);
            
            logger.emit({
                severityNumber: logsAPI.SeverityNumber.ERROR,
                severityText: 'ERROR',
                body: createLogText(errorMsg, blobName, blobURL),
            });
            return;
        }

        let blobData = myBlob;
        
        // Debug: Analyze original blob data
        if (isDebugMode) {
            debugLog(context, `Original blob data analysis for ${blobName}:`);
            debugLog(context, `- Data type: ${typeof blobData}`);
            debugLog(context, `- Is Buffer: ${Buffer.isBuffer(blobData)}`);
            debugLog(context, `- Length/Size: ${blobData.length || 'N/A'}`);
            
            if (Buffer.isBuffer(blobData) || blobData instanceof Uint8Array) {
                const buffer = Buffer.isBuffer(blobData) ? blobData : Buffer.from(blobData);
                debugLog(context, `- Detected encoding: ${detectEncoding(buffer)}`);
                debugLog(context, `- First 100 bytes (hex): ${buffer.slice(0, 100).toString('hex')}`);
                
                // Try to show first few characters if it's text
                try {
                    const preview = buffer.slice(0, 200).toString('utf8').replace(/[\r\n]/g, '\\n');
                    debugLog(context, `- Text preview: "${preview}"`);
                } catch (previewError) {
                    debugLog(context, `- Cannot preview as text: ${previewError}`);
                }
            }
        }

        if (blobName.endsWith(".gz")) {
            try {
                debugLog(context, `Attempting to decompress gzipped blob: ${blobName}`);
                blobData = gunzipSync(blobData);
                debugLog(context, "Successfully decompressed gzipped blob");
                
                // Debug: Analyze decompressed data
                if (isDebugMode) {
                    debugLog(context, `Decompressed blob data analysis for ${blobName}:`);
                    debugLog(context, `- Decompressed data type: ${typeof blobData}`);
                    debugLog(context, `- Decompressed is Buffer: ${Buffer.isBuffer(blobData)}`);
                    debugLog(context, `- Decompressed length: ${blobData.length || 'N/A'}`);
                    
                    if (Buffer.isBuffer(blobData)) {
                        debugLog(context, `- Decompressed detected encoding: ${detectEncoding(blobData)}`);
                        debugLog(context, `- Decompressed is valid UTF-8: ${isValidUTF8(blobData)}`);
                        
                        try {
                            const preview = blobData.slice(0, 200).toString('utf8').replace(/[\r\n]/g, '\\n');
                            debugLog(context, `- Decompressed text preview: "${preview}"`);
                        } catch (previewError) {
                            debugLog(context, `- Cannot preview decompressed as text: ${previewError}`);
                        }
                    }
                }
            } catch (gzipError) {
                const errorMsg = `Failed to decompress gzipped blob ${blobName}: ${gzipError}`;
                context.error(errorMsg);
                logger.emit({
                    severityNumber: logsAPI.SeverityNumber.ERROR,
                    severityText: 'ERROR',
                    body: createLogText(errorMsg, blobName, blobURL),
                });
                return;
            }
        }

        // Convert to string with encoding analysis
        let blobText: string;
        try {
            if (Buffer.isBuffer(blobData)) {
                const encoding = detectEncoding(blobData);
                debugLog(context, `Converting buffer to string using detected encoding: ${encoding}`);
                
                // Use appropriate encoding
                if (encoding.includes("UTF-16")) {
                    blobText = blobData.toString('utf16le');
                } else {
                    blobText = blobData.toString('utf8');
                }
            } else {
                blobText = blobData.toString();
            }
            
            debugLog(context, `Successfully converted blob to string. Length: ${blobText.length}`);
        } catch (stringError) {
            const errorMsg = `Failed to convert blob data to string for ${blobName}: ${stringError}`;
            context.error(errorMsg);
            logger.emit({
                severityNumber: logsAPI.SeverityNumber.ERROR,
                severityText: 'ERROR',
                body: createLogText(errorMsg, blobName, blobURL),
            });
            return;
        }
        
        debugLog(context, "Blob text length:", blobText.length);
        
        const records = blobText.split(newlinePattern);
        totalRecords = records.length;
        
        context.log(`Processing ${totalRecords} records from ${blobName}`);
        
        // Process records in batches to avoid hitting OpenTelemetry limits
        const batchSize = 1000;
        let processedCount = 0;
        
        for (let i = 0; i < totalRecords; i += batchSize) {
            const batchEnd = Math.min(i + batchSize, totalRecords);
            const batch = records.slice(i, batchEnd);
            
            context.log(`Processing batch ${Math.floor(i/batchSize) + 1}: records ${i + 1}-${batchEnd}`);
            
            // Process current batch
            for (let j = 0; j < batch.length; j++) {
                const record = batch[j];
                if (record && record.trim()) {
                    try {
                        logger.emit({
                            severityNumber: logsAPI.SeverityNumber.INFO,
                            severityText: 'INFO',
                            body: createLogText(record, blobName, blobURL),
                        });
                        processedCount++;
                    } catch (logError) {
                        context.error(`Error emitting log at position ${i + j + 1}: ${logError}`);
                    }
                }
            }
            
            try {
                context.log(`Flushing batch ${Math.floor(i/batchSize) + 1}...`);
                await loggerProvider.forceFlush();
                context.log(`Batch ${Math.floor(i/batchSize) + 1} flushed successfully`);
            } catch (flushError) {
                context.error(`Error flushing batch ${Math.floor(i/batchSize) + 1}: ${flushError}`);
            }
        }
        
        finalProcessedCount = processedCount;
        
        context.log(`Processing summary: ${processedCount} out of ${totalRecords} records processed`);
        
    } catch (error) {
        context.error(`Error during processing of ${blobName}: ${error}`);
        debugLog(context, "Full error details:", error);
        
        try {
            logger.emit({
                severityNumber: logsAPI.SeverityNumber.ERROR,
                severityText: 'ERROR',
                body: createLogText("Azure blob log collector failed during process of log file:" + error, blobName, blobURL),
            });
        } catch (coralogix_error) {
            context.error("Error during sending exception to Coralogix:", coralogix_error);
        }
    }
    
    context.log("Finished processing of:", blobName);
    
    context.log(`Starting final flush process for ${finalProcessedCount} logs...`);
    const flushStartTime = Date.now();
    
    try {
        // Add a small delay before final flush
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        context.log('Starting final force flush...');
        await loggerProvider.forceFlush();
        const flushDuration = Date.now() - flushStartTime;
        context.log(`All ${finalProcessedCount} logs successfully sent to Coralogix in ${flushDuration}ms`);
        
    } catch (flushError) {
        const flushDuration = Date.now() - flushStartTime;
        context.error(`Final flush failed for ${blobName} after ${flushDuration}ms: ${flushError}`);
        
        try {
            logger.emit({
                severityNumber: logsAPI.SeverityNumber.ERROR,
                severityText: 'ERROR',
                body: createLogText(`Final flush failed after ${flushDuration}ms: ${flushError}`, blobName, blobURL),
            });
            await loggerProvider.forceFlush();
            context.log("Error log successfully sent to Coralogix");
        } catch (finalError) {
            context.error("Failed to send final error log to Coralogix:", finalError);
        }
    }
};

export { eventGridTrigger as default };
