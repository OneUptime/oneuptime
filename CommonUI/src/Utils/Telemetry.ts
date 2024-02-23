import { registerInstrumentations } from '@opentelemetry/instrumentation';
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
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';

export default class Telemetry {
    public static init(data: { serviceName: string }): void {
        if (OpenTelemetryExporterOtlpEndpoint) {
            const providerConfig: TracerConfig = {
                resource: new Resource({
                    [SemanticResourceAttributes.SERVICE_NAME]: data.serviceName,
                }),
            };

            const provider: WebTracerProvider = new WebTracerProvider(
                providerConfig
            );

            provider.addSpanProcessor(
                new BatchSpanProcessor(
                    new OTLPTraceExporter({
                        url:
                            OpenTelemetryExporterOtlpEndpoint?.toString() +
                            '/v1/traces',
                        headers: OpenTelemetryExporterOtlpHeaders,
                    })
                )
            );

            provider.register({
                contextManager: new ZoneContextManager(),
            });

            registerInstrumentations({
                instrumentations: [
                    new FetchInstrumentation(),
                    new XMLHttpRequestInstrumentation(),
                ],
            });
        }
    }
}
