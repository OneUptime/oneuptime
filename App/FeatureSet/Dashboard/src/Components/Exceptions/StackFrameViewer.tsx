import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import {
  ResolvedStackFrame,
  SourceCodeSnippet,
} from "Common/Types/Telemetry/SourceMap";
import {
  applyResolvedFrames,
  countResolvedFrames,
  getFrameDisplayLocation,
  parseFramesJson,
  FrameDisplayLocation,
} from "../../Utils/SourceMapFrames";
import {
  RawStackTraceLine,
  StackTraceDisplayItem,
  StackTraceFrameOrder,
  StackTraceViewMode,
  buildStackTraceDisplayItems,
  formatFrameLocation,
  getFramePackageName,
  getStackTraceHeadline,
  getTopAppFrameIndex,
  getVisibleFrameIndexes,
  orderStackTraceDisplayItems,
  parseRawStackTraceLines,
  shortenFramePath,
} from "../../Utils/StackTracePresentation";
import ExceptionSegmentedControl from "./ExceptionSegmentedControl";

export interface ComponentProps {
  stackTrace: string;
  /** JSON-stringified Array<MinifiedStackFrame> (the parsedFrames column). */
  parsedFrames?: string;
  /*
   * Output of POST /telemetry/exceptions/resolve-stack-trace for the same
   * frames — present when source maps were uploaded for the exception's
   * (service, release). Frames with resolved: true display their original
   * source location instead of the minified one.
   */
  resolvedFrames?: Array<ResolvedStackFrame> | undefined;
  /*
   * Source maps a frame matched but the resolver skipped for size. Non-zero
   * means some frames stay minified for a reason an operator can fix.
   */
  skippedSourceMapCount?: number | undefined;
}

type StackTraceTab = "frames" | "raw";

// --- Badges ---

interface FrameBadgeProps {
  label: string;
  className: string;
  title?: string | undefined;
  testId: string;
}

const FrameBadge: FunctionComponent<FrameBadgeProps> = (
  props: FrameBadgeProps,
): ReactElement => {
  return (
    <span
      title={props.title}
      data-testid={props.testId}
      className={`inline-flex max-w-[12rem] items-center truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${props.className}`}
    >
      {props.label}
    </span>
  );
};

// --- Original source snippet ---

interface SourceSnippetProps {
  snippet: SourceCodeSnippet;
  fileName: string;
}

const SourceSnippetBlock: FunctionComponent<SourceSnippetProps> = ({
  snippet,
  fileName,
}: SourceSnippetProps): ReactElement => {
  return (
    <div
      className="overflow-hidden rounded-lg bg-gray-900 ring-1 ring-gray-800"
      data-testid="stack-frame-source-snippet"
    >
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-1.5">
        <Icon icon={IconProp.Code} className="h-3.5 w-3.5 text-gray-500" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">
          {fileName || "Original source"}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
          Original source
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs leading-5">
          <tbody>
            {snippet.lines.map((line: string, i: number): ReactElement => {
              const lineNumber: number = snippet.startLine + i;
              const isHighlighted: boolean =
                lineNumber === snippet.highlightLine;
              return (
                <tr
                  key={i}
                  className={isHighlighted ? "bg-red-500/15" : undefined}
                  data-highlighted={isHighlighted ? "true" : undefined}
                >
                  <td
                    className={`w-[1%] select-none whitespace-nowrap border-r py-0.5 pl-4 pr-3 text-right ${
                      isHighlighted
                        ? "border-red-500/60 text-red-300"
                        : "border-gray-800 text-gray-500"
                    }`}
                  >
                    {lineNumber}
                  </td>
                  <td
                    className={`whitespace-pre py-0.5 pl-4 pr-4 ${
                      isHighlighted
                        ? "font-medium text-red-100"
                        : "text-gray-300"
                    }`}
                  >
                    {line || " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Expanded frame detail ---

interface FrameDetailPanelProps {
  frame: ResolvedStackFrame;
}

interface FrameDetailRow {
  label: string;
  value: string;
  isMono: boolean;
  copyable: boolean;
}

const FrameDetailPanel: FunctionComponent<FrameDetailPanelProps> = ({
  frame,
}: FrameDetailPanelProps): ReactElement => {
  const location: FrameDisplayLocation = getFrameDisplayLocation(frame);
  const packageName: string | null = frame.inApp
    ? null
    : getFramePackageName(frame.fileName);

  const rows: Array<FrameDetailRow> = [
    {
      label: "Function",
      value: location.functionName || "<anonymous>",
      isMono: true,
      copyable: Boolean(location.functionName),
    },
    {
      label: "Location",
      value: formatFrameLocation(location, { shorten: false }) || "Unknown",
      isMono: true,
      copyable: Boolean(location.fileName),
    },
  ];

  /*
   * When the frame was source mapped, the rows above show the original
   * location — surface the minified one too so the two can be cross-checked
   * against the raw stack trace.
   */
  if (location.isOriginal) {
    rows.push({
      label: "Minified",
      value: formatFrameLocation(
        {
          functionName: frame.functionName,
          fileName: frame.fileName,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
          isOriginal: false,
        },
        { shorten: false },
      ),
      isMono: true,
      copyable: true,
    });
  }

  rows.push({
    label: "Origin",
    value: frame.inApp
      ? "Your application code"
      : packageName
        ? `Library code (${packageName})`
        : "Library or runtime code",
    isMono: false,
    copyable: false,
  });

  return (
    <div
      className="space-y-3 pb-4 pl-4 pr-4 sm:pl-[4.25rem]"
      data-testid="stack-frame-detail"
    >
      <dl className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-gray-200">
        {rows.map((row: FrameDetailRow): ReactElement => {
          return (
            <div
              key={row.label}
              className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-center sm:gap-4"
            >
              <dt className="text-xs font-medium text-gray-500 sm:w-20 sm:flex-shrink-0">
                {row.label}
              </dt>
              <dd className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`min-w-0 flex-1 break-all text-sm text-gray-900 ${
                    row.isMono ? "font-mono text-[13px]" : ""
                  }`}
                >
                  {row.value}
                </span>
                {row.copyable && (
                  <CopyTextButton
                    textToBeCopied={row.value}
                    iconOnly={true}
                    size="xs"
                    title={`Copy ${row.label.toLowerCase()}`}
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {/* Original source snippet, when the map carried sourcesContent */}
      {frame.sourceCodeSnippet && (
        <SourceSnippetBlock
          snippet={frame.sourceCodeSnippet}
          fileName={location.fileName}
        />
      )}
    </div>
  );
};

// --- Single frame row ---

interface FrameRowProps {
  frame: ResolvedStackFrame;
  originalIndex: number;
  isExpanded: boolean;
  isTopAppFrame: boolean;
  onToggle: () => void;
}

const FrameRow: FunctionComponent<FrameRowProps> = ({
  frame,
  originalIndex,
  isExpanded,
  isTopAppFrame,
  onToggle,
}: FrameRowProps): ReactElement => {
  const displayLocation: FrameDisplayLocation = getFrameDisplayLocation(frame);
  const location: string = formatFrameLocation(displayLocation, {
    shorten: true,
  });
  const fullLocation: string = formatFrameLocation(displayLocation, {
    shorten: false,
  });
  const packageName: string | null = frame.inApp
    ? null
    : getFramePackageName(frame.fileName);

  return (
    <li
      className={`border-l-2 ${
        isTopAppFrame
          ? "border-l-red-500 bg-red-50/40"
          : isExpanded
            ? "border-l-indigo-400 bg-gray-50/60"
            : "border-l-transparent"
      }`}
      data-testid="stack-frame"
      data-frame-index={originalIndex}
      data-in-app={frame.inApp ? "true" : "false"}
    >
      <button
        type="button"
        className="group flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span
          className={`mt-0.5 flex h-6 w-7 flex-shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${
            isTopAppFrame
              ? "bg-red-100 text-red-700"
              : frame.inApp
                ? "bg-indigo-50 text-indigo-700"
                : "bg-gray-100 text-gray-500"
          }`}
        >
          {originalIndex}
        </span>

        <Icon
          icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="mt-1.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400 group-hover:text-gray-600"
        />

        <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate font-mono text-sm ${
                isTopAppFrame
                  ? "font-semibold text-red-800"
                  : frame.inApp
                    ? "font-medium text-gray-900"
                    : "text-gray-500"
              }`}
              data-testid="stack-frame-function"
            >
              {displayLocation.functionName || "<anonymous>"}
            </span>
            {location && (
              <span
                className="mt-0.5 block truncate font-mono text-xs text-gray-500"
                title={fullLocation}
                data-testid="stack-frame-location"
              >
                {location}
              </span>
            )}
          </span>

          <span className="flex flex-shrink-0 flex-wrap items-center gap-1.5 sm:mt-0.5 sm:justify-end">
            {isTopAppFrame && (
              <FrameBadge
                label="Crash point"
                className="bg-red-50 text-red-700 ring-red-600/20"
                title="The first frame in your own code: the most likely place the error was raised."
                testId="stack-frame-badge-crash"
              />
            )}
            {frame.resolved && (
              <FrameBadge
                label="Source mapped"
                className="bg-indigo-50 text-indigo-700 ring-indigo-600/20"
                title="Resolved to original source through an uploaded source map"
                testId="stack-frame-badge-mapped"
              />
            )}
            <FrameBadge
              label={frame.inApp ? "In app" : packageName || "Library"}
              title={
                frame.inApp
                  ? "Your application code"
                  : packageName
                    ? `Library code from ${packageName}`
                    : "Library or runtime code"
              }
              className={
                frame.inApp
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                  : "bg-gray-50 text-gray-500 ring-gray-500/20"
              }
              testId="stack-frame-badge-origin"
            />
          </span>
        </span>
      </button>

      {isExpanded && <FrameDetailPanel frame={frame} />}
    </li>
  );
};

// --- Collapsed library group ---

interface CollapsedLibGroupRowProps {
  frameCount: number;
  commonPackage: string;
  onExpand: () => void;
}

const CollapsedLibGroupRow: FunctionComponent<CollapsedLibGroupRowProps> = (
  props: CollapsedLibGroupRowProps,
): ReactElement => {
  return (
    <li
      className="border-l-2 border-l-transparent bg-gray-50/40"
      data-testid="stack-frame-group"
    >
      <button
        type="button"
        className="group flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        onClick={props.onExpand}
      >
        <span className="flex h-6 w-7 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-400">
          <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
          {props.frameCount} library frame{props.frameCount === 1 ? "" : "s"}{" "}
          hidden
          {props.commonPackage && (
            <>
              {" "}
              in{" "}
              <span className="font-mono text-gray-600">
                {props.commonPackage}
              </span>
            </>
          )}
        </span>
        <span className="flex-shrink-0 text-xs font-medium text-indigo-600 group-hover:text-indigo-500">
          Show
        </span>
      </button>
    </li>
  );
};

// --- Raw stack trace ---

interface RawStackTraceProps {
  stackTrace: string;
  wrapLines: boolean;
}

const RawStackTrace: FunctionComponent<RawStackTraceProps> = ({
  stackTrace,
  wrapLines,
}: RawStackTraceProps): ReactElement => {
  const lines: Array<RawStackTraceLine> = useMemo(() => {
    return parseRawStackTraceLines(stackTrace);
  }, [stackTrace]);

  const whitespaceClassName: string = wrapLines
    ? "whitespace-pre-wrap break-all"
    : "whitespace-pre";

  return (
    <div
      className="overflow-hidden rounded-lg bg-gray-900 ring-1 ring-gray-800"
      data-testid="raw-stack-trace"
      data-wrap={wrapLines ? "true" : "false"}
    >
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full font-mono text-xs leading-5">
          <tbody>
            {lines.map((line: RawStackTraceLine): ReactElement => {
              return (
                <tr
                  key={line.lineNumber}
                  className={
                    line.kind === "message"
                      ? "bg-red-500/10"
                      : "hover:bg-white/[0.03]"
                  }
                >
                  <td className="w-[1%] select-none whitespace-nowrap border-r border-gray-800 py-0.5 pl-4 pr-3 align-top text-right text-gray-500">
                    {line.lineNumber}
                  </td>
                  <td className={`py-0.5 pl-4 pr-4 ${whitespaceClassName}`}>
                    {line.kind === "message" && (
                      <span className="font-medium text-red-300">
                        {line.text || " "}
                      </span>
                    )}
                    {line.kind === "frame" && (
                      <>
                        <span className="text-gray-500">{line.indent}at </span>
                        <span className="text-gray-100">
                          {line.functionName}
                        </span>
                        {line.location && (
                          <span className="text-gray-400">
                            {line.functionName ? " (" : ""}
                            <span className="text-sky-300">
                              {line.location}
                            </span>
                            {line.functionName ? ")" : ""}
                          </span>
                        )}
                      </>
                    )}
                    {line.kind === "other" && (
                      <span className="text-gray-300">{line.text || " "}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Toolbar button ---

interface ToolbarButtonProps {
  label: string;
  icon: IconProp;
  onClick: () => void;
  isPressed?: boolean | undefined;
  testId: string;
}

const ToolbarButton: FunctionComponent<ToolbarButtonProps> = (
  props: ToolbarButtonProps,
): ReactElement => {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.isPressed}
      data-testid={props.testId}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isPressed
          ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
          : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      <Icon icon={props.icon} className="h-3.5 w-3.5" />
      {props.label}
    </button>
  );
};

// --- Main component ---

const StackFrameViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * undefined = the user has not opened or closed a frame yet, so the crash
   * point is open by default. Several frames can be open at once, which is
   * how a caller and its callee get compared.
   */
  const [expandedFrames, setExpandedFrames] = useState<
    Set<number> | undefined
  >(undefined);
  const [viewMode, setViewMode] = useState<StackTraceViewMode>(
    StackTraceViewMode.Smart,
  );
  const [frameOrder, setFrameOrder] = useState<StackTraceFrameOrder>(
    StackTraceFrameOrder.NewestFirst,
  );
  const [tab, setTab] = useState<StackTraceTab>("frames");
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [expandedLibGroups, setExpandedLibGroups] = useState<Set<number>>(
    new Set(),
  );

  // Parse frames and overlay the source-map resolution result, if any
  const frames: Array<ResolvedStackFrame> = useMemo(() => {
    return applyResolvedFrames(
      parseFramesJson(props.parsedFrames),
      props.resolvedFrames,
    );
  }, [props.parsedFrames, props.resolvedFrames]);

  const appFrameCount: number = useMemo((): number => {
    return frames.filter((frame: ResolvedStackFrame) => {
      return frame.inApp;
    }).length;
  }, [frames]);

  const libFrameCount: number = frames.length - appFrameCount;

  const resolvedFrameCount: number = useMemo((): number => {
    return countResolvedFrames(frames);
  }, [frames]);

  const topAppFrameIndex: number = useMemo((): number => {
    return getTopAppFrameIndex(frames);
  }, [frames]);

  const displayItems: Array<StackTraceDisplayItem> = useMemo(() => {
    return orderStackTraceDisplayItems(
      buildStackTraceDisplayItems({
        frames,
        viewMode,
        expandedLibGroups,
      }),
      frameOrder,
    );
  }, [frames, viewMode, expandedLibGroups, frameOrder]);

  const headline: string | null = useMemo(() => {
    return getStackTraceHeadline(props.stackTrace);
  }, [props.stackTrace]);

  const openFrames: Set<number> =
    expandedFrames ||
    new Set<number>(topAppFrameIndex >= 0 ? [topAppFrameIndex] : []);

  const visibleFrameIndexes: Array<number> =
    getVisibleFrameIndexes(displayItems);
  const areAllVisibleFramesOpen: boolean =
    visibleFrameIndexes.length > 0 &&
    visibleFrameIndexes.every((index: number) => {
      return openFrames.has(index);
    });

  /*
   * Everything above is a hook; the no-frames branch below is not a return,
   * so frames can go from empty to populated between renders (parsedFrames
   * and resolvedFrames both arrive async) without changing the hook count.
   */
  const hasFrames: boolean = frames.length > 0;
  const activeTab: StackTraceTab = hasFrames ? tab : "raw";
  const lineCount: number = props.stackTrace.split("\n").length;

  const descriptionParts: Array<string> = hasFrames
    ? [
        `${frames.length} frame${frames.length === 1 ? "" : "s"}`,
        `${appFrameCount} in your code`,
      ]
    : [`${lineCount} line${lineCount === 1 ? "" : "s"}`];

  if (resolvedFrameCount > 0) {
    descriptionParts.push(`${resolvedFrameCount} source mapped`);
  }

  const crashFrame: ResolvedStackFrame | undefined =
    topAppFrameIndex >= 0 ? frames[topAppFrameIndex] : undefined;
  const crashLocation: FrameDisplayLocation | undefined = crashFrame
    ? getFrameDisplayLocation(crashFrame)
    : undefined;

  const toggleFrame: (index: number) => void = (index: number): void => {
    const next: Set<number> = new Set(openFrames);

    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }

    setExpandedFrames(next);
  };

  return (
    <Card
      title="Stack Trace"
      description={
        hasFrames
          ? descriptionParts.join(" · ")
          : `${descriptionParts.join(" · ")} · Structured frames were not recorded for the latest occurrence.`
      }
      rightElement={
        <CopyTextButton
          textToBeCopied={props.stackTrace}
          size="sm"
          variant="soft"
          label="Copy stack trace"
          title="Copy the raw stack trace"
        />
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {hasFrames && (
            <ExceptionSegmentedControl<StackTraceTab>
              label="Stack trace format"
              testId="stack-trace-tab"
              value={activeTab}
              onChange={setTab}
              options={[
                { value: "frames", label: "Frames" },
                { value: "raw", label: "Raw" },
              ]}
            />
          )}

          {activeTab === "frames" && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {appFrameCount > 0 && libFrameCount > 0 && (
                <ExceptionSegmentedControl<StackTraceViewMode>
                  label="Frames to show"
                  testId="stack-trace-view"
                  value={viewMode}
                  onChange={(mode: StackTraceViewMode) => {
                    setViewMode(mode);
                    setExpandedLibGroups(new Set());
                  }}
                  options={[
                    {
                      value: StackTraceViewMode.Smart,
                      label: "Smart",
                      title:
                        "Your code, with consecutive library frames folded",
                    },
                    {
                      value: StackTraceViewMode.AppOnly,
                      label: "App only",
                      hint: String(appFrameCount),
                    },
                    {
                      value: StackTraceViewMode.All,
                      label: "All",
                      hint: String(frames.length),
                    },
                  ]}
                />
              )}
              <ExceptionSegmentedControl<StackTraceFrameOrder>
                label="Frame order"
                testId="stack-trace-order"
                value={frameOrder}
                onChange={setFrameOrder}
                options={[
                  {
                    value: StackTraceFrameOrder.NewestFirst,
                    label: "Newest first",
                    title: "The crash point at the top",
                  },
                  {
                    value: StackTraceFrameOrder.OldestFirst,
                    label: "Oldest first",
                    title: "The entry point at the top",
                  },
                ]}
              />
              <ToolbarButton
                label={areAllVisibleFramesOpen ? "Collapse all" : "Expand all"}
                icon={
                  areAllVisibleFramesOpen ? IconProp.Collapse : IconProp.Expand
                }
                testId="stack-trace-expand-all"
                onClick={() => {
                  setExpandedFrames(
                    areAllVisibleFramesOpen
                      ? new Set()
                      : new Set(visibleFrameIndexes),
                  );
                }}
              />
            </div>
          )}

          {activeTab === "raw" && (
            <div className="sm:ml-auto">
              <ToolbarButton
                label="Wrap lines"
                icon={IconProp.Text}
                isPressed={wrapLines}
                testId="stack-trace-wrap"
                onClick={() => {
                  setWrapLines(!wrapLines);
                }}
              />
            </div>
          )}
        </div>

        {Boolean(props.skippedSourceMapCount) && (
          <div
            className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/20"
            data-testid="stack-trace-source-maps-skipped"
          >
            <Icon icon={IconProp.Alert} className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              {props.skippedSourceMapCount} source map
              {props.skippedSourceMapCount === 1 ? " was" : "s were"} too large
              to load, so some frames still show minified locations.
            </span>
          </div>
        )}

        {activeTab === "frames" && hasFrames && (
          <div className="-mx-5 border-y border-gray-100 md:-mx-6">
            {(headline || crashLocation) && (
              <div
                className="flex items-start gap-3 border-b border-gray-100 bg-red-50/60 px-4 py-3 md:px-6"
                data-testid="stack-trace-crash-point"
              >
                <Icon
                  icon={IconProp.Error}
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
                />
                <div className="min-w-0 flex-1 text-sm">
                  {headline && (
                    <p
                      className="break-words font-mono text-[13px] font-medium text-red-900"
                      data-testid="stack-trace-headline"
                    >
                      {headline}
                    </p>
                  )}
                  {crashLocation && (
                    <p className="mt-1 min-w-0 break-all text-red-800">
                      <span className="font-medium">
                        Most likely crash point:{" "}
                      </span>
                      <span className="font-mono font-semibold">
                        {crashLocation.functionName || "<anonymous>"}
                      </span>
                      {crashLocation.fileName && (
                        <>
                          <span className="text-red-600"> in </span>
                          <span className="font-mono">
                            {shortenFramePath(crashLocation.fileName)}
                            {crashLocation.lineNumber > 0
                              ? `:${crashLocation.lineNumber}`
                              : ""}
                          </span>
                        </>
                      )}
                    </p>
                  )}
                  {!crashLocation && (
                    <p className="mt-1 text-red-800">
                      No frame was identified as your own code; every frame
                      below is library or runtime code.
                    </p>
                  )}
                </div>
              </div>
            )}

            <ol className="divide-y divide-gray-100" aria-label="Stack frames">
              {displayItems.map(
                (
                  item: StackTraceDisplayItem,
                  displayIndex: number,
                ): ReactElement => {
                  if (item.kind === "collapsed-lib") {
                    return (
                      <CollapsedLibGroupRow
                        key={`lib-group-${item.startIndex}`}
                        frameCount={item.frames.length}
                        commonPackage={item.commonPackage}
                        onExpand={() => {
                          const next: Set<number> = new Set(expandedLibGroups);
                          next.add(item.startIndex);
                          setExpandedLibGroups(next);
                        }}
                      />
                    );
                  }

                  return (
                    <FrameRow
                      key={`frame-${item.originalIndex}-${displayIndex}`}
                      frame={item.frame}
                      originalIndex={item.originalIndex}
                      isExpanded={openFrames.has(item.originalIndex)}
                      isTopAppFrame={item.isTopAppFrame}
                      onToggle={() => {
                        toggleFrame(item.originalIndex);
                      }}
                    />
                  );
                },
              )}
            </ol>
          </div>
        )}

        {activeTab === "raw" && (
          <RawStackTrace stackTrace={props.stackTrace} wrapLines={wrapLines} />
        )}
      </div>
    </Card>
  );
};

export default StackFrameViewer;
