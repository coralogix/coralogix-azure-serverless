/**
 * Azure Function for collection of Metrics contained in Event Hub messages
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

/**
 * @description Function entrypoint
 * @param {object} context - Function context
 * @param {array} eventHubMessages - event hub messages
 */
const eventHubTrigger: AzureFunction = async function (context: Context, eventHubMessages: any): Promise<void> {
    context.log(`JavaScript eventhub trigger function called for message array ${eventHubMessages}`);

    const url = process.env.CORALOGIX_URL || 'https://api.coralogix.com/api/v1/logs'
    const key = process.env.CORALOGIX_PRIVATE_KEY || "INVALID_KEY"
    const applicationName = process.env.CORALOGIX_APP_NAME || "NO_APPLICATION"
    const subsystemName = process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    const response = postData(url, key, applicationName, subsystemName, {'eventHubMessages': eventHubMessages.map(s => JSON.parse(s)) });
    context.log(`Sent messages. Response: ${JSON.stringify(response)}`);

};

async function postData(url: string, privateKey: string, applicationName: string, subsystemName: string, data: any) {
    if( !privateKey) {
        throw new Error('CORALOGIX_KEY must be defined');
    }
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${privateKey}`,
        'cx-application-name': applicationName,
        'cx-subsystem-name': subsystemName
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
    });
    return response;
}

export default eventHubTrigger;