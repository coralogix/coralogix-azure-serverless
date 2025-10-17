/**
 * Azure Function for integration of Event Hub with Coralogix using OpenTelemetry
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     1.1.0
 * @since       1.0.0
 */

import { InvocationContext } from "@azure/functions";
import * as logsAPI from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';

const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'eventhub-to-otel',
    'cx.application.name': process.env.CORALOGIX_APPLICATION || "NO_APPLICATION",
    'cx.subsystem.name': process.env.CORALOGIX_SUBSYSTEM || "NO_SUBSYSTEM"
});

const loggerProvider = new LoggerProvider({
    resource: resource
});

const otlpExporter = new OTLPLogExporter({
    headers: {
        'Authorization': `Bearer ${process.env.CORALOGIX_PRIVATE_KEY}`
    }
});

loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(otlpExporter, {
        maxExportBatchSize: 512,
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 30000,
    })
);

logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
const logger = logsAPI.logs.getLogger('azure-eventhub-logs');

/**
 * @description Function entrypoint
 * @param {object} context - Function context
 * @param {array} eventHubMessages - event hub messages
 */
const eventHubTrigger = async function (context: InvocationContext, events: any): Promise<void> {
    context.log(`eventHub trigger function named: ${context.functionName}`);
    if ((!Array.isArray(events)) || (events.length === 0)) {
        return;
      }
    
    const threadId: string = context.functionName;

    // Parsing the event bulk, assuming we work with "many" as the cardinality attribute
    events.forEach((message) => {
        context.log(`Processed message: ${JSON.stringify(message)}`);
        // FIXME: bindingData access needs to be updated for Azure Functions v4
        // context.log(`EnqueuedTimeUtc = ${context.bindingData.enqueuedTimeUtcArray[index]}`);
        // context.log(`SequenceNumber = ${context.bindingData.sequenceNumberArray[index]}`);
        // context.log(`Offset = ${context.bindingData.offsetArray[index]}`);
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

    // Add delay before force flush to allow batch to accumulate
    context.log('Waiting for batch accumulation...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    context.log('Starting force flush...');
    await loggerProvider.forceFlush();
    context.log('Force flush completed');

    context.log('Successfully processed and exported all logs');
};

const writeLog = function(text: any, thread: any, logger: any): void {
    if (text == null) {
        return;
    }
    const body = JSON.stringify(text);
    logger.emit({
        severityNumber: logsAPI.SeverityNumber.INFO,
        severityText: 'INFO',
        body: body,
        attributes: {
            'log.type': 'EventHubLogRecord',
            'threadId': thread
        }
    });
};

export default eventHubTrigger;