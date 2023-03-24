import { AzureFunction, Context } from "@azure/functions"
import { Log, Severity, CoralogixLogger, LoggerConfig } from "coralogix-logger";


const queueTrigger: AzureFunction = async function (context: Context, queueItem: string): Promise<void> {
    context.log('Queue trigger function processing work item', queueItem);

    //Setting up the Coralogix Logger
    const config = new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSCRIPTION"
    });

    CoralogixLogger.configure(config);
    const logger: CoralogixLogger = new CoralogixLogger("storagequeue");
    const threadId: string = context.executionContext.functionName;

    //Adding queue item to logger
    try {
        logger.addLog(new Log({
            severity: Severity.info,
            text: JSON.stringify(queueItem),
            threadId: threadId
        }));

    } catch (error) {
        context.log.error("Error processing Storage Queue Item:", error);
    }

    try {
        CoralogixLogger.flush();
    } catch (error) {
        context.log.error("Error submitting Storage Queue Item to Coralogix:", error);
    }
};

export default queueTrigger;
