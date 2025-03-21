import { AzureFunction, Context } from "@azure/functions";
import { gunzipSync } from "zlib";
import { Log, Severity, CoralogixLogger, LoggerConfig } from "coralogix-logger";

const eventGridTrigger: AzureFunction = async function (context: Context, eventGridEvent: any, myBlob: any): Promise<void> {
    
    const blobURL = context.bindingData.data.url;
    const blobName = blobURL.slice(blobURL.lastIndexOf("/")+1);
    context.log("Processing:", blobName);

    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    }));

    const newlinePattern: RegExp = process.env.NEWLINE_PATTERN ? RegExp(process.env.NEWLINE_PATTERN) : /(?:\r\n|\r|\n)/g;
    const logger: CoralogixLogger = new CoralogixLogger("blob");
    try {
        let blobData = myBlob;

        if (blobName.endsWith(".gz")) {
            blobData = gunzipSync(blobData);
        }

        blobData.toString().split(newlinePattern).forEach((record: string) => {
            if (record) {
                logger.addLog(new Log({
                    severity: Severity.info,
                    text: record,
                    threadId: blobName
                }));
            }
        });
    } catch (error) {
        context.log.error(`Error during proccessing of ${blobName}: ${error}`);
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
