import opentelemetry from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// For troubleshooting, set the log level to DiagLogLevel.DEBUG
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

const sdk: opentelemetry.NodeSDK = new opentelemetry.NodeSDK({
    traceExporter: new opentelemetry.tracing.ConsoleSpanExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
});

export default sdk;
