import * as opentelemetry from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import logger from './Logger';

if(process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] && process.env['OTEL_EXPORTER_OTLP_HEADERS']){
    const sdk = new opentelemetry.NodeSDK({
        traceExporter: new OTLPTraceExporter({
            url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
            headers: {
                [process.env['OTEL_EXPORTER_OTLP_ENDPOINT'].split("=")[0] as any]: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'].split("=")[1]
            }
        }),
        metricReader: new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
            headers: {
                [process.env['OTEL_EXPORTER_OTLP_ENDPOINT'].split("=")[0] as any]: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'].split("=")[1]
            }
          }),
        }) as any,
        instrumentations: [getNodeAutoInstrumentations()],
      });

    
      sdk.start();

    logger.info('OpenTelemetry Started');
}
