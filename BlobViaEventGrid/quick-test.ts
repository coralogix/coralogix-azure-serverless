import { Log, Severity, CoralogixLogger, LoggerConfig } from "coralogix-logger";

// Helper function (same as in main implementation)
function createLogText(message: string, blobName?: string, blobURL?: string): string {
    const enableBlobMetadata = process.env.ENABLE_BLOB_METADATA === "true";
    
    if (enableBlobMetadata && blobName && blobURL) {
        return JSON.stringify({
            body: message,
            attributes: {
                'blob.name': blobName,
                'blob.url': blobURL
            }
        });
    }
    
    return message;
}

async function quickTest(): Promise<void> {
    console.log("🧪 Testing OTLP-like Structure\n");

    // Configure Coralogix
    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY || "test-key",
        applicationName: "OTLP_TEST",
        subsystemName: "STRUCTURE_TEST"
    }));

    const logger = new CoralogixLogger("otlp-test");
    const testMessage = "User authentication successful";
    const blobName = "auth.log";
    const blobURL = "https://storage.blob.core.windows.net/logs/auth.log";

    console.log("📋 Test 1: Default (metadata DISABLED)");
    delete process.env.ENABLE_BLOB_METADATA;
    const plainLog = createLogText(testMessage, blobName, blobURL);
    console.log(`✅ Output: ${plainLog}\n`);

    console.log("📋 Test 2: Enhanced (metadata ENABLED)");
    process.env.ENABLE_BLOB_METADATA = "true";
    const enhancedLog = createLogText(testMessage, blobName, blobURL);
    console.log(`✅ Output: ${enhancedLog}\n`);

    // Send to Coralogix
    logger.addLog(new Log({
        severity: Severity.info,
        text: plainLog,
        threadId: "plain-test"
    }));

    logger.addLog(new Log({
        severity: Severity.info,
        text: enhancedLog,
        threadId: "enhanced-test"
    }));

    console.log("🚀 Sending to Coralogix...");
    CoralogixLogger.flush();
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log("✅ Check your Coralogix dashboard!");
}

if (require.main === module) {
    quickTest().catch(console.error);
}
