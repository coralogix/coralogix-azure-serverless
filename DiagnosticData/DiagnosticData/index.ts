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

    const url = process.env.CORALOGIX_URL || 'https://ingress.coralogix.com/azure/events/v1'
    const key = process.env.CORALOGIX_PRIVATE_KEY || "INVALID_KEY"
    const applicationName = process.env.CORALOGIX_APP_NAME || "NO_APPLICATION"
    const subsystemName = process.env.CORALOGIX_SUB_SYSTEM || "NO_SUBSYSTEM"
    const response = postData(url, key, applicationName, subsystemName, {'eventHubMessages': eventHubMessages.map(parseJSON)});
    context.log(`Sent messages. Response: ${JSON.stringify(response)}`);

};

// This function is to address an Azure bug where single quotes are used in the diagnostic log messages
// for Linux consumption plan resulting in invalid JSON. https://github.com/Azure/azure-functions-host/issues/7864
function parseJSON(data: any): any {
    try {
        return JSON.parse(data)
    } catch (error) {
        if (error instanceof SyntaxError) {
            // Replace single quotes with double quotes not preceded by a backslash
            let cleaned = data.replace(/(?<!\\)'/g, '"')
            cleaned = cleaned.replace(/\\'/g, "'")
            return JSON.parse(cleaned)
        } else {
            console.error(error)
            throw error
        }
    }
}

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
