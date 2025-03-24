import { AzureFunction, Context } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { gunzipSync } from "zlib";

const eventHubTrigger: AzureFunction = async function (context: Context, eventHubMessages: any[]): Promise<void> {
    // Process each message from the Event Hub
    for (const message of eventHubMessages) {
        // Parse the message if it's a string
        const parsedEvents = typeof message === 'string' ? JSON.parse(message) : message;

        // Handle each event in the array
        for (const event of parsedEvents) {
            context.log(event);
            const blobURL = event.data.url;
            // Parse both container and blob path from the URL
            const urlParts = new URL(blobURL);
            const pathSegments = urlParts.pathname.split('/');
            const containerName = pathSegments[1]; // First segment after the leading slash
            const blobPath = pathSegments.slice(2).join('/'); // Everything after the container name

            context.log("Container:", containerName);
            context.log("Blob path:", blobPath);

            try {
                // Use the storage account connection string directly
                const storageConnectionString = process.env.BLOB_STORAGE_ACCOUNT_CONNECTION_STRING;
                const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);

                const containerClient = blobServiceClient.getContainerClient(containerName);
                const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

                let blobData = await blockBlobClient.downloadToBuffer();

                if (blobPath.endsWith(".gz")) {
                    blobData = gunzipSync(blobData);
                }

                // Log the blob content using context.log instead of console.log
                context.log("Blob content:");
                context.log(blobData.toString());

            } catch (error) {
                context.log.error(`Error during processing of ${blobPath}:`);
                context.log.error('Error details:', {
                    message: error.message,
                    code: error.code,
                    statusCode: error.statusCode,
                    details: error.details,
                    stack: error.stack
                });
            }

            context.log("Finished processing of:", blobPath);
        }
    }
};

export { eventHubTrigger as default };
