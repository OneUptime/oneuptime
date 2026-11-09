import {
  AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR,
  ALERT_AI_SETTINGS_PATH,
  INCIDENT_AI_SETTINGS_PATH,
  PROJECT_AI_RUN_LIMITS_CARD_ANCHOR,
  PROJECT_AI_RUN_LIMITS_SETTINGS_PATH,
} from "../../../../Server/Utils/AI/AIRunLimitsReader";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AiLane,
  AiLaneAdvancedCard,
  PROJECT_AI_RUN_LIMITS_CARD_KEY,
  ProjectAiRunLimitsCopy,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import PageMap from "../../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  ALERT_AI_INVESTIGATION_LIMITS_LOCATION,
  INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "../../../../Types/AI/AIAgentRunLimits";
import Route from "../../../../Types/API/Route";
import { escapeRegExp } from "../../../../Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";

/*
 * A run a limit stopped says so under its answer (issue #6440): which limit,
 * and where it is changed - a place in words, linked to the Dashboard card
 * that holds it (AIRunLimitsReader.getSettingsUrl, getStopNote). The link
 * is built on the server from paths and anchors of its own; these hold them
 * to the Dashboard's routes and cards, so a link never lands on a page that
 * moved or a card that was renamed.
 */

function routeOf(page: string): string {
  return (RouteMap[page] as Route).toString();
}

describe("a stopped run's link lands on the setting", () => {
  test("the project's limits per run: AI Features, at Limits per run", () => {
    expect(routeOf(PageMap.SETTINGS_AI_FEATURES)).toBe(
      `/dashboard/:projectId/${PROJECT_AI_RUN_LIMITS_SETTINGS_PATH}`,
    );
    expect(PROJECT_AI_RUN_LIMITS_CARD_ANCHOR).toBe(
      PROJECT_AI_RUN_LIMITS_CARD_KEY,
    );
  });

  test("an incident investigation's time limit: the incident AI settings, at Investigation limits", () => {
    expect(routeOf(PageMap.INCIDENTS_SETTINGS_AI)).toBe(
      `/dashboard/:projectId/${INCIDENT_AI_SETTINGS_PATH}`,
    );
    expect(AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR).toBe(
      AiLaneAdvancedCard.InvestigationLimits,
    );
  });

  test("an alert investigation's time limit: the alert AI settings, at Investigation limits", () => {
    expect(routeOf(PageMap.ALERTS_SETTINGS_AI)).toBe(
      `/dashboard/:projectId/${ALERT_AI_SETTINGS_PATH}`,
    );
  });
});

describe("the place in words names the card as the page titles it", () => {
  test("Limits per run", () => {
    expect(PROJECT_AI_RUN_LIMITS_LOCATION).toMatch(
      new RegExp(`→ ${escapeRegExp(ProjectAiRunLimitsCopy.cardTitle)}$`, "i"),
    );
    expect(PROJECT_AI_RUN_LIMITS_LOCATION).toMatch(/^Project Settings → AI → /);
  });

  test("Investigation limits, on each lane's page", () => {
    expect(INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION).toMatch(
      new RegExp(
        `^Incidents → .* → ${escapeRegExp(
          AI_LANE_ADVANCED_CARD_TITLES[AiLane.Incident][
            AiLaneAdvancedCard.InvestigationLimits
          ],
        )}$`,
        "i",
      ),
    );
    expect(ALERT_AI_INVESTIGATION_LIMITS_LOCATION).toMatch(
      new RegExp(
        `^Alerts → .* → ${escapeRegExp(
          AI_LANE_ADVANCED_CARD_TITLES[AiLane.Alert][
            AiLaneAdvancedCard.InvestigationLimits
          ],
        )}$`,
        "i",
      ),
    );
  });
});
