# Syslog Testing Instructions

Test in terminal, send a sample RFC5424 payload:
   ```bash
   curl -X POST \
     -H "Content-Type: text/plain" \
       -H "x-oneuptime-token: YOUR_TEST_TOKEN" \
       -H "x-oneuptime-service-name: local-syslog" \
     --data '<134>1 2024-07-10T17:25:43.123Z host app 1234 ID47 [exampleSDID@32473 iut="3" eventSource="App"] An application event log entry' \
     https://oneuptime.com/syslog/v1/logs
   ```

Replace `YOUR_TEST_TOKEN` and `local-syslog` with a valid telemetry key and desired service label. Please also replace oneuptime.com with your host if you're testing this locally.

Inspect the service logs or connected queue to ensure the message is accepted and parsed.

