/**
 * Azure Function for integration of Blob Storage with Coralogix
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
 * @param {string} blob - Function input blob
 */

const blobStorageTrigger: AzureFunction = function (context: Context, blob: any): void {
    context.log("Processing:", context.bindingData.name);
    context.log("Blob Size:", blob.length, "Bytes")
    CoralogixLogger.configure(new LoggerConfig({
        privateKey: process.env.CORALOGIX_PRIVATE_KEY,
        applicationName: process.env.CORALOGIX_APP_NAME || "NO_APPLICATION",
        subsystemName: process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    }));

    const newlinePattern: RegExp = process.env.NEWLINE_PATTERN ? RegExp(process.env.NEWLINE_PATTERN) : /(?:\r\n|\r|\n)/g;
    const logger: CoralogixLogger = new CoralogixLogger("blob");
    try {
        context.bindings.blob.toString().split(newlinePattern).forEach((record: string) => {
            if (record) {
                logger.addLog(new Log({
                    severity: Severity.info,
                    text: record,
                    threadId: context.bindingData.name
                }));
            }
        });
    } catch(error) {
        context.log.error("Error during proccessing of: ",context.bindingData.name)
        context.log.error("Error during proccessing of: ", error)
        try{
            logger.addLog(new Log({
                    severity: Severity.error,
                    text: "Azure blob log collector failed during process of log file:" + error,
                    threadId: context.bindingData.name
                }));
        }catch(coralogix_error){
            context.log.error("Error during sending exception to Coralogix:", coralogix_error)
        }
        
    }

    CoralogixLogger.flush();
    context.log("finished processing of:",context.bindingData.name);
    context.done();
};

export default blobStorageTrigger;
