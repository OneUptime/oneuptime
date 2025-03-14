import Telemetry from "../Telemetry";
import { Span, SpanStatusCode } from "@opentelemetry/api";
import logger from "../Logger"; // Make sure to import your logger
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { DisableTelemetry } from "../../EnvironmentConfig";

function CaptureSpan(data?: {
    name?: string;
    attributes?: JSONObject;
    captureArguments?: boolean;
}): (
    _target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
) => PropertyDescriptor {
    return function (
        _target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        const name: string | undefined = data?.name || propertyKey;

        logger.debug(`Capturing span for ${name}`);

        descriptor.value = async function (...args: any[]) {
            if (DisableTelemetry) {
                logger.debug(`Telemetry is disabled. Running function ${name} without capturing span.`);
                return await originalMethod.apply(this, args);
            }

            let functionArguments = {};

            if (data?.captureArguments) {
                functionArguments = args.reduce(
                    (acc: { [key: string]: any }, arg: any, index: number) => {
                        acc[`arg${index}`] = arg;
                        return acc;
                    },
                    {}
                );
            }

            logger.debug(`Starting span for ${name} with args:`);
            logger.debug(functionArguments);

            const spanAttributes = JSONFunctions.flattenObject({
                ...functionArguments,
                ...data?.attributes,
            }) as { [key: string]: any };

            logger.debug(`Span attributes for ${name}:`);
            logger.debug(spanAttributes);

            return await Telemetry.startActiveSpan<Promise<void>>({
                name: name,
                options: {
                    attributes: spanAttributes,
                },
                fn: async (span: Span): Promise<void> => {
                    try {
                        await originalMethod.apply(this, args);
                        // mark span as success
                        span.setStatus({
                            code: SpanStatusCode.OK,
                        });
                    } catch (err) {
                        Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
                            span,
                            exception: err,
                        });
                        // mark span as error
                        span.setStatus({
                            code: SpanStatusCode.ERROR,
                        });
                        logger.debug(`Error in span for ${name}:`);
                        logger.debug(err);
                        throw err;
                    } finally {
                        span.end();
                        logger.debug(`Ended span for ${name}`);
                    }
                },
            });
        };

        return descriptor;
    };
}

export default CaptureSpan;
