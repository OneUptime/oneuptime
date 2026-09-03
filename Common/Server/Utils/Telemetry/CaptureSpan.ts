import Telemetry from "../Telemetry";
import { Span, SpanStatusCode } from "@opentelemetry/api";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { DisableTelemetry } from "../../EnvironmentConfig";

/*
 * Mark a span OK, but never DOWNGRADE an ERROR someone else already set.
 *
 * The SDK's own setStatus guard only early-returns when the CURRENT status is
 * already OK, so an OK written after an ERROR wins. That is reachable whenever
 * a decorated method swallows an error and signals failure by another route
 * (Express middleware calling next(err) is the classic case): the method
 * "returns successfully" from the decorator's point of view, and the span ends
 * up marked OK while carrying an exception event.
 */
function markSpanOk(span: Span): void {
  try {
    const currentStatus: { code?: number } | undefined = (
      span as unknown as { status?: { code?: number } }
    ).status;

    if (currentStatus && currentStatus.code === SpanStatusCode.ERROR) {
      return;
    }
  } catch {
    // Span implementation without an observable status — set it normally.
  }

  span.setStatus({
    code: SpanStatusCode.OK,
  });
}

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
      /*
       * Skip the span machinery entirely when telemetry is disabled OR no
       * span exporter is installed. Without an exporter the span is never
       * shipped anywhere, but creating it still costs attribute flattening,
       * a span allocation, and an AsyncLocalStorage context transition —
       * decorated methods sit on ingest hot paths that run millions of
       * times per minute, so this must be a plain method call there.
       */
      if (DisableTelemetry || !Telemetry.isSpanExportEnabled()) {
        return originalMethod.apply(this, args);
      }

      /*
       * Only pay for attribute flattening when there is something to
       * flatten — the overwhelmingly common bare @CaptureSpan() form has
       * neither captured arguments nor static attributes.
       */
      let spanAttributes: { [key: string]: any } | undefined = undefined;

      if (data?.captureArguments || data?.attributes) {
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

        spanAttributes = JSONFunctions.flattenObject({
          ...functionArguments,
          ...data?.attributes,
        }) as { [key: string]: any };
      }

      return Telemetry.startActiveSpan({
        name: name,
        options: spanAttributes ? { attributes: spanAttributes } : {},
        fn: (span: Span) => {
          let result: any = null;
          try {
            result = originalMethod.apply(this, args);
            if (result instanceof Promise) {
              return result
                .then((res: any) => {
                  markSpanOk(span);
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
                  Telemetry.endSpan(span);
                });
            }
            markSpanOk(span);
            return result;
          } catch (err) {
            Telemetry.recordExceptionMarkSpanAsErrorAndEndSpan({
              span,
              exception: err,
            });

            throw err;
          } finally {
            if (!(result instanceof Promise)) {
              Telemetry.endSpan(span);
            }
          }
        },
      });
    };

    return descriptor;
  };
}

export default CaptureSpan;
