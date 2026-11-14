import React, {
  FunctionComponent,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  UserFlowGraph,
  UserFlowLink,
  UserFlowNode,
} from "Common/Utils/Rum/UserFlow";
import {
  describeUserFlowColumn,
  layoutUserFlow,
  UserFlowBand,
  UserFlowLayout,
  UserFlowNodeBox,
  UserFlowStub,
} from "./UserFlowLayout";
import {
  formatUserFlowCount,
  formatUserFlowShare,
  getUserFlowPathDirection,
  pluralizeSessions,
  truncateUserFlowLabel,
} from "./UserFlowFormat";
import {
  getInlineSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { joinWithArrowsInDirection } from "Common/Types/DirectionArrow";
import { LEFT_TO_RIGHT, ReadingDirection } from "Common/Types/ReadingDirection";
import {
  getLineDirection,
  getOneWayLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "Common/UI/Utils/LineDirection";

/*
 * The flow map itself: an SVG Sankey drawn from UserFlowLayout.
 *
 * Hovering a page lights up every band into and out of it and dims the
 * rest, so one page's traffic can be followed through a busy map; hovering
 * a band names the transition. Clicking selects - the page owns the detail
 * panel - and every node and band is keyboard reachable.
 */

export type UserFlowSelection =
  | { kind: "node"; id: string }
  | { kind: "link"; id: string }
  | null;

export interface ComponentProps {
  graph: UserFlowGraph;
  selection: UserFlowSelection;
  onSelect: (selection: UserFlowSelection) => void;
}

const COLORS: {
  band: string;
  bandRevisit: string;
  exit: string;
  entry: string;
  continued: string;
  nodeFill: string;
  nodeAnchorFill: string;
  nodeStroke: string;
  nodeSelected: string;
  accent: string;
  accentAnchor: string;
  accentOther: string;
  text: string;
  mutedText: string;
  error: string;
} = {
  band: "#818cf8",
  bandRevisit: "#f59e0b",
  exit: "#f43f5e",
  entry: "#10b981",
  continued: "#94a3b8",
  nodeFill: "#ffffff",
  nodeAnchorFill: "#eef2ff",
  nodeStroke: "#e2e8f0",
  nodeSelected: "#4f46e5",
  accent: "#6366f1",
  accentAnchor: "#4338ca",
  accentOther: "#94a3b8",
  text: "#0f172a",
  mutedText: "#64748b",
  error: "#e11d48",
};

/* Most of a band's sessions went back to a page they had already seen. */
export function isMostlyRevisit(link: UserFlowLink): boolean {
  return link.sessions > 0 && link.revisitSessions / link.sessions >= 0.5;
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  /*
   * The way the title reads on every page when it is a line read one way
   * everywhere: a band's two pages and the arrow between them, and a
   * page's path (getUserFlowPathDirection). None for the fold's name, which
   * reads the way its letters do.
   */
  titleDirection?: ReadingDirection | undefined;
  lines: Array<string>;
}

function activate(
  event: KeyboardEvent<SVGGElement | SVGPathElement>,
  action: () => void,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

const UserFlowMap: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const separator: string = getInlineSeparator(translator.language);
  // "Other pages" is the map's own name for a fold; a page's path is its own.
  const labelOf: (node: UserFlowNode) => string = (
    node: UserFlowNode,
  ): string => {
    return node.isOther
      ? translator.translateText(node.label) || node.label
      : node.label;
  };
  const sessionsText: (count: number) => string = (count: number): string => {
    return pluralizeSessions(count, translator);
  };
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverLinkId, setHoverLinkId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | undefined>(
    undefined,
  );

  /*
   * The map fills its card: columns spread across a wide screen and
   * squeeze on a narrow one, and only scroll sideways past that.
   */
  useEffect(() => {
    const element: HTMLDivElement | null = containerRef.current;

    if (!element) {
      return;
    }

    const measure: () => void = (): void => {
      setAvailableWidth(Math.floor(element.clientWidth));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver(measure);

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const layout: UserFlowLayout = useMemo((): UserFlowLayout => {
    return layoutUserFlow(props.graph, { availableWidth: availableWidth });
  }, [props.graph, availableWidth]);

  /* About how many characters of a 12px label fit a node. */
  const labelChars: number = Math.max(
    12,
    Math.floor((layout.nodeWidth - 30) / 6.9),
  );

  /*
   * Tooltips follow the pointer in the container's coordinates, so they
   * stay put when the map is scrolled sideways on a narrow screen.
   */
  const pointerAt: (event: MouseEvent<Element>) => { x: number; y: number } = (
    event: MouseEvent<Element>,
  ): { x: number; y: number } => {
    const rect: DOMRect | undefined =
      containerRef.current?.getBoundingClientRect();

    return {
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0),
    };
  };

  const nodesById: Map<string, UserFlowNodeBox> = useMemo(() => {
    return new Map<string, UserFlowNodeBox>(
      layout.nodes.map((box: UserFlowNodeBox): [string, UserFlowNodeBox] => {
        return [box.node.id, box];
      }),
    );
  }, [layout]);

  const columnTotals: Map<number, number> = useMemo(() => {
    return new Map<number, number>(
      layout.columns.map((column: { step: number; sessions: number }) => {
        return [column.step, column.sessions];
      }),
    );
  }, [layout]);

  /*
   * The node the map is focused on: hover wins over selection so moving
   * the pointer explores, and leaving it falls back to what was clicked.
   */
  const focusNodeId: string | null =
    hoverNodeId ||
    (!hoverLinkId && props.selection?.kind === "node"
      ? props.selection.id
      : null);
  const focusLinkId: string | null =
    hoverLinkId ||
    (!hoverNodeId && props.selection?.kind === "link"
      ? props.selection.id
      : null);

  const isBandLit: (link: UserFlowLink) => boolean = (
    link: UserFlowLink,
  ): boolean => {
    if (focusLinkId) {
      return link.id === focusLinkId;
    }

    if (focusNodeId) {
      return link.sourceId === focusNodeId || link.targetId === focusNodeId;
    }

    return true;
  };

  const isNodeLit: (node: UserFlowNode) => boolean = (
    node: UserFlowNode,
  ): boolean => {
    if (focusLinkId) {
      const band: UserFlowBand | undefined = layout.bands.find(
        (candidate: UserFlowBand): boolean => {
          return candidate.link.id === focusLinkId;
        },
      );

      return (
        !band ||
        band.link.sourceId === node.id ||
        band.link.targetId === node.id
      );
    }

    if (focusNodeId) {
      if (node.id === focusNodeId) {
        return true;
      }

      return layout.bands.some((band: UserFlowBand): boolean => {
        return (
          (band.link.sourceId === focusNodeId &&
            band.link.targetId === node.id) ||
          (band.link.targetId === focusNodeId && band.link.sourceId === node.id)
        );
      });
    }

    return true;
  };

  const isAnyFocus: boolean = Boolean(focusNodeId || focusLinkId);

  const describeNode: (node: UserFlowNode) => Array<string> = (
    node: UserFlowNode,
  ): Array<string> => {
    const columnTotal: number = columnTotals.get(node.step) || 0;
    const lines: Array<string> = [
      `${sessionsText(node.sessions)}${separator}${translator.translateTemplate(
        "{{share}} of this step",
        {
          share: formatUserFlowShare(
            columnTotal > 0 ? node.sessions / columnTotal : 0,
            translator,
          ),
        },
      )}`,
    ];

    if (node.terminal > 0) {
      lines.push(
        props.graph.direction === "backward"
          ? translator.translateTemplate(
              "{{count}} started their session here",
              { count: formatUserFlowCount(node.terminal, translator) },
            )
          : translator.translateTemplate("{{count}} left here ({{share}})", {
              count: formatUserFlowCount(node.terminal, translator),
              share: formatUserFlowShare(
                node.terminal / node.sessions,
                translator,
              ),
            }),
      );
    }

    if (node.continued > 0) {
      lines.push(
        props.graph.direction === "backward"
          ? translator.translateTemplate("{{count}} came from further back", {
              count: formatUserFlowCount(node.continued, translator),
            })
          : translator.translateTemplate("{{count}} kept going", {
              count: formatUserFlowCount(node.continued, translator),
            }),
      );
    }

    if (node.errorSessions > 0) {
      lines.push(
        translator.translateTemplate("{{count}} hit an error on this page", {
          count: formatUserFlowCount(node.errorSessions, translator),
        }),
      );
    }

    if (node.isOther) {
      lines.push(
        translator.translatePlural(
          {
            one: "{{count}} page folded together",
            other: "{{count}} pages folded together",
          },
          node.otherPages.length,
        ),
      );
    }

    return lines;
  };

  const describeLink: (link: UserFlowLink) => Array<string> = (
    link: UserFlowLink,
  ): Array<string> => {
    const source: UserFlowNodeBox | undefined = nodesById.get(link.sourceId);
    /*
     * A tooltip's line is only drawn: its page is set apart from its words
     * (setsValuesApart), so an Arabic or Persian line names "/cart", not
     * "cart/".
     */
    const lines: Array<string> = [
      `${sessionsText(link.sessions)}${
        source
          ? `${separator}${translator.translateTemplate(
              "{{share}} of {{page}}",
              {
                share: formatUserFlowShare(
                  link.sessions / source.node.sessions,
                  translator,
                ),
                page: labelOf(source.node),
              },
              { setsValuesApart: true },
            )}`
          : ""
      }`,
    ];

    if (link.revisitSessions > 0) {
      lines.push(
        translator.translateTemplate(
          "{{share}} were returning to a page they had already seen",
          {
            share: formatUserFlowShare(
              link.revisitSessions / link.sessions,
              translator,
            ),
          },
        ),
      );
    }

    return lines;
  };

  const selectNode: (node: UserFlowNode) => void = (
    node: UserFlowNode,
  ): void => {
    const isSelected: boolean =
      props.selection?.kind === "node" && props.selection.id === node.id;

    props.onSelect(isSelected ? null : { kind: "node", id: node.id });
  };

  const selectLink: (link: UserFlowLink) => void = (
    link: UserFlowLink,
  ): void => {
    const isSelected: boolean =
      props.selection?.kind === "link" && props.selection.id === link.id;

    props.onSelect(isSelected ? null : { kind: "link", id: link.id });
  };

  const stubColor: (stub: UserFlowStub) => string = (
    stub: UserFlowStub,
  ): string => {
    if (stub.kind === "exit") {
      return COLORS.exit;
    }

    if (stub.kind === "entry") {
      return COLORS.entry;
    }

    return COLORS.continued;
  };

  const tooltipTitleDirection: ReadingDirection | undefined = !tooltip
    ? undefined
    : tooltip.titleDirection
      ? getOneWayLineDirection(tooltip.titleDirection, translator.language)
      : getLineDirection(tooltip.title, translator.language);

  return (
    <div className="relative" data-testid="user-flow-map" ref={containerRef}>
      <div className="overflow-x-auto overflow-y-hidden pb-2">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={translator.translatePlural(
            {
              one: "User flow map with {{count}} step across {{sessions}}",
              other: "User flow map with {{count}} steps across {{sessions}}",
            },
            props.graph.steps,
            { sessions: sessionsText(props.graph.sessions) },
          )}
          className="select-none"
          /*
           * The map is laid out from the left (a journey's first page, then
           * each page after it), with every label placed at a point of its
           * own. On a page read from the right a label's start was its
           * right end, so each one ran back over its column's left edge
           * ("صفحة الدخ" cut off) and every path read "home/". Drawn from
           * the left, a label starts at its point; Arabic words in it still
           * read from the right.
           */
          direction="ltr"
          data-node-width={Math.round(layout.nodeWidth)}
          onMouseMove={(event: MouseEvent<SVGSVGElement>): void => {
            if (!tooltip) {
              return;
            }

            const at: { x: number; y: number } = pointerAt(event);

            setTooltip({ ...tooltip, x: at.x, y: at.y });
          }}
          onMouseLeave={(): void => {
            setHoverNodeId(null);
            setHoverLinkId(null);
            setTooltip(null);
          }}
        >
          <defs>
            <linearGradient
              id="user-flow-fade-right"
              x1="0"
              x2="1"
              y1="0"
              y2="0"
            >
              <stop offset="0" stopColor={COLORS.continued} stopOpacity={0.9} />
              <stop offset="1" stopColor={COLORS.continued} stopOpacity={0} />
            </linearGradient>
            <linearGradient
              id="user-flow-fade-left"
              x1="1"
              x2="0"
              y1="0"
              y2="0"
            >
              <stop offset="0" stopColor={COLORS.continued} stopOpacity={0.9} />
              <stop offset="1" stopColor={COLORS.continued} stopOpacity={0} />
            </linearGradient>
          </defs>

          {layout.columns.map(
            (column: {
              step: number;
              x: number;
              label: string;
              sessions: number;
            }): ReactElement => {
              return (
                <g key={`column-${column.step}`}>
                  <text
                    x={column.x}
                    y={16}
                    fontSize={11}
                    fontWeight={600}
                    fill={COLORS.mutedText}
                    style={{ textTransform: "uppercase", letterSpacing: 0.4 }}
                  >
                    {describeUserFlowColumn(
                      column.step,
                      props.graph,
                      translator,
                    )}
                  </text>
                  <text
                    x={column.x}
                    y={29}
                    fontSize={11}
                    fill={COLORS.mutedText}
                  >
                    {sessionsText(column.sessions)}
                  </text>
                </g>
              );
            },
          )}

          <g>
            {layout.bands.map((band: UserFlowBand): ReactElement => {
              const lit: boolean = isBandLit(band.link);
              const selected: boolean =
                props.selection?.kind === "link" &&
                props.selection.id === band.link.id;
              const source: UserFlowNodeBox | undefined = nodesById.get(
                band.link.sourceId,
              );
              const target: UserFlowNodeBox | undefined = nodesById.get(
                band.link.targetId,
              );

              return (
                <path
                  key={band.link.id}
                  d={band.path}
                  fill={
                    isMostlyRevisit(band.link)
                      ? COLORS.bandRevisit
                      : COLORS.band
                  }
                  fillOpacity={
                    selected ? 0.75 : lit ? (isAnyFocus ? 0.6 : 0.32) : 0.08
                  }
                  stroke={selected ? COLORS.nodeSelected : "none"}
                  strokeWidth={selected ? 1 : 0}
                  className="cursor-pointer outline-none transition-[fill-opacity] duration-150 focus-visible:[stroke:#4f46e5] focus-visible:[stroke-width:2]"
                  tabIndex={0}
                  role="button"
                  aria-label={translator.translateTemplate(
                    "{{from}} to {{to}}: {{sessions}}",
                    {
                      from: source ? labelOf(source.node) : "",
                      to: target ? labelOf(target.node) : "",
                      sessions: sessionsText(band.link.sessions),
                    },
                  )}
                  data-testid="user-flow-link"
                  data-from={band.link.fromPage}
                  data-to={band.link.toPage}
                  data-sessions={band.link.sessions}
                  onMouseEnter={(event: MouseEvent<SVGPathElement>): void => {
                    const at: { x: number; y: number } = pointerAt(event);

                    setHoverLinkId(band.link.id);
                    setHoverNodeId(null);
                    /*
                     * The map runs left to right on every page, so its
                     * band is named the map's way, and read that way
                     * whatever letters its pages are named in:
                     * "/home → /cart".
                     */
                    setTooltip({
                      x: at.x,
                      y: at.y,
                      title: joinWithArrowsInDirection(
                        [
                          source ? labelOf(source.node) : "",
                          target ? labelOf(target.node) : "",
                        ],
                        LEFT_TO_RIGHT,
                      ),
                      titleDirection: LEFT_TO_RIGHT,
                      lines: describeLink(band.link),
                    });
                  }}
                  onMouseLeave={(): void => {
                    setHoverLinkId(null);
                    setTooltip(null);
                  }}
                  onClick={(): void => {
                    selectLink(band.link);
                  }}
                  onKeyDown={(event: KeyboardEvent<SVGPathElement>): void => {
                    activate(event, (): void => {
                      selectLink(band.link);
                    });
                  }}
                />
              );
            })}
          </g>

          <g>
            {layout.stubs.map((stub: UserFlowStub): ReactElement => {
              const lit: boolean = !focusNodeId || stub.nodeId === focusNodeId;

              return (
                <path
                  key={`${stub.kind}-${stub.nodeId}`}
                  d={stub.path}
                  fill={
                    stub.kind === "continued"
                      ? `url(#${
                          props.graph.direction === "backward"
                            ? "user-flow-fade-left"
                            : "user-flow-fade-right"
                        })`
                      : stubColor(stub)
                  }
                  fillOpacity={focusLinkId ? 0.08 : lit ? 0.45 : 0.08}
                  data-testid={`user-flow-stub-${stub.kind}`}
                  data-sessions={stub.sessions}
                  pointerEvents="none"
                />
              );
            })}
          </g>

          <g>
            {layout.nodes.map((box: UserFlowNodeBox): ReactElement => {
              const node: UserFlowNode = box.node;
              const lit: boolean = isNodeLit(node);
              const selected: boolean =
                props.selection?.kind === "node" &&
                props.selection.id === node.id;
              const isAnchor: boolean =
                Boolean(props.graph.anchorPage) &&
                node.step === 0 &&
                !node.isOther;
              const columnTotal: number = columnTotals.get(node.step) || 0;
              const accent: string = node.isOther
                ? COLORS.accentOther
                : isAnchor
                  ? COLORS.accentAnchor
                  : COLORS.accent;
              /*
               * A tall node reads like a card: its name at the top, where
               * the eye enters it. A short one centres the two lines.
               */
              const labelY: number =
                box.height >= 72 ? box.y + 21 : box.y + box.height / 2 - 1;

              return (
                <g
                  key={node.id}
                  opacity={lit ? 1 : 0.35}
                  className="cursor-pointer outline-none [&:focus-visible>rect:first-of-type]:[stroke:#4f46e5] [&:focus-visible>rect:first-of-type]:[stroke-width:2]"
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected}
                  aria-label={`${labelOf(node)}, ${sessionsText(
                    node.sessions,
                  )}`}
                  data-testid="user-flow-node"
                  data-page={node.page}
                  data-step={node.step}
                  data-sessions={node.sessions}
                  onMouseEnter={(event: MouseEvent<SVGGElement>): void => {
                    const at: { x: number; y: number } = pointerAt(event);

                    setHoverNodeId(node.id);
                    setHoverLinkId(null);
                    setTooltip({
                      x: at.x,
                      y: at.y,
                      title: labelOf(node),
                      titleDirection: node.isOther
                        ? undefined
                        : getUserFlowPathDirection(node.page),
                      lines: describeNode(node),
                    });
                  }}
                  onMouseLeave={(): void => {
                    setHoverNodeId(null);
                    setTooltip(null);
                  }}
                  onClick={(): void => {
                    selectNode(node);
                  }}
                  onKeyDown={(event: KeyboardEvent<SVGGElement>): void => {
                    activate(event, (): void => {
                      selectNode(node);
                    });
                  }}
                >
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    rx={8}
                    fill={isAnchor ? COLORS.nodeAnchorFill : COLORS.nodeFill}
                    stroke={selected ? COLORS.nodeSelected : COLORS.nodeStroke}
                    strokeWidth={selected ? 2 : 1}
                  />
                  <rect
                    x={box.x}
                    y={box.y}
                    width={5}
                    height={box.height}
                    rx={2}
                    fill={accent}
                  />
                  <text
                    x={box.x + 14}
                    y={labelY}
                    fontSize={12}
                    fontWeight={600}
                    fill={node.isOther ? COLORS.mutedText : COLORS.text}
                    fontStyle={node.isOther ? "italic" : "normal"}
                  >
                    {truncateUserFlowLabel(labelOf(node), labelChars)}
                    <title>{labelOf(node)}</title>
                  </text>
                  <text
                    x={box.x + 14}
                    y={labelY + 15}
                    fontSize={11}
                    fill={COLORS.mutedText}
                  >
                    {formatUserFlowCount(node.sessions, translator)}
                    {separator}
                    {formatUserFlowShare(
                      columnTotal > 0 ? node.sessions / columnTotal : 0,
                      translator,
                    )}
                  </text>
                  {node.errorSessions > 0 ? (
                    <g data-testid="user-flow-node-errors">
                      <circle
                        cx={box.x + box.width - 14}
                        cy={box.y + 13}
                        r={4}
                        fill={COLORS.error}
                      />
                      <title>
                        {translator.translatePlural(
                          {
                            one: "{{count}} session hit an error on this page",
                            other:
                              "{{count}} sessions hit an error on this page",
                          },
                          node.errorSessions,
                        )}
                      </title>
                    </g>
                  ) : (
                    <></>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-xs -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y + 16 }}
          role="tooltip"
          data-testid="user-flow-tooltip"
        >
          {/*
           * A band's "/cart → /home" reads from the left on any page,
           * whatever letters its pages are named in, and so does a page's
           * path, "/" first; the fold's name, the way its letters do.
           * Either starts where the page's lines do, as the lines under it.
           */}
          <p
            className={`mb-1 break-all font-semibold ${
              tooltipTitleDirection ? LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME : ""
            }`}
            dir={tooltipTitleDirection}
          >
            {tooltip.title}
          </p>
          {tooltip.lines.map((line: string): ReactElement => {
            return (
              <p key={line} className="text-gray-200">
                {line}
              </p>
            );
          })}
        </div>
      ) : (
        <></>
      )}

      <div
        className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500"
        data-testid="user-flow-legend"
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-5 rounded-sm"
            style={{ backgroundColor: COLORS.band, opacity: 0.6 }}
          />
          {translator.translateText(
            "Sessions moving between pages (thickness = sessions)",
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-5 rounded-sm"
            style={{ backgroundColor: COLORS.bandRevisit, opacity: 0.6 }}
          />
          {translator.translateText("Mostly returning to a page already seen")}
        </span>
        {props.graph.direction === "backward" ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-5 rounded-sm"
              style={{ backgroundColor: COLORS.entry, opacity: 0.6 }}
            />
            {translator.translateText("Session started here")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-5 rounded-sm"
              style={{ backgroundColor: COLORS.exit, opacity: 0.6 }}
            />
            {translator.translateText("Left the application here")}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-5 rounded-sm"
            style={{ backgroundColor: COLORS.continued, opacity: 0.6 }}
          />
          {translator.translateText("Journey continues beyond the map")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: COLORS.error }}
          />
          {translator.translateText("Errors on this page")}
        </span>
      </div>
    </div>
  );
};

export default UserFlowMap;
