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
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod: any = descriptor.value;

    let className = target?.constructor?.name;

    if (className === "" || className === "Function") {
      const staticClassName = target?.name;

      if (staticClassName) {
        className = staticClassName;
      }
    }

    if (!className) {
      className = "UnknownClass";
    }

    const name: string | undefined =
      data?.name || `${className}.${propertyKey}`;

    logger.debug(`Capturing span for ${name}`);

    descriptor.value = function (...args: any[]) {
      if (DisableTelemetry) {
        logger.debug(
          `Telemetry is disabled. Running function ${name} without capturing span.`,
        );
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

      logger.debug(`Starting span for ${name} with args:`);
      logger.debug(functionArguments);

      const spanAttributes: { [key: string]: any } =
        JSONFunctions.flattenObject({
          ...functionArguments,
          ...data?.attributes,
        }) as { [key: string]: any };

      logger.debug(`Span attributes for ${name}:`);
      logger.debug(spanAttributes);

      return Telemetry.startActiveSpan({
        name: name,
        options: {
          attributes: spanAttributes,
        },
        fn: (span: Span) => {
          let result = null;
          try {
            result = originalMethod.apply(this, args);
            if (result instanceof Promise) {
              return result
                .then((res) => {
                  span.setStatus({
                    code: SpanStatusCode.OK,
                  });
                  return res;
                })
                .catch((err) => {
                  Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
                    span,
                    exception: err,
                  });
                  logger.debug(`Error in span for ${name}:`);
                  logger.debug(err);
                  throw err;
                })
                .finally(() => {
                  span.end();
                  logger.debug(`Ended span for ${name}`);
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
            logger.debug(`Error in span for ${name}:`);
            logger.debug(err);
            throw err;
          } finally {
            if (!(result instanceof Promise)) {
              span.end();
              logger.debug(`Ended span for ${name}`);
            }
          }
        },
      });
    };

    return descriptor;
  };
}

export default CaptureSpan;
