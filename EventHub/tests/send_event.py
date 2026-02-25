#!/usr/bin/env python3
"""
Send a single event to an Azure Event Hub. Used by the E2E test to trigger the function.
Requires: pip install azure-eventhub
Usage: send_event.py <connection_string> <message_body>
"""
import sys

def main():
    if len(sys.argv) != 3:
        print("Usage: send_event.py <connection_string> <message_body>", file=sys.stderr)
        sys.exit(1)
    conn_str = sys.argv[1]
    body = sys.argv[2]

    try:
        from azure.eventhub import EventHubProducerClient, EventData
    except ImportError:
        print("Install azure-eventhub: pip install azure-eventhub", file=sys.stderr)
        sys.exit(1)

    client = EventHubProducerClient.from_connection_string(conn_str)
    try:
        batch = client.create_batch()
        batch.add(EventData(body))
        client.send_batch(batch)
    finally:
        client.close()

if __name__ == "__main__":
    main()
