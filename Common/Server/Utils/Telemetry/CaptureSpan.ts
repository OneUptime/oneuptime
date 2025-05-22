import Telemetry from "../Telemetry";
import { Span, SpanStatusCode } from "@opentelemetry/api";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { DisableTelemetry } from "../../EnvironmentConfig";

function CaptureSpan(data?: {
  name?: string;
  attributes?: JSONObject;
  captureArguments?: boolean;
}): (
  target: any,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<any>,
) => TypedPropertyDescriptor<any> {
  return function (
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<any>,
  ) {
    const originalMethod: any = descriptor.value;

    let className: string | undefined = target?.constructor?.name;

    if (className === "" || className === "Function") {
      const staticClassName: string | undefined = target?.name;

      if (staticClassName) {
        className = staticClassName;
      }
    }

    if (!className) {
      className = "UnknownClass";
    }

    const name: string | undefined =
      data?.name || `${className}.${propertyKey}`;

    descriptor.value = function (...args: any[]) {
      if (DisableTelemetry) {
        return originalMethod.apply(this, args);
      }

      let functionArguments: JSONObject = {};

      if (data?.captureArguments) {
        functionArguments = args.reduce(
          (acc: { [key: string]: any }, arg: any, index: number) => {
            acc[`arg${index}`] = arg;
            return acc;
          },
          {},
        );
      }

      const spanAttributes: { [key: string]: any } =
        JSONFunctions.flattenObject({
          ...functionArguments,
          ...data?.attributes,
        }) as { [key: string]: any };

      return Telemetry.startActiveSpan({
        name: name,
        options: {
          attributes: {
            ...spanAttributes,
            hey: "there",
            thisIsNumber: 123,
            thisIsBoolean: true,
            thisIsArray: [1, 2, 3],
          },
        },
        fn: (span: Span) => {
          let result: any = null;
          try {
            result = originalMethod.apply(this, args);
            if (result instanceof Promise) {
              return result
                .then((res: any) => {
                  span.setStatus({
                    code: SpanStatusCode.OK,
                  });
                  return res;
                })
                .catch((err: Error) => {
                  Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
                    span,
                    exception: err,
                  });

                  throw err;
                })
                .finally(() => {
                  span.end();
                });
            }
            span.setStatus({
              code: SpanStatusCode.OK,
            });
            return result;
          } catch (err) {
            Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
              span,
              exception: err,
            });

            throw err;
          } finally {
            if (!(result instanceof Promise)) {
              span.end();
            }
          }
        },
      });
    };

    return descriptor;
  };
}

export default CaptureSpan;
