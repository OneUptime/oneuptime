import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import {
  getUserFlowPageText,
  UserFlowDirection,
  UserFlowInsight,
  UserFlowSummary,
} from "Common/Utils/Rum/UserFlow";
import {
  formatUserFlowCount,
  formatUserFlowSessionsHint,
  formatUserFlowShare,
  getUserFlowPathLineDirection,
  truncateUserFlowLabel,
} from "./UserFlowFormat";
import { UserFlowScope } from "./UserFlowScope";
import { RUM_USER_FLOW_METRIC_DESCRIPTIONS } from "../MetricDescriptions/RumMetricDescriptions";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getNumberLocale } from "Common/Types/DateLanguage";
import {
  getTranslatedLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "Common/UI/Utils/LineDirection";
import { ReadingDirection } from "Common/Types/ReadingDirection";

/*
 * Findings shown at once. The engine orders them by how much they should
 * worry someone, and the fifth is always the neutral landing-page note,
 * which the "Top landing page" tile already says.
 */
export const USER_FLOW_MAX_VISIBLE_INSIGHTS: number = 4;

/* A tile's label and hint: two lines at most, never cut mid-word. */
export const USER_FLOW_TILE_LABEL_CLASS_NAME: string =
  "min-w-0 line-clamp-2 hyphens-auto break-words";
export const USER_FLOW_TILE_HINT_CLASS_NAME: string =
  "line-clamp-2 hyphens-auto break-words text-xs text-gray-500";

/*
 * The strip above the map: how many sessions the map is drawn from, how
 * far people get, and the findings worth reading first. Every finding is a
 * button that points the map at the page it is about, in the direction the
 * finding names (see UserFlowInsight.focusDirection).
 */

export interface ComponentProps {
  summary: UserFlowSummary;
  insights: Array<UserFlowInsight>;
  /* Sessions the read answered with, before the page's filters. */
  sessionsRead: number;
  sessionsInWindow: number;
  isSampled: boolean;
  /* Whose sessions these are; absent or null for everyone. */
  scopeKind?: UserFlowScope["kind"] | null | undefined;
  onFocusPage: (page: string, direction: UserFlowDirection) => void;
}

function Tile(props: {
  label: string;
  value: string;
  hint: string;
  icon: IconProp;
  testId: string;
  /* What the number means, in an (i) beside the label. */
  tooltip: string;
  /*
   * A page's key: shown as a person reads it ("/café", not "/caf%C3%A9"),
   * in monospace, and cut from the front so the name survives.
   */
  isPage?: boolean | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const label: string = translator.translateText(props.label) || props.label;
  const value: string = props.isPage
    ? getUserFlowPageText(props.value)
    : props.value;
  /* A page's path reads from the left on any page: "/checkout". */
  const valueDirection: ReadingDirection | undefined = props.isPage
    ? getUserFlowPathLineDirection(props.value, translator.language)
    : undefined;

  /*
   * The label and the hint wrap to a second line rather than being cut:
   * in German a five-across row leaves "Sitzungen mit nur einer S..." and
   * "neueste 5.000 von 12.000 aufge...". A word wider than the tile breaks
   * at a syllable of the page's language.
   */
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white px-4 py-3"
      data-testid={props.testId}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon icon={props.icon} className="h-4 w-4 shrink-0 text-gray-400" />
        <span
          className={USER_FLOW_TILE_LABEL_CLASS_NAME}
          data-testid={`${props.testId}-label`}
        >
          {label}
        </span>
        <InfoTooltip
          label={label}
          text={props.tooltip}
          dataTestId={`${props.testId}-info`}
        />
      </div>
      <p
        className={`${
          props.isPage
            ? "mt-1.5 truncate font-mono text-lg font-semibold leading-8 text-gray-900"
            : "mt-1 truncate text-2xl font-semibold text-gray-900"
        } ${valueDirection ? LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME : ""}`}
        dir={valueDirection}
        title={value}
        data-testid={`${props.testId}-value`}
        data-value={props.value}
      >
        {props.isPage ? truncateUserFlowLabel(value, 22) : value}
      </p>
      <p
        className={USER_FLOW_TILE_HINT_CLASS_NAME}
        title={props.hint}
        data-testid={`${props.testId}-hint`}
      >
        {props.hint}
      </p>
    </div>
  );
}

const TONE_CLASSES: Record<UserFlowInsight["tone"], string> = {
  neutral: "border-indigo-100 bg-indigo-50/60 hover:border-indigo-300",
  warning: "border-amber-200 bg-amber-50/70 hover:border-amber-400",
  danger: "border-rose-200 bg-rose-50/70 hover:border-rose-400",
};

const TONE_ICON: Record<UserFlowInsight["tone"], string> = {
  neutral: "text-indigo-600",
  warning: "text-amber-600",
  danger: "text-rose-600",
};

const KIND_ICON: Record<UserFlowInsight["kind"], IconProp> = {
  "top-entry": IconProp.ArrowRight,
  "drop-off": IconProp.ArrowDown,
  loop: IconProp.Refresh,
  "error-hotspot": IconProp.Alert,
  "frustration-hotspot": IconProp.CursorArrowRays,
};

const UserFlowOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: UserFlowSummary = props.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Sessions analysed"
          value={formatUserFlowCount(summary.sessions, translator)}
          hint={formatUserFlowSessionsHint(
            {
              sessionsRead: props.sessionsRead,
              sessionsInWindow: props.sessionsInWindow,
              isSampled: props.isSampled,
              scopeKind: props.scopeKind,
            },
            translator,
          )}
          icon={IconProp.Film}
          testId="user-flow-tile-sessions"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.sessionsAnalysed}
        />
        <Tile
          label="Pages per session"
          value={summary.avgPagesPerSession.toLocaleString(
            getNumberLocale(translator.language) || "en-US",
            { minimumFractionDigits: 1, maximumFractionDigits: 1 },
          )}
          hint={translator.translateTemplate("median {{value}}", {
            value: translator.formatNumber(summary.medianPagesPerSession),
          })}
          icon={IconProp.Layers}
          testId="user-flow-tile-pages"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.pagesPerSession}
        />
        <Tile
          label="Single-page sessions"
          value={formatUserFlowShare(summary.bounceRate, translator)}
          hint={translator.translateTemplate("{{count}} never navigated", {
            count: formatUserFlowCount(
              summary.sessions - summary.navigatingSessions,
              translator,
            ),
          })}
          icon={IconProp.ArrowUturnLeft}
          testId="user-flow-tile-bounce"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.singlePageSessions}
        />
        <Tile
          label="Top landing page"
          value={summary.topEntryPage?.page || "—"}
          hint={
            summary.topEntryPage
              ? translator.translateTemplate(
                  "{{share}} of sessions start here",
                  {
                    share: formatUserFlowShare(
                      summary.sessions > 0
                        ? summary.topEntryPage.sessions / summary.sessions
                        : 0,
                      translator,
                    ),
                  },
                )
              : translator.translateText("no sessions") || "no sessions"
          }
          icon={IconProp.Home}
          testId="user-flow-tile-entry"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.topLandingPage}
          isPage={Boolean(summary.topEntryPage)}
        />
        <Tile
          label="Top exit page"
          value={summary.topExitPage?.page || "—"}
          hint={
            summary.topExitPage
              ? translator.translateTemplate("{{share}} of sessions end here", {
                  share: formatUserFlowShare(
                    summary.sessions > 0
                      ? summary.topExitPage.sessions / summary.sessions
                      : 0,
                    translator,
                  ),
                })
              : translator.translateText("no sessions") || "no sessions"
          }
          icon={IconProp.Logout}
          testId="user-flow-tile-exit"
          tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.topExitPage}
          isPage={Boolean(summary.topExitPage)}
        />
      </div>

      {props.insights.length > 0 ? (
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
          data-testid="user-flow-insights"
        >
          {props.insights
            .slice(0, USER_FLOW_MAX_VISIBLE_INSIGHTS)
            .map((insight: UserFlowInsight): ReactElement => {
              return (
                <button
                  type="button"
                  key={insight.kind}
                  className={`flex gap-3 rounded-lg border p-3 text-start transition-colors ${
                    TONE_CLASSES[insight.tone]
                  }`}
                  data-testid="user-flow-insight"
                  data-kind={insight.kind}
                  data-focus-direction={insight.focusDirection}
                  title={
                    insight.focusDirection === "backward"
                      ? translator.translateTemplate(
                          "Show how sessions reached {{page}}",
                          { page: getUserFlowPageText(insight.page) },
                        )
                      : translator.translateTemplate(
                          "Show paths from {{page}}",
                          { page: getUserFlowPageText(insight.page) },
                        )
                  }
                  onClick={(): void => {
                    props.onFocusPage(insight.page, insight.focusDirection);
                  }}
                >
                  <Icon
                    icon={KIND_ICON[insight.kind]}
                    className={`mt-0.5 h-5 w-5 shrink-0 ${TONE_ICON[insight.tone]}`}
                  />
                  {/*
                   * A finding is worded in English for now (issue #6754):
                   * on a page read from the right it reads from the left,
                   * so its full stop and its paths stay where written.
                   */}
                  <div className="min-w-0">
                    <p
                      className="break-words text-sm font-semibold text-gray-900"
                      dir={getTranslatedLineDirection(
                        insight.title,
                        translator.language,
                      )}
                    >
                      {insight.title}
                    </p>
                    <p
                      className="mt-0.5 break-words text-xs text-gray-600"
                      dir={getTranslatedLineDirection(
                        insight.detail,
                        translator.language,
                      )}
                    >
                      {insight.detail}
                    </p>
                  </div>
                </button>
              );
            })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default UserFlowOverview;
