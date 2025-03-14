import Telemetry from "../Telemetry";
import { Span } from "@opentelemetry/api";

function CaptureSpan(name: string) {
    return function (
        _target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const attributes = args.reduce((acc: { [key: string]: any }, arg: any, index: number) => {
                acc[`arg${index}`] = arg;
                return acc;
            }, {});

            return await Telemetry.startActiveSpan<Promise<void>>({
                name: name || propertyKey,
                options: {
                    attributes: attributes,
                },
                fn: async (span: Span): Promise<void> => {
                    try {
                        await originalMethod.apply(this, args);
                    } catch (err) {
                        Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
                            span,
                            exception: err,
                        });
                        throw err;
                    } finally {
                        span.end();
                    }
                },
            });
        };

        return descriptor;
    };
}

export default CaptureSpan;
