import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { ResolvedStackFrame } from "Common/Types/Telemetry/SourceMap";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  applyResolvedFrames,
  FrameDisplayLocation,
  getFrameDisplayLocation,
  parseFramesJson,
} from "../../Utils/SourceMapFrames";
import {
  formatFrameLocation,
  getRawStackTraceExcerpt,
  getStackTraceCrashPoint,
  orderFramesInnermostFirst,
  RawStackTraceExcerpt,
  StackTraceCallerFrame,
  StackTraceCrashPoint,
} from "../../Utils/StackTracePresentation";
import AppLink from "../AppLink/AppLink";
import { SourceSnippetBlock } from "./StackFrameViewer";

/*
 * WHERE IT HAPPENED, ON THE EXCEPTION'S OVERVIEW.
 *
 * The line the exception was most likely raised from - the first frame of
 * the application's own code, its original location when a source map
 * resolved it, and the source around it when the map carried it - and the
 * few frames of the application that called it. What a person opening an
 * exception reads first, without opening the Stack Trace page; the link
 * under it opens every frame.
 *
 * A trace without structured frames shows its first lines (the last ones of
 * a Python traceback, which prints the crash point last). An exception
 * without a stack trace shows nothing: the Stack Trace page says why.
 */

// The frames of the application that called the crash point, shown under it.
export const CRASH_POINT_MAX_CALLERS: number = 3;

// The lines of a trace without structured frames, shown as they are.
export const CRASH_POINT_RAW_LINE_COUNT: number = 8;

export const EXCEPTION_CRASH_POINT_TEST_IDS: {
  card: string;
  loading: string;
  frame: string;
  function: string;
  location: string;
  callers: string;
  caller: string;
  raw: string;
  stackTraceLink: string;
  summary: string;
} = {
  card: "exception-crash-point",
  loading: "exception-crash-point-loading",
  frame: "exception-crash-point-frame",
  function: "exception-crash-point-function",
  location: "exception-crash-point-location",
  callers: "exception-crash-point-callers",
  caller: "exception-crash-point-caller",
  raw: "exception-crash-point-raw",
  stackTraceLink: "exception-crash-point-stack-trace-link",
  summary: "exception-crash-point-summary",
};

export interface ComponentProps {
  // The exception's stack trace. Without one the card is not drawn.
  stackTrace?: string | undefined;
  // The latest occurrence's structured frames (its parsedFrames JSON).
  parsedFrames?: string | undefined;
  // The same frames resolved through the release's source maps, if any.
  resolvedFrames?: Array<ResolvedStackFrame> | undefined;
  // The latest occurrence (and its source maps) is still being read.
  isLoading: boolean;
  // The exception's Stack Trace page.
  stackTraceRoute: Route;
}

const ANONYMOUS_FUNCTION: string = "<anonymous>";

const ExceptionCrashPoint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const frames: Array<ResolvedStackFrame> = useMemo(() => {
    return orderFramesInnermostFirst(
      applyResolvedFrames(
        parseFramesJson(props.parsedFrames),
        props.resolvedFrames,
      ),
      props.stackTrace,
    );
  }, [props.parsedFrames, props.resolvedFrames, props.stackTrace]);

  const crashPoint: StackTraceCrashPoint | null = useMemo(() => {
    return getStackTraceCrashPoint(frames, CRASH_POINT_MAX_CALLERS);
  }, [frames]);

  if (!props.stackTrace) {
    return <></>;
  }

  const footer: (summary: string) => ReactElement = (
    summary: string,
  ): ReactElement => {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-gray-100 pt-4">
        <AppLink
          to={props.stackTraceRoute}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500"
          dataTestId={EXCEPTION_CRASH_POINT_TEST_IDS.stackTraceLink}
        >
          <Icon icon={IconProp.Code} className="h-4 w-4" />
          <span>{translator.translateText("View full stack trace")}</span>
        </AppLink>
        {summary ? (
          <span
            className="text-xs text-gray-500"
            data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.summary}
          >
            {summary}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return (
        <div
          className="flex min-h-24 items-center justify-center"
          data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.loading}
        >
          <ComponentLoader />
        </div>
      );
    }

    if (!crashPoint) {
      const excerpt: RawStackTraceExcerpt = getRawStackTraceExcerpt(
        props.stackTrace,
        CRASH_POINT_RAW_LINE_COUNT,
      );

      return (
        <div>
          <pre
            className="overflow-x-auto rounded-lg bg-gray-50 px-4 py-3 font-mono text-xs leading-5 text-gray-700 ring-1 ring-inset ring-gray-200"
            data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.raw}
          >
            {excerpt.lines.join("\n")}
          </pre>
          {footer(
            excerpt.hiddenLineCount > 0
              ? translator.translatePlural(
                  {
                    one: "{{count}} more line",
                    other: "{{count}} more lines",
                  },
                  excerpt.hiddenLineCount,
                )
              : "",
          )}
        </div>
      );
    }

    const location: FrameDisplayLocation = getFrameDisplayLocation(
      crashPoint.frame,
    );
    const shortLocation: string = formatFrameLocation(location, {
      shorten: true,
    });
    const fullLocation: string = formatFrameLocation(location, {
      shorten: false,
    });

    return (
      <div className="space-y-4">
        <div
          className="flex items-start gap-3 rounded-lg bg-red-50/60 px-4 py-3 ring-1 ring-inset ring-red-600/10"
          data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.frame}
          data-in-app={crashPoint.isInApp ? "true" : "false"}
          data-frame-index={crashPoint.originalIndex}
        >
          <Icon
            icon={IconProp.Error}
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
          />
          <div className="min-w-0 flex-1">
            <p
              className="break-all font-mono text-sm font-semibold text-red-900"
              data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.function}
            >
              {location.functionName || ANONYMOUS_FUNCTION}
            </p>
            {shortLocation ? (
              <p
                className="mt-0.5 truncate font-mono text-xs text-red-800"
                title={fullLocation}
                data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.location}
              >
                {shortLocation}
              </p>
            ) : (
              <></>
            )}
          </div>
        </div>

        {crashPoint.frame.sourceCodeSnippet ? (
          <SourceSnippetBlock
            snippet={crashPoint.frame.sourceCodeSnippet}
            fileName={location.fileName}
          />
        ) : (
          <></>
        )}

        {crashPoint.callers.length > 0 ? (
          <section data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.callers}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("Called from")}
            </h3>
            <ol className="mt-2 space-y-2">
              {crashPoint.callers.map(
                (caller: StackTraceCallerFrame): ReactElement => {
                  const callerLocation: FrameDisplayLocation =
                    getFrameDisplayLocation(caller.frame);
                  const callerShortLocation: string = formatFrameLocation(
                    callerLocation,
                    { shorten: true },
                  );

                  return (
                    <li
                      key={caller.originalIndex}
                      className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
                      data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.caller}
                      data-frame-index={caller.originalIndex}
                    >
                      <span className="min-w-0 truncate font-mono text-[13px] text-gray-900">
                        {callerLocation.functionName || ANONYMOUS_FUNCTION}
                      </span>
                      {callerShortLocation ? (
                        <span
                          className="min-w-0 truncate font-mono text-xs text-gray-500"
                          title={formatFrameLocation(callerLocation, {
                            shorten: false,
                          })}
                        >
                          {callerShortLocation}
                        </span>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ol>
          </section>
        ) : (
          <></>
        )}

        {footer(
          [
            translator.translatePlural(
              { one: "{{count}} frame", other: "{{count}} frames" },
              crashPoint.frameCount,
            ),
            translator.translatePlural(
              {
                one: "{{count}} in your code",
                other: "{{count}} in your code",
              },
              crashPoint.appFrameCount,
            ),
          ].join(" · "),
        )}
      </div>
    );
  };

  return (
    <Card
      title="Where it happened"
      description={
        props.isLoading
          ? undefined
          : !crashPoint
            ? "Structured frames were not recorded for the latest occurrence."
            : crashPoint.isInApp
              ? "The first frame in your own code: the most likely place the error was raised."
              : "No frame is in your own code, so this is the innermost frame of the stack trace."
      }
    >
      <div data-testid={EXCEPTION_CRASH_POINT_TEST_IDS.card}>
        {renderBody()}
      </div>
    </Card>
  );
};

export default ExceptionCrashPoint;
