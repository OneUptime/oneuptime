import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  UserFlowDirection,
  UserFlowInsight,
  UserFlowSummary,
} from "Common/Utils/Rum/UserFlow";
import {
  formatUserFlowCount,
  formatUserFlowShare,
  truncateUserFlowLabel,
} from "./UserFlowFormat";

/*
 * Findings shown at once. The engine orders them by how much they should
 * worry someone, and the fifth is always the neutral landing-page note,
 * which the "Top landing page" tile already says.
 */
export const USER_FLOW_MAX_VISIBLE_INSIGHTS: number = 4;

/*
 * The strip above the map: how many sessions the map is drawn from, how
 * far people get, and the findings worth reading first. Every finding is a
 * button that points the map at the page it is about, in the direction the
 * finding names (see UserFlowInsight.focusDirection).
 */

export interface ComponentProps {
  summary: UserFlowSummary;
  insights: Array<UserFlowInsight>;
  sessionsInWindow: number;
  isSampled: boolean;
  onFocusPage: (page: string, direction: UserFlowDirection) => void;
}

function Tile(props: {
  label: string;
  value: string;
  hint: string;
  icon: IconProp;
  testId: string;
  /* A page path: monospace, and cut from the front so the name survives. */
  isPage?: boolean | undefined;
}): ReactElement {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white px-4 py-3"
      data-testid={props.testId}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon icon={props.icon} className="h-4 w-4 text-gray-400" />
        {props.label}
      </div>
      <p
        className={
          props.isPage
            ? "mt-1.5 truncate font-mono text-lg font-semibold leading-8 text-gray-900"
            : "mt-1 truncate text-2xl font-semibold text-gray-900"
        }
        title={props.value}
        data-testid={`${props.testId}-value`}
        data-value={props.value}
      >
        {props.isPage ? truncateUserFlowLabel(props.value, 22) : props.value}
      </p>
      <p className="truncate text-xs text-gray-500" title={props.hint}>
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
  const summary: UserFlowSummary = props.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Sessions analysed"
          value={formatUserFlowCount(summary.sessions)}
          hint={
            props.isSampled
              ? `newest ${formatUserFlowCount(
                  summary.sessions,
                )} of ${formatUserFlowCount(props.sessionsInWindow)} recorded`
              : "recorded sessions in range"
          }
          icon={IconProp.Film}
          testId="user-flow-tile-sessions"
        />
        <Tile
          label="Pages per session"
          value={summary.avgPagesPerSession.toFixed(1)}
          hint={`median ${summary.medianPagesPerSession}`}
          icon={IconProp.Layers}
          testId="user-flow-tile-pages"
        />
        <Tile
          label="Single-page sessions"
          value={formatUserFlowShare(summary.bounceRate)}
          hint={`${formatUserFlowCount(
            summary.sessions - summary.navigatingSessions,
          )} never navigated`}
          icon={IconProp.ArrowUturnLeft}
          testId="user-flow-tile-bounce"
        />
        <Tile
          label="Top landing page"
          value={summary.topEntryPage?.page || "—"}
          hint={
            summary.topEntryPage
              ? `${formatUserFlowShare(
                  summary.sessions > 0
                    ? summary.topEntryPage.sessions / summary.sessions
                    : 0,
                )} of sessions start here`
              : "no sessions"
          }
          icon={IconProp.Home}
          testId="user-flow-tile-entry"
          isPage={Boolean(summary.topEntryPage)}
        />
        <Tile
          label="Top exit page"
          value={summary.topExitPage?.page || "—"}
          hint={
            summary.topExitPage
              ? `${formatUserFlowShare(
                  summary.sessions > 0
                    ? summary.topExitPage.sessions / summary.sessions
                    : 0,
                )} of sessions end here`
              : "no sessions"
          }
          icon={IconProp.Logout}
          testId="user-flow-tile-exit"
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
                  className={`flex gap-3 rounded-lg border p-3 text-left transition-colors ${
                    TONE_CLASSES[insight.tone]
                  }`}
                  data-testid="user-flow-insight"
                  data-kind={insight.kind}
                  data-focus-direction={insight.focusDirection}
                  title={
                    insight.focusDirection === "backward"
                      ? `Show how sessions reached ${insight.page}`
                      : `Show paths from ${insight.page}`
                  }
                  onClick={(): void => {
                    props.onFocusPage(insight.page, insight.focusDirection);
                  }}
                >
                  <Icon
                    icon={KIND_ICON[insight.kind]}
                    className={`mt-0.5 h-5 w-5 shrink-0 ${TONE_ICON[insight.tone]}`}
                  />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-gray-900">
                      {insight.title}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-gray-600">
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
