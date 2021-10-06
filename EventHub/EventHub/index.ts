/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     1.1.0
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
    context.log(`eventHub trigger function named: ${context.executionContext.functionName} version 1.1.0`);

    if ((!Array.isArray(events)) || (events.length === 0)) {
        return;
      }

    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    }));

    const logger: CoralogixLogger = new CoralogixLogger("eventhub");
    const threadId: string = context.executionContext.functionName;

    events.forEach((record) => {
        if (record == null) {
            return;
        }

        if (Array.isArray(record)) {
            record.forEach((inner) => {
                writeLog(inner, threadId, logger);
            });
        }
        else if (Array.isArray(record.records)) {
            record.records.forEach((inner) => {
                writeLog(inner, threadId, logger);
            });
        }
    });

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
