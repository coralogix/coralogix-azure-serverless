import { AzureFunction, Context } from "@azure/functions";
import { gunzipSync } from "zlib";

const eventHubTrigger: AzureFunction = async function (context: Context, eventHubMessages: any[], myBlob: any): Promise<void> {
    // Process each message from the Event Hub
    for (const message of eventHubMessages) {
        const blobURL = message.data.url;
        const blobName = blobURL.slice(blobURL.lastIndexOf("/") + 1);
        context.log("Processing:", blobName);

        try {
            let blobData = myBlob;

            if (blobName.endsWith(".gz")) {
                blobData = gunzipSync(blobData);
            }

            // Simply log the blob content
            console.log(blobData.toString());

        } catch (error) {
            context.log.error(`Error during processing of ${blobName}: ${error}`);
        }

        context.log("Finished processing of:", blobName);
    }
};

export default eventHubTrigger;
