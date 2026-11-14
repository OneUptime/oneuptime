import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import {
  getUserFlowPageText,
  OTHER_PAGES_KEY,
  UserFlowAnalysis,
  UserFlowDirection,
  UserFlowGraph,
  UserFlowLink,
  UserFlowNode,
  UserFlowPageCount,
  UserFlowPageStats,
} from "Common/Utils/Rum/UserFlow";
import AppLink from "../AppLink/AppLink";
import { buildReplayLinkRoute } from "../SessionReplay/ReplayLinkRoute";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { buildSessionsForPageSearch } from "./UserFlowUrlState";
import {
  formatUserFlowCount,
  formatUserFlowShare,
  getUserFlowPathDirection,
  getUserFlowPathLineDirection,
  pluralizeSessions,
} from "./UserFlowFormat";
import { UserFlowSelection } from "./UserFlowMap";
import { RUM_USER_FLOW_METRIC_DESCRIPTIONS } from "../MetricDescriptions/RumMetricDescriptions";
import {
  composedValue,
  getInlineSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { joinWithArrowsInDirection } from "Common/Types/DirectionArrow";
import {
  getLineDirection,
  getOneWayLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "Common/UI/Utils/LineDirection";
import { LEFT_TO_RIGHT, ReadingDirection } from "Common/Types/ReadingDirection";

/*
 * What the map says about the page or transition that was clicked, and the
 * next moves from it: re-anchor the map on the page (forward or backward),
 * hide it, open every recorded session that visited it, or watch one of
 * the sessions that took exactly this route.
 */

export interface ComponentProps {
  selection: UserFlowSelection;
  analysis: UserFlowAnalysis;
  rumApplicationId: ObjectID;
  timeRange: RangeStartAndEndDateTime;
  onAnchor: (page: string, direction: UserFlowDirection) => void;
  onHide: (page: string) => void;
  onClose: () => void;
}

function Stat(props: {
  label: string;
  value: string;
  /* What the number means, in an (i) beside the label. */
  tooltip: string;
  hint?: string | undefined;
  tone?: "neutral" | "danger" | "warning" | undefined;
  testId?: string | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const label: string = translator.translateText(props.label) || props.label;
  const toneClass: string =
    props.tone === "danger"
      ? "text-rose-700"
      : props.tone === "warning"
        ? "text-amber-700"
        : "text-gray-900";

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2" data-testid={props.testId}>
      {/* The (i) after the label's last word (issue #7348). */}
      <p className="text-xs font-medium text-gray-500">
        <WordsWithInfoTooltip
          text={label}
          label={label}
          description={props.tooltip}
        />
      </p>
      <p className={`text-lg font-semibold ${toneClass}`}>{props.value}</p>
      {props.hint ? (
        <p className="text-xs text-gray-500">{props.hint}</p>
      ) : (
        <></>
      )}
    </div>
  );
}

function SampleSessions(props: {
  sessionIds: Array<string>;
  rumApplicationId: ObjectID;
}): ReactElement {
  const translator: Translator = useTranslator();

  if (props.sessionIds.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="user-flow-sample-sessions">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateText("Watch sessions that took this route")}
      </p>
      <ul className="flex flex-wrap gap-2">
        {props.sessionIds.map((sessionId: string): ReactElement => {
          const route: Route | null = buildReplayLinkRoute({
            rumApplicationId: props.rumApplicationId,
            sessionId: sessionId,
          });

          if (!route) {
            return <React.Fragment key={sessionId} />;
          }

          return (
            <li key={sessionId}>
              <AppLink
                to={route}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"
              >
                <Icon icon={IconProp.Play} className="h-3 w-3" />
                <span>{sessionId.slice(0, 8)}</span>
              </AppLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NeighbourList(props: {
  title: string;
  /* What the counts and shares are, in an (i) beside the title. */
  tooltip: string;
  items: Array<UserFlowPageCount>;
  total: number;
  onPick: (page: string) => void;
  testId: string;
}): ReactElement {
  const translator: Translator = useTranslator();
  const title: string = translator.translateText(props.title) || props.title;

  return (
    <div data-testid={props.testId}>
      {/*
       * The (i) sits in the title row, never inside the rows below: each
       * of those is a button that re-anchors the map.
       */}
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <WordsWithInfoTooltip
          text={title}
          label={title}
          description={props.tooltip}
          infoDataTestId={`${props.testId}-info`}
        />
      </p>
      {props.items.length === 0 ? (
        <p className="text-sm text-gray-400">
          {translator.translateText("None in this range.")}
        </p>
      ) : (
        <ul className="space-y-1">
          {props.items.map((item: UserFlowPageCount): ReactElement => {
            const share: number =
              props.total > 0 ? item.sessions / props.total : 0;
            const pageText: string = getUserFlowPageText(item.page);

            return (
              <li key={item.page}>
                <button
                  type="button"
                  className="group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-1 text-start text-sm hover:bg-indigo-50"
                  title={translator.translateTemplate(
                    "Show paths from {{page}}",
                    { page: pageText },
                  )}
                  onClick={(): void => {
                    props.onPick(item.page);
                  }}
                >
                  <span
                    className="absolute inset-y-0 start-0 bg-indigo-100/70"
                    style={{ width: `${Math.min(100, share * 100)}%` }}
                    aria-hidden="true"
                  />
                  {/*
                   * One page's path reads from the left on any page,
                   * "/home", not "home/", and "/الرئيسية" too, as it does
                   * in a transition's line.
                   */}
                  <span
                    className="relative truncate font-mono text-xs text-gray-800 group-hover:text-indigo-700"
                    dir={getUserFlowPathLineDirection(
                      item.page,
                      translator.language,
                    )}
                  >
                    {pageText}
                  </span>
                  <span className="relative shrink-0 text-xs text-gray-500">
                    {formatUserFlowCount(item.sessions, translator)}
                    {getInlineSeparator(translator.language)}
                    {formatUserFlowShare(share, translator)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function findNode(graph: UserFlowGraph, id: string): UserFlowNode | undefined {
  return graph.nodes.find((node: UserFlowNode): boolean => {
    return node.id === id;
  });
}

const UserFlowDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const graph: UserFlowGraph = props.analysis.graph;

  if (!props.selection) {
    return <></>;
  }

  const sessionListRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY] as Route,
    { modelId: props.rumApplicationId },
  );

  const sessionsForPage: (page: string) => Route | null = (
    page: string,
  ): Route | null => {
    const search: string = buildSessionsForPageSearch(page, props.timeRange);

    return search ? new Route(`${sessionListRoute.toString()}${search}`) : null;
  };

  const header: (
    title: string,
    subtitle: string,
    // The way a line read one way on every page reads: a transition, a path.
    lineDirection?: ReadingDirection | undefined,
  ) => ReactElement = (
    title: string,
    subtitle: string,
    lineDirection?: ReadingDirection | undefined,
  ): ReactElement => {
    /*
     * A page's path reads from the left on every page
     * (getUserFlowPathDirection): "/cart", not "cart/", and "/الرئيسية",
     * not "الرئيسية/", on a page read from the right, as each page in a
     * transition's line reads. A transition's line, its two pages and the
     * arrow between them, reads the map's way on every page
     * (getOneWayLineDirection): by its letters, one between two folds named
     * in Arabic or Persian, or into "/", was laid out from the right, its
     * arrow pointing back. One value with no direction of its own - the
     * fold's count of pages, the root "/" - reads the way its letters do
     * (getLineDirection). Each still starts where the page's lines do.
     */
    const titleDirection: ReadingDirection | undefined = lineDirection
      ? getOneWayLineDirection(lineDirection, translator.language)
      : getLineDirection(title, translator.language);

    return (
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            {subtitle}
          </p>
          <h3
            className={`break-all font-mono text-base font-semibold text-gray-900 ${
              titleDirection ? LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME : ""
            }`}
            dir={titleDirection}
            data-testid="user-flow-detail-title"
          >
            {title}
          </h3>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label={translator.translateText("Close details")}
          onClick={props.onClose}
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>
    );
  };

  if (props.selection.kind === "link") {
    const linkId: string = props.selection.id;
    const link: UserFlowLink | undefined = graph.links.find(
      (candidate: UserFlowLink): boolean => {
        return candidate.id === linkId;
      },
    );

    if (!link) {
      return <></>;
    }

    const source: UserFlowNode | undefined = findNode(graph, link.sourceId);
    const target: UserFlowNode | undefined = findNode(graph, link.targetId);
    // "Other pages" is the map's own name for a fold; a path is its own.
    const sourceLabel: string = source?.isOther
      ? translator.translateText(source.label) || source.label
      : source?.label || getUserFlowPageText(link.fromPage);
    const targetLabel: string = target?.isOther
      ? translator.translateText(target.label) || target.label
      : target?.label || getUserFlowPageText(link.toPage);

    return (
      <div
        className="rounded-lg border border-gray-200 bg-white p-4"
        data-testid="user-flow-detail"
        data-kind="link"
      >
        {/*
         * The map is drawn from the left on every page, so a transition is
         * named the map's way, its arrow pointing right: "/home → /cart" on
         * an Arabic page too (joinWithArrowsInDirection), whatever letters
         * its pages are named in.
         */}
        {header(
          joinWithArrowsInDirection([sourceLabel, targetLabel], LEFT_TO_RIGHT),
          translator.translateText("Transition") || "Transition",
          LEFT_TO_RIGHT,
        )}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Sessions"
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailTransitionSessions}
            value={formatUserFlowCount(link.sessions, translator)}
            testId="user-flow-detail-sessions"
          />
          <Stat
            label={translator.translateTemplate("Share of {{page}}", {
              page: sourceLabel,
            })}
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailShareOfSource}
            value={formatUserFlowShare(
              source && source.sessions > 0
                ? link.sessions / source.sessions
                : 0,
              translator,
            )}
          />
          <Stat
            label={translator.translateTemplate("Share of {{page}}", {
              page: targetLabel,
            })}
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailShareOfTarget}
            value={formatUserFlowShare(
              target && target.sessions > 0
                ? link.sessions / target.sessions
                : 0,
              translator,
            )}
          />
          <Stat
            label="Returning to a seen page"
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailReturning}
            value={formatUserFlowShare(
              link.sessions > 0 ? link.revisitSessions / link.sessions : 0,
              translator,
            )}
            tone={
              link.sessions > 0 && link.revisitSessions / link.sessions >= 0.5
                ? "warning"
                : "neutral"
            }
          />
        </div>
        <div className="flex flex-col gap-4">
          <SampleSessions
            sessionIds={link.sampleSessionIds}
            rumApplicationId={props.rumApplicationId}
          />
          <div className="flex flex-wrap gap-2">
            {link.toPage !== OTHER_PAGES_KEY ? (
              <Button
                title={translator.translateTemplate("Paths after {{page}}", {
                  page: targetLabel,
                })}
                icon={IconProp.ArrowRight}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={(): void => {
                  props.onAnchor(link.toPage, "forward");
                }}
              />
            ) : (
              <></>
            )}
            {link.fromPage !== OTHER_PAGES_KEY ? (
              <Button
                title={translator.translateTemplate("Paths before {{page}}", {
                  page: sourceLabel,
                })}
                icon={IconProp.ArrowLeft}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={(): void => {
                  props.onAnchor(link.fromPage, "backward");
                }}
              />
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    );
  }

  const nodeId: string = props.selection.id;
  const node: UserFlowNode | undefined = findNode(graph, nodeId);

  if (!node) {
    return <></>;
  }

  const columnTotal: number = graph.nodes
    .filter((candidate: UserFlowNode): boolean => {
      return candidate.step === node.step;
    })
    .reduce((sum: number, candidate: UserFlowNode): number => {
      return sum + candidate.sessions;
    }, 0);

  if (node.isOther) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white p-4"
        data-testid="user-flow-detail"
        data-kind="other"
      >
        {header(
          translator.translatePlural(
            {
              one: "{{count}} less visited page",
              other: "{{count}} less visited pages",
            },
            node.otherPages.length,
          ),
          translator.translateTemplate(
            "Other pages at this step · {{sessions}}",
            {
              sessions: composedValue((sentence: Translator): string => {
                return pluralizeSessions(node.sessions, sentence);
              }),
            },
          ),
        )}
        <NeighbourList
          title="Pages folded together (click to follow one)"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailFoldedPages}
          items={node.otherPages}
          total={node.sessions}
          testId="user-flow-other-pages"
          onPick={(page: string): void => {
            props.onAnchor(page, "forward");
          }}
        />
      </div>
    );
  }

  const stats: UserFlowPageStats | undefined = props.analysis.pages.find(
    (page: UserFlowPageStats): boolean => {
      return page.page === node.page;
    },
  );
  const sessionsLink: Route | null = sessionsForPage(node.page);
  const reachShare: number =
    graph.sessions > 0 ? node.sessions / graph.sessions : 0;
  const isBackward: boolean = graph.direction === "backward";

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4"
      data-testid="user-flow-detail"
      data-kind="node"
    >
      {header(
        node.label,
        graph.anchorPage && node.step === 0
          ? translator.translateText("Selected page") || "Selected page"
          : graph.anchorPage
            ? translator.translatePlural(
                isBackward
                  ? {
                      one: "{{count}} page before {{page}}",
                      other: "{{count}} pages before {{page}}",
                    }
                  : {
                      one: "{{count}} page after {{page}}",
                      other: "{{count}} pages after {{page}}",
                    },
                node.step,
                { page: getUserFlowPageText(graph.anchorPage) },
              )
            : translator.translateTemplate("Page {{number}} of the journey", {
                number: translator.formatNumber(node.step + 1),
              }),
        getUserFlowPathDirection(node.page),
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Sessions at this step"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailStepSessions}
          value={formatUserFlowCount(node.sessions, translator)}
          hint={translator.translateTemplate("{{share}} of the step", {
            share: formatUserFlowShare(
              columnTotal > 0 ? node.sessions / columnTotal : 0,
              translator,
            ),
          })}
          testId="user-flow-detail-sessions"
        />
        <Stat
          label={graph.anchorPage ? "Of anchored sessions" : "Of all sessions"}
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailOfAllSessions}
          value={formatUserFlowShare(reachShare, translator)}
          hint={
            node.step === 0
              ? translator.translateText("start of the map")
              : isBackward
                ? translator.translateText("came through here")
                : translator.translateText("reached this point")
          }
        />
        {isBackward ? (
          <Stat
            label="Started their session here"
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailStartedHere}
            value={formatUserFlowCount(node.terminal, translator)}
            hint={formatUserFlowShare(
              node.sessions > 0 ? node.terminal / node.sessions : 0,
              translator,
            )}
          />
        ) : (
          <Stat
            label="Left the application here"
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailLeftHere}
            value={formatUserFlowCount(node.terminal, translator)}
            hint={translator.translateTemplate("{{share}} drop-off", {
              share: formatUserFlowShare(
                node.sessions > 0 ? node.terminal / node.sessions : 0,
                translator,
              ),
            })}
            tone={
              node.sessions > 0 && node.terminal / node.sessions >= 0.5
                ? "danger"
                : "neutral"
            }
            testId="user-flow-detail-dropoff"
          />
        )}
        <Stat
          label="Hit an error here"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailErrorsHere}
          value={formatUserFlowCount(node.errorSessions, translator)}
          hint={translator.translateTemplate(
            "{{count}} frustrated (rage, dead clicks)",
            {
              count: formatUserFlowCount(node.frustrationSessions, translator),
            },
          )}
          tone={node.errorSessions > 0 ? "danger" : "neutral"}
        />
      </div>

      {stats ? (
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <NeighbourList
            title="Where they came from (whole range)"
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailCameFrom}
            items={stats.previous}
            total={stats.sessions}
            testId="user-flow-previous-pages"
            onPick={(page: string): void => {
              props.onAnchor(page, "forward");
            }}
          />
          <NeighbourList
            title="Where they went next (whole range)"
            tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailWentNext}
            items={stats.next}
            total={stats.sessions}
            testId="user-flow-next-pages"
            onPick={(page: string): void => {
              props.onAnchor(page, "forward");
            }}
          />
        </div>
      ) : (
        <></>
      )}

      <div className="flex flex-col gap-4">
        <SampleSessions
          sessionIds={node.sampleSessionIds}
          rumApplicationId={props.rumApplicationId}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            title="Paths after this page"
            icon={IconProp.ArrowRight}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="user-flow-anchor-forward"
            onClick={(): void => {
              props.onAnchor(node.page, "forward");
            }}
          />
          <Button
            title="Paths before this page"
            icon={IconProp.ArrowLeft}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="user-flow-anchor-backward"
            onClick={(): void => {
              props.onAnchor(node.page, "backward");
            }}
          />
          {graph.anchorPage !== node.page ? (
            <Button
              title="Hide this page"
              icon={IconProp.EyeSlash}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="user-flow-hide-page"
              onClick={(): void => {
                props.onHide(node.page);
              }}
            />
          ) : (
            <></>
          )}
          {sessionsLink ? (
            <AppLink
              to={sessionsLink}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
            >
              <Icon icon={IconProp.Film} className="h-4 w-4" />
              <span>
                {translator.translateText(
                  "All sessions that visited this page",
                )}
              </span>
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserFlowDetailPanel;
