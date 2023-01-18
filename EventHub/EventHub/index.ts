/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     1.1.1
 * @since       1.0.0
 */

import { AzureFunction, Context } from "@azure/functions";
import { Log, Severity, CoralogixLogger, LoggerConfig } from "coralogix-logger";

/**
 * @description Function entrypoint
 * @param {object} context - Function context
 * @param {array} eventHubMessages - event hub messages
 */
const eventHubTrigger: AzureFunction = function (context: Context, events: any): void {
    context.log(`eventHub trigger function named: ${context.executionContext.functionName}`);
    if ((!Array.isArray(events)) || (events.length === 0)) { 
        return;
      }
    //Setting up the Coralogix Logger
    const config = new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    });
    CoralogixLogger.configure(config);
    const logger: CoralogixLogger = new CoralogixLogger("evhub");
    const threadId: string = context.executionContext.functionName;

    //Parsing the event bulk, assuming we work with "many" as the cardinality attribute
    events.forEach((message, index) => {
        context.log(`Processed message: ${JSON.stringify(message)}`);
        context.log(`EnqueuedTimeUtc = ${context.bindingData.enqueuedTimeUtcArray[index]}`);
        context.log(`SequenceNumber = ${context.bindingData.sequenceNumberArray[index]}`);
        context.log(`Offset = ${context.bindingData.offsetArray[index]}`);
        if ('records' in message) {
            if (Array.isArray(message.records)) {
                message.records.forEach((inner_record) => {
                    writeLog(inner_record, threadId, logger);
                    }
                )
            }

        }
        else {
            writeLog(message, threadId, logger);    
        }
        
    });

    //Making sure the logger buffer is clean
    CoralogixLogger.flush();
    context.done();
};

const writeLog = function(text: any, thread: any, logger: CoralogixLogger): void {
    if (text == null) {
        return;
    }
    const body = JSON.stringify(text);
    logger.addLog(new Log({
        severity: Severity.info,
        text: body,
        threadId: text
    }));
};

export default eventHubTrigger;
