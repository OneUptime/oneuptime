import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  describeSessionReplayAuditSession,
  SessionReplayAuditPresentation,
  SessionReplayAuditSummary,
} from "./SessionReplayAuditSummary";

export interface SessionReplayAuditSessionLinkProps {
  rumApplicationId: ObjectID;
  sessionId?: string | undefined;
  summary?: SessionReplayAuditSummary | undefined;
}

const SessionReplayAuditSessionLink: FunctionComponent<
  SessionReplayAuditSessionLinkProps
> = (props: SessionReplayAuditSessionLinkProps): ReactElement => {
  const sessionId: string = props.sessionId?.trim() || "";

  if (!sessionId) {
    return (
      <span className="text-sm text-gray-500" data-testid="audit-session-empty">
        —
      </span>
    );
  }

  const presentation: SessionReplayAuditPresentation =
    describeSessionReplayAuditSession({
      sessionId: sessionId,
      summary: props.summary,
    });
  const context: Array<string> = [
    presentation.startedAt
      ? `Recorded ${OneUptimeDate.fromNow(presentation.startedAt)}`
      : "",
    presentation.durationLabel,
    presentation.deviceLabel,
  ].filter(Boolean);
  const absoluteStart: string = presentation.startedAt
    ? OneUptimeDate.getDateAsLocalFormattedString(presentation.startedAt)
    : "";
  const hoverDetails: string = [
    `Session ${presentation.fullSessionId}`,
    absoluteStart ? `Recorded ${absoluteStart}` : "",
    props.summary?.entryUrl || "",
  ]
    .filter(Boolean)
    .join("\n");
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
    { modelId: props.rumApplicationId, subModelId: sessionId },
  );

  return (
    <AppLink
      to={route}
      className="group inline-flex min-w-0 items-start gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <span
        className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-100"
        aria-hidden="true"
      >
        <Icon icon={IconProp.Play} className="h-3.5 w-3.5" />
      </span>
      <span
        className="min-w-0"
        title={hoverDetails}
        data-testid="audit-session-link"
      >
        <span className="block truncate text-sm font-semibold text-indigo-700 group-hover:underline">
          {presentation.primaryLabel}
        </span>
        {context.length > 0 && (
          <span
            className="mt-0.5 block truncate text-xs text-gray-500"
            data-testid="audit-session-context"
          >
            {context.join(" · ")}
          </span>
        )}
        <span className="mt-1 inline-flex rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-600">
          {presentation.sessionLabel}
        </span>
        <span className="sr-only">
          {`Full session ID ${presentation.fullSessionId}`}
        </span>
      </span>
    </AppLink>
  );
};

export default SessionReplayAuditSessionLink;
