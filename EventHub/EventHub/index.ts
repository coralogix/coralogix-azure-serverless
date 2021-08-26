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
 * @param {string} eventHubMessages - Function event hub messages
 */
const eventHubTrigger: AzureFunction = function (context: Context, eventHubMessages: any): void {
    context.log(`eventHub trigger function processing hub name: ${context.bindingData.eventHubName} with messages: ${eventHubMessages}`);

    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    }));

    const logger: CoralogixLogger = new CoralogixLogger("eventhub");

    eventHubMessages.forEach((record) => {
        const body = JSON.stringify(record);

        logger.addLog(new Log({
            severity: Severity.info,
            text: body,
            threadId: context.bindingData.name
        }));
    });

    CoralogixLogger.flush();
    context.done();
};

export default eventHubTrigger;
