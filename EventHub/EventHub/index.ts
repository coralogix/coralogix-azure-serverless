/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     3.0.0
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

// TODO: Add support for direct mode
const otlpExporter = new OTLPLogExporter();

loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(otlpExporter, {
        maxExportBatchSize: 512,
        scheduledDelayMillis: 1000, // 1 second
        exportTimeoutMillis: 30000, // 30 seconds
    })
);

logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
const logger = logsAPI.logs.getLogger('azure-eventhub-logs');

const functionName = process.env.FUNCTION_APP_NAME || 'unknown';

/**
 * @description Function entrypoint
 * @param {object} context - Function context
 * @param {array} eventHubMessages - event hub messages
 */
const eventHubTrigger = async function (context: InvocationContext, events: any): Promise<void> {
    if (!Array.isArray(events) || events.length === 0) {
        return;
    }
    
    const threadId = context.invocationId;
    const metadata = (context as any).bindingData;
    
    context.log(`Event hub function processing ${events.length} messages`);
    
    // Process events with metadata
    events.forEach((message, index) => {
        // Extract Event Hub metadata for this message from bindingData arrays
        const eventMetadata = {
            enqueuedTimeUtc: metadata?.enqueuedTimeUtcArray?.[index],
            sequenceNumber: metadata?.sequenceNumberArray?.[index],
            offset: metadata?.offsetArray?.[index],
            partitionKey: metadata?.partitionKeyArray?.[index]
        };
        
        if ('records' in message && Array.isArray(message.records)) {
            message.records.forEach((inner_record) => {
                writeLog(inner_record, threadId, index, eventMetadata);
            });
        } else {
            writeLog(message, threadId, index, eventMetadata);
        }
    });

    // Add delay before force flush to allow batch to accumulate
    await new Promise(resolve => setTimeout(resolve, 2000));
    await loggerProvider.forceFlush();
};

const writeLog = function(text: any, threadId: string, messageIndex: number, eventMetadata: any): void {
    if (!text) return;
    
    const attributes: Record<string, any> = {
        'log.type': 'EventHubLogRecord',
        'threadId': threadId,
        'function.name': functionName,
        'message.index': messageIndex
    };
    
    // Add Event Hub system properties
    if (eventMetadata.sequenceNumber !== undefined) {
        attributes['eventhub.sequence_number'] = eventMetadata.sequenceNumber;
    }
    if (eventMetadata.offset !== undefined) {
        attributes['eventhub.offset'] = eventMetadata.offset;
    }
    if (eventMetadata.enqueuedTimeUtc !== undefined) {
        attributes['eventhub.enqueued_time'] = eventMetadata.enqueuedTimeUtc;
    }
    if (eventMetadata.partitionKey !== undefined) {
        attributes['eventhub.partition_key'] = eventMetadata.partitionKey;
    }
    
    logger.emit({
        severityNumber: logsAPI.SeverityNumber.INFO,
        body: JSON.stringify(text),
        attributes: attributes
    });
};

export { eventHubTrigger as default };