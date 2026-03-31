#!/usr/bin/env python3
"""
Test script to exercise all log formats supported by the EventHub function:
  1. JSON_OBJECT   - a plain JSON object
  2. JSON_STRING   - a JSON object serialized as a string
  3. JSON_ARRAY    - a JSON array (each element becomes a separate log entry)
  4. STRING        - a plain text string
  5. Azure envelope - {"records": [...]} wrapper (each record becomes a separate entry)
  6. BUFFER        - raw bytes (UTF-8 encoded JSON)
"""
from azure.eventhub import EventHubProducerClient, EventData
import json
import subprocess
import sys

resource_group = "eventhub-test-standardized"
namespace = "eh-ns-std"
eventhub_name = "test-eventhub"

print("Fetching EventHub connection string...")
result = subprocess.run([
    "az", "eventhubs", "namespace", "authorization-rule", "keys", "list",
    "--resource-group", resource_group,
    "--namespace-name", namespace,
    "--name", "RootManageSharedAccessKey",
    "--query", "primaryConnectionString",
    "-o", "tsv"
], capture_output=True, text=True)

connection_str = result.stdout.strip()
if not connection_str:
    print("Error: Could not retrieve connection string")
    sys.exit(1)

print(f"Sending test events to: {eventhub_name}\n")

# Each entry is (label, bytes_payload)
test_events = [
    # 1. JSON_OBJECT - dict serialised to JSON bytes
    (
        "JSON_OBJECT",
        json.dumps({"format": "json-object", "message": "plain JSON object", "level": "info"}).encode()
    ),
    # 2. JSON_STRING - a JSON object but delivered as a quoted JSON string
    #    i.e. the EventHub payload itself is a JSON string whose value is another JSON string
    (
        "JSON_STRING",
        json.dumps(json.dumps({"format": "json-string", "message": "JSON encoded as string"})).encode()
    ),
    # 3. JSON_ARRAY - a JSON array; each element → separate log entry
    (
        "JSON_ARRAY",
        json.dumps([
            {"format": "json-array", "message": "array element 1", "index": 0},
            {"format": "json-array", "message": "array element 2", "index": 1},
        ]).encode()
    ),
    # 4. Azure diagnostic logs envelope {"records": [...]}
    (
        "AZURE_ENVELOPE",
        json.dumps({
            "records": [
                {"format": "azure-envelope", "message": "record 1 from azure envelope", "resourceId": "/subscriptions/abc123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm"},
                {"format": "azure-envelope", "message": "record 2 from azure envelope"},
            ]
        }).encode()
    ),
    # 6. BUFFER - raw bytes containing a JSON object (tests Buffer.isBuffer path)
    (
        "BUFFER (raw bytes)",
        b'{"format":"buffer","message":"raw bytes decoded as utf-8 then json","level":"debug"}'
    ),
]

producer = EventHubProducerClient.from_connection_string(
    conn_str=connection_str,
    eventhub_name=eventhub_name
)

try:
    batch = producer.create_batch(partition_id="3")

    for label, payload in test_events:
        event_data = EventData(body=payload)
        batch.add(event_data)
        print(f"  + Added [{label}]  ({len(payload)} bytes)")

    producer.send_batch(batch)
    print(f"\nSent {len(test_events)} events to partition 3.")
    print("Check Coralogix in ~10 seconds.")
finally:
    producer.close()
