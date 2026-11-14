import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { FunctionComponent } from "react";

/*
 * #7824: a maintenance event's AI Logs card says "AI usage logs for this
 * maintenance event." - the record's name since #6817 - where it said
 * "scheduled maintenance event". The table's key stays the one built from
 * the old name: a reader's own columns and the project's default columns
 * are saved under it, and a key built from the new name would lose them.
 * The incident and alert pages build theirs from their record's name, as
 * before, and the project's page has its own.
 *
 * The table is captured, not rendered: what the page hands it is under test.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import ScheduledMaintenanceAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/AILogs";
import IncidentAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AILogs";
import AlertAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/AILogs";
import ProjectAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AILogs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const EVENT_ID: string = "22222222-2222-4222-8222-222222222222";

interface CapturedTable {
  id: unknown;
  userPreferencesKey: unknown;
  description: unknown;
  noItemsMessage: unknown;
  query: Record<string, unknown>;
}

function tableOf(Page: FunctionComponent<PageComponentProps>): CapturedTable {
  render(
    <Page
      pageRoute={new Route("/dashboard/ai-logs")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  const props: Record<string, unknown> =
    mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
  const cardProps: Record<string, unknown> = (props["cardProps"] ||
    {}) as Record<string, unknown>;

  return {
    id: props["id"],
    userPreferencesKey: props["userPreferencesKey"],
    description: cardProps["description"],
    noItemsMessage: props["noItemsMessage"],
    query: (props["query"] || {}) as Record<string, unknown>,
  };
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(EVENT_ID);
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a maintenance event's AI Logs", () => {
  test("say what they are about by the record's name", () => {
    const table: CapturedTable = tableOf(ScheduledMaintenanceAILogs);

    expect(table.description).toBe("AI usage logs for this maintenance event.");
    expect(table.noItemsMessage).toBe("No AI logs for this maintenance event.");
    expect(String(table.query["scheduledMaintenanceId"])).toBe(EVENT_ID);
  });

  test("keep the key their saved columns are under, from the old name", () => {
    const table: CapturedTable = tableOf(ScheduledMaintenanceAILogs);

    expect(table.id).toBe("scheduled-maintenance-event-llm-logs-table");
    expect(table.userPreferencesKey).toBe(
      "scheduled-maintenance-event-llm-logs-table",
    );
  });
});

describe("the other AI Logs pages", () => {
  test.each([
    [
      "an incident's",
      IncidentAILogs,
      "incident-llm-logs-table",
      "AI usage logs for this incident.",
    ],
    [
      "an alert's",
      AlertAILogs,
      "alert-llm-logs-table",
      "AI usage logs for this alert.",
    ],
    [
      "the project's",
      ProjectAILogs,
      "llm-logs-table",
      "AI usage logs for this project.",
    ],
  ])(
    "%s keep their key and their words",
    (
      _name: string,
      Page: FunctionComponent<PageComponentProps>,
      key: string,
      description: string,
    ) => {
      const table: CapturedTable = tableOf(Page);

      expect(table.id).toBe(key);
      expect(table.userPreferencesKey).toBe(key);
      expect(table.description).toBe(description);
    },
  );
});
