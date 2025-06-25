import { AzureFunction, Context } from "@azure/functions";
import { gunzipSync } from "zlib";
import { Log, Severity, CoralogixLogger, LoggerConfig } from "coralogix-logger";

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
function debugLog(context: Context, message: string, data?: any): void {
    const isDebugMode = process.env.DEBUG_MODE === "true";
    if (isDebugMode) {
        if (data !== undefined) {
            context.log.warn(`[DEBUG] ${message}`, data);
        } else {
            context.log.warn(`[DEBUG] ${message}`);
        }
    }
}

const eventGridTrigger: AzureFunction = async function (context: Context, eventGridEvent: any, myBlob: any): Promise<void> {
    
    const blobURL = context.bindingData.data.url;
    const blobName = blobURL.slice(blobURL.lastIndexOf("/")+1);
    const isDebugMode = process.env.DEBUG_MODE === "true";
    
    context.log("Processing:", blobName);
    debugLog(context, "Blob URL:", blobURL);
    debugLog(context, "Debug mode enabled");
    debugLog(context, "myBlob type:", typeof myBlob);
    debugLog(context, "myBlob is null/undefined:", myBlob == null);
    
    // Debug: log the event grid event structure
    debugLog(context, "EventGrid event data:", JSON.stringify(eventGridEvent, null, 2));

    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    }));

    const newlinePattern: RegExp = process.env.NEWLINE_PATTERN ? RegExp(process.env.NEWLINE_PATTERN) : /(?:\r\n|\r|\n)/g;
    const logger: CoralogixLogger = new CoralogixLogger("blob");
    
    try {
        // Check if myBlob is defined
        if (myBlob == null || myBlob === undefined) {
            const errorMsg = `myBlob is ${myBlob} for blob: ${blobName}. This could indicate a binding issue with the blob input.`;
            context.log.error(errorMsg);
            
            logger.addLog(new Log({
                severity: Severity.error,
                text: errorMsg,
                threadId: blobName
            }));
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
                context.log.error(errorMsg);
                logger.addLog(new Log({
                    severity: Severity.error,
                    text: errorMsg,
                    threadId: blobName
                }));
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
            context.log.error(errorMsg);
            logger.addLog(new Log({
                severity: Severity.error,
                text: errorMsg,
                threadId: blobName
            }));
            return;
        }
        
        debugLog(context, "Blob text length:", blobText.length);
        
        const records = blobText.split(newlinePattern);
        debugLog(context, "Number of records found:", records.length);
        
        // Debug: Show sample records
        if (isDebugMode && records.length > 0) {
            debugLog(context, `Sample records (first 3):`);
            for (let i = 0; i < Math.min(3, records.length); i++) {
                if (records[i] && records[i].trim()) {
                    debugLog(context, `  Record ${i + 1}: "${records[i].substring(0, 100)}${records[i].length > 100 ? '...' : ''}"`);
                }
            }
        }
        
        let processedCount = 0;
        records.forEach((record: string) => {
            if (record && record.trim()) {
                logger.addLog(new Log({
                    severity: Severity.info,
                    text: record,
                    threadId: blobName
                }));
                processedCount++;
            }
        });
        
        debugLog(context, `Processed ${processedCount} non-empty records`);
        
    } catch (error) {
        context.log.error(`Error during processing of ${blobName}: ${error}`);
        debugLog(context, "Full error details:", error);
        
        try {
            logger.addLog(new Log({
                severity: Severity.error,
                text: "Azure blob log collector failed during process of log file:" + error,
                threadId: blobName
            }));
        } catch (coralogix_error) {
            context.log.error("Error during sending exception to Coralogix:", coralogix_error);
        }
    }
    
    context.log("Finished processing of:", blobName);
    CoralogixLogger.flush();
};

export default eventGridTrigger;
