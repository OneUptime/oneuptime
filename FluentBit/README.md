# Fluentd

This guide will help you test fluent-bit logs with OneUptime.

## Prerequisites

- Filuentd docker container running on your system (essentially this folder should be running). 
    You can run the container using the command `npm run dev fluent-bit`
- OneUptime account
- OneUptime project
- Telemetry Ingestion Key (Create one from the OneUptime dashboard, Click on More -> Project Settings -> Telemetry Ingestion Key)


## Configuration and Testing

- Please make sure the correct token and url is in the configuration file located at `FluentBut/etc/fluent-bit.yaml`. 
- Build the docker image using the command `npm run force-build fluent-bit`
- Run the docker image using the command `npm run dev fluent-bit`
- Send logs to the Fluentd container using the curl command 

```bash
curl -X POST -H "Content-Type: application/json" -d '{"log": "This is a test log message"}' http://localhost:8889
```

You should be able to see the logs in the OneUptime dashboard.



