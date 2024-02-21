import * as opentelemetry from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import Dictionary from 'Common/Types/Dictionary';
import {
    BatchLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';


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

    const otlpEndpoint: string = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

    const logExporter: OTLPLogExporter = new OTLPLogExporter({
        url: otlpEndpoint + '/v1/logs',
        headers: headers,
    });


    sdk = new opentelemetry.NodeSDK({
        idGenerator: new AWSXRayIdGenerator(),
        traceExporter: new OTLPTraceExporter({
            url: otlpEndpoint + '/v1/traces',
            headers: headers
        }),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
                url: otlpEndpoint + '/v1/metrics',
                headers: headers,
            }),
        }) as any,
        logRecordProcessor: new BatchLogRecordProcessor(logExporter) as any,
        instrumentations: [
            getNodeAutoInstrumentations(),
        ],
    });

    process.on('SIGTERM', () => {
        sdk!.shutdown().finally(() => {
            return process.exit(0);
        });
    });
}

export default sdk;

