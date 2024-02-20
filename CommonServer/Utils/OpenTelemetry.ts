import * as opentelemetry from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import logger from './Logger';
import Dictionary from 'Common/Types/Dictionary';

let sdk: opentelemetry.NodeSDK | null = null; 

if (
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] &&
    process.env['OTEL_EXPORTER_OTLP_HEADERS']
) {
    const headersStrings: Array<string> =
        process.env['OTEL_EXPORTER_OTLP_HEADERS'].split(';');

    const headers: Dictionary<string> = {};

    for (const headerString of headersStrings) {
        const header: Array<string> = headerString.split('=');
        if (header.length === 2) {
            headers[header[0]!.toString()] = header[1]!.toString();
        }
    }

    sdk = new opentelemetry.NodeSDK({
        traceExporter: new OTLPTraceExporter({
            url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
            headers: headers,
        }),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
                url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
                headers: headers,
            }),
        }) as any,
        instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();

    logger.info('Instrumentation initialized');
}

export default sdk;
