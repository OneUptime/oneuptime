import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useMemo,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import { Green500, Gray500, Red500 } from "Common/Types/BrandColors";

export interface StackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
  inApp: boolean;
}

export interface ComponentProps {
  stackTrace: string;
  parsedFrames?: string; // JSON stringified StackFrame[]
}

// --- Types for display items ---

// A single visible frame in the list
interface DisplayFrame {
  kind: "frame";
  frame: StackFrame;
  originalIndex: number;
  isTopAppFrame: boolean;
}

// A collapsed group of consecutive library frames
interface CollapsedLibraryGroup {
  kind: "collapsed-lib";
  frames: Array<{ frame: StackFrame; originalIndex: number }>;
  startIndex: number;
}

type DisplayItem = DisplayFrame | CollapsedLibraryGroup;

// --- View mode ---

enum ViewMode {
  Smart = "smart",
  All = "all",
  AppOnly = "app",
}

// --- Helpers ---

type GetFileExtensionFunction = (fileName: string) => string;

const getFileExtension: GetFileExtensionFunction = (
  fileName: string,
): string => {
  const parts: string[] = fileName.split(".");
  return parts.length > 1 ? parts[parts.length - 1]! : "";
};

type GetLanguageIconFunction = (fileName: string) => IconProp;

const getLanguageIcon: GetLanguageIconFunction = (
  fileName: string,
): IconProp => {
  const ext: string = getFileExtension(fileName).toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "mjs":
    case "cjs":
      return IconProp.Code;
    case "py":
    case "pyx":
      return IconProp.Code;
    case "go":
      return IconProp.Code;
    case "java":
    case "kt":
    case "scala":
      return IconProp.Code;
    case "rb":
      return IconProp.Code;
    case "cs":
    case "fs":
      return IconProp.Code;
    case "php":
      return IconProp.Code;
    case "rs":
      return IconProp.Code;
    default:
      return IconProp.File;
  }
};

type ShortenPathFunction = (fullPath: string) => string;

const shortenPath: ShortenPathFunction = (fullPath: string): string => {
  if (!fullPath) {
    return "";
  }
  const parts: string[] = fullPath.split("/");
  if (parts.length <= 3) {
    return fullPath;
  }
  // Show last 3 path segments
  return ".../" + parts.slice(-3).join("/");
};

type FormatLocationFunction = (frame: StackFrame) => string;

const formatLocation: FormatLocationFunction = (frame: StackFrame): string => {
  const path: string = shortenPath(frame.fileName);
  if (!frame.lineNumber || frame.lineNumber <= 0) {
    return path;
  }
  return `${path}:${frame.lineNumber}${frame.columnNumber ? `:${frame.columnNumber}` : ""}`;
};

type FormatFullLocationFunction = (frame: StackFrame) => string;

const formatFullLocation: FormatFullLocationFunction = (
  frame: StackFrame,
): string => {
  if (!frame.lineNumber || frame.lineNumber <= 0) {
    return frame.fileName;
  }
  return `${frame.fileName}:${frame.lineNumber}${frame.columnNumber ? `:${frame.columnNumber}` : ""}`;
};

// --- Sub-component: Frame number badge ---

interface FrameNumberBadgeProps {
  index: number;
  isTopAppFrame: boolean;
  inApp: boolean;
}

const FrameNumberBadge: FunctionComponent<FrameNumberBadgeProps> = ({
  index,
  isTopAppFrame,
  inApp,
}: FrameNumberBadgeProps): ReactElement => {
  if (isTopAppFrame) {
    return (
      <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-red-700">{index}</span>
      </div>
    );
  }

  if (inApp) {
    return (
      <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-semibold text-indigo-600">{index}</span>
      </div>
    );
  }

  return (
    <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-medium text-gray-400">{index}</span>
    </div>
  );
};

// --- Sub-component: Expanded frame detail ---

interface FrameDetailPanelProps {
  frame: StackFrame;
  isTopAppFrame: boolean;
}

const FrameDetailPanel: FunctionComponent<FrameDetailPanelProps> = ({
  frame,
  isTopAppFrame,
}: FrameDetailPanelProps): ReactElement => {
  const rows: Array<{
    label: string;
    value: string;
    mono: boolean;
    highlight: boolean;
  }> = [];

  rows.push({
    label: "Function",
    value: frame.functionName || "<anonymous>",
    mono: true,
    highlight: true,
  });

  rows.push({
    label: "File",
    value: frame.fileName || "Unknown",
    mono: true,
    highlight: false,
  });

  if (frame.lineNumber && frame.lineNumber > 0) {
    const lineStr: string = frame.columnNumber
      ? `${frame.lineNumber}:${frame.columnNumber}`
      : `${frame.lineNumber}`;
    rows.push({
      label: "Line",
      value: lineStr,
      mono: true,
      highlight: true,
    });
  }

  rows.push({
    label: "Origin",
    value: frame.inApp ? "Application Code" : "Library / Framework",
    mono: false,
    highlight: false,
  });

  return (
    <div className="ml-12 mr-4 mb-3 mt-1">
      <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800/60 border-b border-gray-700/50">
          <div className="flex items-center gap-2">
            <Icon
              icon={getLanguageIcon(frame.fileName)}
              size={SizeProp.Smaller}
              className="text-gray-400"
            />
            <span className="text-xs font-mono text-gray-300 truncate">
              {frame.fileName || "unknown"}
            </span>
          </div>
          <CopyableButton textToBeCopied={formatFullLocation(frame)} />
        </div>

        {/* Detail rows */}
        <div className="divide-y divide-gray-800/50">
          {rows.map(
            (
              row: {
                label: string;
                value: string;
                mono: boolean;
                highlight: boolean;
              },
              i: number,
            ): ReactElement => {
              return (
                <div
                  key={i}
                  className={`flex px-4 py-2 ${
                    row.highlight && isTopAppFrame ? "bg-red-950/20" : ""
                  }`}
                >
                  <span className="text-xs text-gray-500 w-20 flex-shrink-0 pt-0.5">
                    {row.label}
                  </span>
                  <span
                    className={`text-sm break-all ${
                      row.mono ? "font-mono" : ""
                    } ${
                      row.highlight && isTopAppFrame
                        ? "text-red-300 font-medium"
                        : "text-gray-200"
                    }`}
                  >
                    {row.value}
                  </span>
                </div>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
};

// --- Sub-component: Single frame row ---

interface FrameRowProps {
  frame: StackFrame;
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
  const location: string = formatLocation(frame);

  return (
    <div
      className={`transition-colors ${
        isTopAppFrame
          ? "bg-red-50/60 border-l-2 border-l-red-400"
          : isExpanded
            ? "bg-gray-50/80 border-l-2 border-l-indigo-300"
            : "border-l-2 border-l-transparent hover:bg-gray-50/50"
      }`}
    >
      {/* Clickable row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer group"
        onClick={onToggle}
      >
        {/* Frame number */}
        <FrameNumberBadge
          index={originalIndex}
          isTopAppFrame={isTopAppFrame}
          inApp={frame.inApp}
        />

        {/* Chevron */}
        <Icon
          icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
          size={SizeProp.ExtraSmall}
          className={`flex-shrink-0 transition-colors ${
            isExpanded
              ? "text-gray-500"
              : "text-gray-300 group-hover:text-gray-400"
          }`}
        />

        {/* Function name */}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span
            className={`font-mono text-sm truncate ${
              isTopAppFrame
                ? "text-red-800 font-semibold"
                : frame.inApp
                  ? "text-gray-900 font-medium"
                  : "text-gray-500"
            }`}
          >
            {frame.functionName || "<anonymous>"}
          </span>

          {/* File location */}
          {location && (
            <Tooltip text={formatFullLocation(frame)}>
              <span className="text-xs font-mono text-gray-400 truncate flex-shrink-0 max-w-[280px]">
                {location}
              </span>
            </Tooltip>
          )}
        </div>

        {/* APP / LIB pill */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {isTopAppFrame && (
            <Pill
              text="CRASH"
              color={Red500}
              size={PillSize.Small}
              icon={IconProp.Error}
              tooltip="This is the most likely crash point"
            />
          )}
          <Pill
            text={frame.inApp ? "APP" : "LIB"}
            color={frame.inApp ? Green500 : Gray500}
            size={PillSize.Small}
          />
        </div>
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <FrameDetailPanel frame={frame} isTopAppFrame={isTopAppFrame} />
      )}
    </div>
  );
};

// --- Sub-component: Collapsed library group ---

interface CollapsedLibGroupRowProps {
  group: CollapsedLibraryGroup;
  onExpand: () => void;
}

const CollapsedLibGroupRow: FunctionComponent<CollapsedLibGroupRowProps> = ({
  group,
  onExpand,
}: CollapsedLibGroupRowProps): ReactElement => {
  const count: number = group.frames.length;
  const firstFrame: StackFrame = group.frames[0]!.frame;
  const lastFrame: StackFrame = group.frames[count - 1]!.frame;

  // Try to find a common path prefix
  const firstDir: string = firstFrame.fileName
    ? firstFrame.fileName.split("/").slice(0, -1).join("/")
    : "";
  const lastDir: string = lastFrame.fileName
    ? lastFrame.fileName.split("/").slice(0, -1).join("/")
    : "";
  const commonPackage: string =
    firstDir === lastDir ? shortenPath(firstDir) : "";

  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer hover:bg-gray-50/50 border-l-2 border-l-transparent group"
      onClick={onExpand}
    >
      {/* Expand icon area */}
      <div className="w-7 h-5 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
        <Icon
          icon={IconProp.EllipsisHorizontal}
          size={SizeProp.ExtraSmall}
          className="text-gray-400"
        />
      </div>

      <Icon
        icon={IconProp.ChevronRight}
        size={SizeProp.ExtraSmall}
        className="flex-shrink-0 text-gray-300 group-hover:text-gray-400"
      />

      <span className="text-xs text-gray-400 italic">
        {count} library frame{count !== 1 ? "s" : ""}
        {commonPackage && (
          <span className="text-gray-300 ml-1">
            in <span className="font-mono not-italic">{commonPackage}</span>
          </span>
        )}
      </span>

      <span className="text-[10px] text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
        Click to expand
      </span>
    </button>
  );
};

// --- Sub-component: View mode toggle ---

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onChangeMode: (mode: ViewMode) => void;
  totalFrames: number;
  appFrameCount: number;
  libFrameCount: number;
}

const ViewModeToggle: FunctionComponent<ViewModeToggleProps> = ({
  viewMode,
  onChangeMode,
  totalFrames,
  appFrameCount,
  libFrameCount,
}: ViewModeToggleProps): ReactElement => {
  interface ModeOption {
    mode: ViewMode;
    label: string;
    sublabel: string;
  }

  const modes: ModeOption[] = [
    {
      mode: ViewMode.Smart,
      label: "Smart",
      sublabel: `${appFrameCount} app + grouped lib`,
    },
    {
      mode: ViewMode.AppOnly,
      label: "App Only",
      sublabel: `${appFrameCount} frames`,
    },
    {
      mode: ViewMode.All,
      label: "All",
      sublabel: `${totalFrames} frames`,
    },
  ];

  return (
    <div className="flex items-center gap-1 px-5 py-2.5 border-b border-gray-100 bg-gray-50/50">
      <span className="text-xs font-medium text-gray-500 mr-2">View:</span>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
        {modes.map((opt: ModeOption): ReactElement => {
          const isActive: boolean = viewMode === opt.mode;
          const isDisabled: boolean =
            opt.mode === ViewMode.AppOnly && appFrameCount === 0;

          return (
            <Tooltip key={opt.mode} text={opt.sublabel}>
              <button
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : isDisabled
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-600 hover:bg-gray-50 cursor-pointer"
                }`}
                onClick={() => {
                  if (!isDisabled) {
                    onChangeMode(opt.mode);
                  }
                }}
                disabled={isDisabled}
              >
                {opt.label}
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Quick summary badges */}
      <div className="flex items-center gap-2 ml-auto">
        {appFrameCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            <span
              className="w-1.5 h-1.5 rounded-full bg-green-500"
              aria-hidden="true"
            />
            {appFrameCount} app
          </span>
        )}
        {libFrameCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            <span
              className="w-1.5 h-1.5 rounded-full bg-gray-400"
              aria-hidden="true"
            />
            {libFrameCount} lib
          </span>
        )}
      </div>
    </div>
  );
};

// --- Raw stack trace viewer ---

interface RawStackTraceProps {
  stackTrace: string;
  isStandalone: boolean; // true when no parsed frames available
}

const RawStackTraceViewer: FunctionComponent<RawStackTraceProps> = ({
  stackTrace,
  isStandalone,
}: RawStackTraceProps): ReactElement => {
  // Split into lines for line numbers
  const lines: string[] = stackTrace.split("\n");

  if (isStandalone) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800/60 border-b border-gray-700/50">
          <div className="flex items-center gap-2">
            <Icon
              icon={IconProp.Terminal}
              size={SizeProp.Smaller}
              className="text-gray-400"
            />
            <span className="text-xs font-medium text-gray-300">
              Raw Stack Trace
            </span>
          </div>
          <CopyableButton textToBeCopied={stackTrace} />
        </div>
        {/* Lines with line numbers */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <tbody>
              {lines.map((line: string, i: number): ReactElement => {
                const isErrorLine: boolean =
                  line.trimStart().startsWith("at ") === false && i === 0;
                return (
                  <tr
                    key={i}
                    className={`${
                      isErrorLine ? "bg-red-950/30" : "hover:bg-gray-800/50"
                    }`}
                  >
                    <td className="text-gray-600 text-right pr-4 pl-4 py-0.5 select-none w-[1%] whitespace-nowrap border-r border-gray-800">
                      {i + 1}
                    </td>
                    <td
                      className={`pl-4 pr-4 py-0.5 whitespace-pre ${
                        isErrorLine
                          ? "text-red-300 font-medium"
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
  }

  // Inline collapsible version when parsed frames are available
  return (
    <div className="border-t border-gray-100">
      <details>
        <summary className="flex items-center gap-2 px-5 py-3 text-sm text-gray-400 cursor-pointer hover:text-gray-600 hover:bg-gray-50/50 transition-colors select-none">
          <Icon icon={IconProp.Terminal} size={SizeProp.Smaller} />
          <span>Raw Stack Trace</span>
          <span className="text-[10px] text-gray-300 ml-1">
            ({lines.length} lines)
          </span>
          <div className="ml-auto">
            <CopyableButton textToBeCopied={stackTrace} />
          </div>
        </summary>
        <div className="mx-4 mb-4 rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <tbody>
                {lines.map((line: string, i: number): ReactElement => {
                  return (
                    <tr key={i} className="hover:bg-gray-800/50">
                      <td className="text-gray-600 text-right pr-4 pl-4 py-0.5 select-none w-[1%] whitespace-nowrap border-r border-gray-800">
                        {i + 1}
                      </td>
                      <td className="pl-4 pr-4 py-0.5 whitespace-pre text-gray-300">
                        {line || " "}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
};

// --- Main component ---

const StackFrameViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [expandedFrameIndex, setExpandedFrameIndex] = useState<number | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Smart);
  const [expandedLibGroups, setExpandedLibGroups] = useState<Set<number>>(
    new Set(),
  );

  // Parse frames
  const frames: StackFrame[] = useMemo((): StackFrame[] => {
    try {
      if (props.parsedFrames) {
        return JSON.parse(props.parsedFrames) as StackFrame[];
      }
    } catch {
      // fall through
    }
    return [];
  }, [props.parsedFrames]);

  // Frame counts
  const appFrameCount: number = useMemo((): number => {
    return frames.filter((f: StackFrame) => {
      return f.inApp;
    }).length;
  }, [frames]);

  const libFrameCount: number = frames.length - appFrameCount;

  // Find the topmost app frame (most likely crash point)
  const topAppFrameIndex: number = useMemo((): number => {
    for (let i: number = 0; i < frames.length; i++) {
      if (frames[i]!.inApp) {
        return i;
      }
    }
    return -1;
  }, [frames]);

  // No parsed frames — show raw only
  if (frames.length === 0) {
    return (
      <Card
        title="Stack Trace"
        description="Raw stack trace from the exception."
      >
        <div className="overflow-hidden">
          <RawStackTraceViewer
            stackTrace={props.stackTrace}
            isStandalone={true}
          />
        </div>
      </Card>
    );
  }

  // Build display items based on view mode
  const displayItems: DisplayItem[] = useMemo((): DisplayItem[] => {
    if (viewMode === ViewMode.AppOnly) {
      // Only app frames, flat list
      return frames
        .map((frame: StackFrame, index: number): DisplayItem | null => {
          if (!frame.inApp) {
            return null;
          }
          return {
            kind: "frame",
            frame: frame,
            originalIndex: index,
            isTopAppFrame: index === topAppFrameIndex,
          } as DisplayFrame;
        })
        .filter((item: DisplayItem | null): item is DisplayItem => {
          return item !== null;
        });
    }

    if (viewMode === ViewMode.All) {
      // All frames, flat list
      return frames.map((frame: StackFrame, index: number): DisplayItem => {
        return {
          kind: "frame",
          frame: frame,
          originalIndex: index,
          isTopAppFrame: index === topAppFrameIndex,
        } as DisplayFrame;
      });
    }

    // Smart view: app frames shown, consecutive lib frames collapsed
    const items: DisplayItem[] = [];
    let currentLibGroup: Array<{
      frame: StackFrame;
      originalIndex: number;
    }> = [];
    let libGroupStartIndex: number = 0;

    type FlushLibGroupFunction = () => void;

    const flushLibGroup: FlushLibGroupFunction = (): void => {
      if (currentLibGroup.length === 0) {
        return;
      }

      // If this group is expanded or has only 1 frame, show individually
      if (
        expandedLibGroups.has(libGroupStartIndex) ||
        currentLibGroup.length === 1
      ) {
        for (const item of currentLibGroup) {
          items.push({
            kind: "frame",
            frame: item.frame,
            originalIndex: item.originalIndex,
            isTopAppFrame: false,
          } as DisplayFrame);
        }
      } else {
        items.push({
          kind: "collapsed-lib",
          frames: [...currentLibGroup],
          startIndex: libGroupStartIndex,
        } as CollapsedLibraryGroup);
      }
      currentLibGroup = [];
    };

    for (let i: number = 0; i < frames.length; i++) {
      const frame: StackFrame = frames[i]!;
      if (frame.inApp) {
        flushLibGroup();
        items.push({
          kind: "frame",
          frame: frame,
          originalIndex: i,
          isTopAppFrame: i === topAppFrameIndex,
        } as DisplayFrame);
      } else {
        if (currentLibGroup.length === 0) {
          libGroupStartIndex = i;
        }
        currentLibGroup.push({ frame, originalIndex: i });
      }
    }
    flushLibGroup();

    return items;
  }, [frames, viewMode, topAppFrameIndex, expandedLibGroups]);

  return (
    <Card title="Stack Trace" description={`${frames.length} frames traced`}>
      <div className="overflow-hidden">
        {/* View mode toggle bar */}
        {appFrameCount > 0 && libFrameCount > 0 && (
          <ViewModeToggle
            viewMode={viewMode}
            onChangeMode={(mode: ViewMode) => {
              setViewMode(mode);
              setExpandedFrameIndex(null);
              setExpandedLibGroups(new Set());
            }}
            totalFrames={frames.length}
            appFrameCount={appFrameCount}
            libFrameCount={libFrameCount}
          />
        )}

        {/* Crash point summary bar */}
        {topAppFrameIndex >= 0 && (
          <div className="flex items-center gap-2 px-5 py-2 border-b border-red-100 bg-red-50/40">
            <Icon
              icon={IconProp.Error}
              size={SizeProp.Smaller}
              color={Red500}
              thick={ThickProp.LessThick}
            />
            <span className="text-xs text-red-700">
              <span className="font-semibold">Crash point:</span>{" "}
              <span className="font-mono">
                {frames[topAppFrameIndex]!.functionName || "<anonymous>"}
              </span>{" "}
              <span className="text-red-500">
                in {shortenPath(frames[topAppFrameIndex]!.fileName)}
                {frames[topAppFrameIndex]!.lineNumber > 0
                  ? `:${frames[topAppFrameIndex]!.lineNumber}`
                  : ""}
              </span>
            </span>
          </div>
        )}

        {/* Frames list */}
        <div className="divide-y divide-gray-100/80">
          {displayItems.map(
            (item: DisplayItem, displayIndex: number): ReactElement => {
              if (item.kind === "collapsed-lib") {
                return (
                  <CollapsedLibGroupRow
                    key={`lib-group-${item.startIndex}`}
                    group={item}
                    onExpand={() => {
                      const next: Set<number> = new Set(expandedLibGroups);
                      next.add(item.startIndex);
                      setExpandedLibGroups(next);
                    }}
                  />
                );
              }

              const frameItem: DisplayFrame = item;
              return (
                <FrameRow
                  key={`frame-${frameItem.originalIndex}-${displayIndex}`}
                  frame={frameItem.frame}
                  originalIndex={frameItem.originalIndex}
                  isExpanded={expandedFrameIndex === frameItem.originalIndex}
                  isTopAppFrame={frameItem.isTopAppFrame}
                  onToggle={() => {
                    setExpandedFrameIndex(
                      expandedFrameIndex === frameItem.originalIndex
                        ? null
                        : frameItem.originalIndex,
                    );
                  }}
                />
              );
            },
          )}
        </div>

        {/* Raw stack trace collapsible */}
        <RawStackTraceViewer
          stackTrace={props.stackTrace}
          isStandalone={false}
        />
      </div>
    </Card>
  );
};

export default StackFrameViewer;
