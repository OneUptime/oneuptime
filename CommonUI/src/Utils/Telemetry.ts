import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import {
    BatchSpanProcessor,
    TracerConfig,
    WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { Resource } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
    OpenTelemetryExporterOtlpEndpoint,
    OpenTelemetryExporterOtlpHeaders,
} from '../Config';

const providerConfig: TracerConfig = {
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'my-react-app',
    }),
};

const provider: WebTracerProvider = new WebTracerProvider(providerConfig);

// we will use ConsoleSpanExporter to check the generated spans in dev console
// provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));

if (OpenTelemetryExporterOtlpEndpoint) {
    provider.addSpanProcessor(
        new BatchSpanProcessor(
            new OTLPTraceExporter({
                url: OpenTelemetryExporterOtlpEndpoint?.toString() + '/v1/traces',
                headers: OpenTelemetryExporterOtlpHeaders,
            })
        )
    );
}

provider.register({
    contextManager: new ZoneContextManager(),
});

registerInstrumentations({
    instrumentations: [
        // getWebAutoInstrumentations initializes all the package.
        // it's possible to configure each instrumentation if needed.
        getWebAutoInstrumentations({
            '@opentelemetry/instrumentation-fetch': {
                enabled: true,
            },
        }),
    ],
});
