import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  AiLaneAdvancedCard,
  PROJECT_AI_RUN_LIMITS_CARD_KEY,
} from "../../AISettings/ProjectAiSettingsCopy";
import {
  ALERT_AI_INVESTIGATION_LIMITS_LOCATION,
  INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "Common/Types/AI/AIAgentRunLimits";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  readRunStopNote,
  RunStopNoteParts,
} from "Common/Utils/AI/InvestigationReport";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { getShownMarkdownReadingDirection } from "Common/UI/Components/Markdown.tsx/MarkdownReadingDirection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The report's stop note, as written (ParsedInvestigationReport.stopNote).
  note: string;
}

export const STOP_NOTE_TEST_ID: string = "investigation-report-stop-note";
export const STOP_NOTE_SETTING_LINK_TEST_ID: string =
  "investigation-report-stop-note-setting";

export const STOP_NOTE_SETTING_LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * Where a place a stop note names is, in this Dashboard: the page, and the
 * card on it - which opens the page's More settings and lands on that card.
 * Null for a place it does not know.
 */
export function getRunLimitSettingRoute(location: string | null): Route | null {
  let page: PageMap | null = null;
  let anchor: string = "";

  switch (location) {
    case PROJECT_AI_RUN_LIMITS_LOCATION:
      page = PageMap.SETTINGS_AI_FEATURES;
      anchor = PROJECT_AI_RUN_LIMITS_CARD_KEY;
      break;
    case INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION:
      page = PageMap.INCIDENTS_SETTINGS_AI;
      anchor = AiLaneAdvancedCard.InvestigationLimits;
      break;
    case ALERT_AI_INVESTIGATION_LIMITS_LOCATION:
      page = PageMap.ALERTS_SETTINGS_AI;
      anchor = AiLaneAdvancedCard.InvestigationLimits;
      break;
  }

  if (!page) {
    return null;
  }

  const route: Route = RouteUtil.populateRouteParams(RouteMap[page] as Route);

  return new Route(`${route.toString()}#${anchor}`);
}

/*
 * OneUptime's line that a limit stopped the investigation (issue #6440):
 * "This investigation stopped at the incident investigation time limit of
 * 20 minutes. Change it in Incidents → AI → Settings → More settings →
 * Investigation limits." It qualifies the whole report - what is above it
 * is what the run found in the time it had - so it closes the report, just
 * before the verify-first caveat, as a quiet line with an amber mark: the
 * activity's own mark for a run that stopped. It is no longer read as the
 * end of the last section, where the card drew it under Suggested next
 * steps, or inside the last cause ruled out.
 *
 * Its words are drawn as text, upright rather than in the note's italics.
 * The place it names is a link the card builds itself (getRunLimitSettingRoute),
 * never the note's own address: a report is drawn in safe mode, where that
 * link was dotted text that went nowhere, and a note that only reads like
 * the server's may have been written by the model.
 */
const InvestigationStopNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: RunStopNoteParts = readRunStopNote(props.note);
  const route: Route | null = getRunLimitSettingRoute(parts.location);

  /*
   * The line reads the way it is written, as each cause ruled out above it
   * does: OneUptime's English on a Persian page reads left to right, with
   * its mark beside its first word, at the left - not across the card from
   * it, at the page's right edge.
   */
  return (
    <div
      data-testid={STOP_NOTE_TEST_ID}
      dir={getShownMarkdownReadingDirection(props.note)}
      className="flex items-start gap-3"
    >
      {/* A div, not a span: Icon renders its own div around the svg. */}
      <div className="flex h-6 w-4 flex-shrink-0 items-center justify-center">
        <Icon
          icon={IconProp.Info}
          className="h-4 w-4 flex-shrink-0 text-amber-500"
        />
      </div>
      <p className="min-w-0 flex-1 break-words text-sm leading-6 text-gray-700">
        {parts.before}
        {parts.location && route ? (
          <Link
            to={route}
            className={STOP_NOTE_SETTING_LINK_CLASS_NAME}
            dataTestId={STOP_NOTE_SETTING_LINK_TEST_ID}
          >
            {parts.location}
          </Link>
        ) : (
          parts.location || ""
        )}
        {parts.after}
      </p>
    </div>
  );
};

export default InvestigationStopNote;
