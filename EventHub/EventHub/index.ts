/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     1.0.0
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

    if (events.length === 0) {
        return;
      }

    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    }));

    const logger: CoralogixLogger = new CoralogixLogger("eventhub");

    events.forEach((record) => {
        record.records.forEach((inner) => {
            const body = JSON.stringify(inner);

            logger.addLog(new Log({
                severity: Severity.info,
                text: body,
                threadId: context.executionContext.functionName
            }));
        });
    });

    CoralogixLogger.flush();
    context.done();
};

export default eventHubTrigger;
