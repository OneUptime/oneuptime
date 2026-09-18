import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as React from "react";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
  MonitorEvaluationEventType,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Timezone from "../../../Types/Timezone";
import MonitorSummarySnapshotUtil from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";

type Entity = "Alert" | "Incident";

interface ActionTimestampCase {
  type: MonitorEvaluationEventType;
  label: string;
}

const ENTITIES: Array<Entity> = ["Alert", "Incident"];
const ENTITY_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_AT: Date = new Date("2026-01-15T10:00:00.000Z");
const CHECKED_AT: Date = new Date("2026-09-18T10:32:00.000Z");

function activeEvent(
  entity: Entity,
  overrides: Partial<MonitorEvaluationEvent> = {},
): MonitorEvaluationEvent {
  return {
    type: entity === "Alert" ? "alert-skipped" : "incident-skipped",
    title: `${entity} already active: Database unavailable`,
    message: `Skipped creating a new ${entity.toLowerCase()} because an active ${entity.toLowerCase()} exists for this criteria.`,
    ...(entity === "Alert"
      ? {
          relatedAlertId: ENTITY_ID,
          relatedAlertCreatedAt: CREATED_AT,
        }
      : {
          relatedIncidentId: ENTITY_ID,
          relatedIncidentCreatedAt: CREATED_AT,
        }),
    at: CHECKED_AT,
    ...overrides,
  };
}

function summary(
  events: Array<MonitorEvaluationEvent>,
): MonitorEvaluationSummary {
  return {
    evaluatedAt: CHECKED_AT,
    criteriaResults: [],
    events,
  };
}

function renderEvents(events: Array<MonitorEvaluationEvent>): void {
  render(<EvaluationLogList evaluationSummary={summary(events)} />);
}

function creationTime(
  entity: Entity,
  date: Date | undefined,
): Partial<MonitorEvaluationEvent> {
  return entity === "Alert"
    ? { relatedAlertCreatedAt: date }
    : { relatedIncidentCreatedAt: date };
}

describe("monitor summary action timestamps", () => {
  let previousTimezone: Timezone | null = null;

  beforeEach(() => {
    previousTimezone = OneUptimeDate.getUserTimezone();
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  afterEach(() => {
    OneUptimeDate.setUserTimezone(previousTimezone);
    jest.restoreAllMocks();
  });

  describe.each(ENTITIES)("an already active %s", (entity: Entity) => {
    it("distinguishes the original creation date from the later monitor check", () => {
      renderEvents([activeEvent(entity)]);

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 10:00 GMT`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
      expect(
        screen.getByText("Evaluated at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: `View ${entity}` }),
      ).toBeVisible();
      expect(
        screen.queryByText(`${entity} created at Sep 18 2026, 11:32 BST`),
      ).not.toBeInTheDocument();
    });

    it("keeps each grouped entity's creation date attached to its own action", () => {
      const first: MonitorEvaluationEvent = activeEvent(entity, {
        title: `${entity} already active: Host A`,
      });
      const second: MonitorEvaluationEvent = activeEvent(entity, {
        title: `${entity} already active: Host B`,
        ...creationTime(entity, new Date("2026-09-17T21:15:00.000Z")),
      });

      renderEvents([first, second]);

      const firstAction: HTMLElement = screen.getByText(
        first.title,
      ).parentElement!;
      const secondAction: HTMLElement = screen.getByText(
        second.title,
      ).parentElement!;

      expect(
        within(firstAction).getByText(
          `${entity} created at Jan 15 2026, 10:00 GMT`,
        ),
      ).toBeVisible();
      expect(
        within(secondAction).getByText(
          `${entity} created at Sep 17 2026, 22:15 BST`,
        ),
      ).toBeVisible();
      expect(
        within(firstAction).getByText("Checked at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
      expect(
        within(secondAction).getByText("Checked at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
    });

    it("preserves the original creation date when the next evaluation arrives", () => {
      const { rerender } = render(
        <EvaluationLogList
          evaluationSummary={summary([activeEvent(entity)])}
        />,
      );

      rerender(
        <EvaluationLogList
          evaluationSummary={summary([
            activeEvent(entity, {
              at: new Date("2026-09-18T11:45:00.000Z"),
            }),
          ])}
        />,
      );

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 10:00 GMT`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 12:45 BST"),
      ).toBeVisible();
      expect(
        screen.queryByText("Checked at Sep 18 2026, 11:32 BST"),
      ).not.toBeInTheDocument();
    });

    it("renders ISO timestamps read back from a persisted monitor log", () => {
      /*
       * MonitorLogUtil persists nested Dates through JSON.stringify; the
       * analytics model leaves those ISO strings inside logBody unchanged.
       */
      const storedLog: JSONObject = JSON.parse(
        JSON.stringify({
          logBody: {
            evaluationSummary: summary([activeEvent(entity)]),
          },
        }),
      ) as JSONObject;
      const monitorLog: MonitorLog = MonitorLog.fromJSON(
        storedLog,
        MonitorLog,
      ) as MonitorLog;
      const persistedSummary: MonitorEvaluationSummary = monitorLog.logBody![
        "evaluationSummary"
      ] as unknown as MonitorEvaluationSummary;

      expect(typeof persistedSummary.events[0]!.at).toBe("string");
      render(<EvaluationLogList evaluationSummary={persistedSummary} />);

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 10:00 GMT`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
    });

    it("renders dates restored from a saved incident or alert summary snapshot", () => {
      const snapshot: MonitorSummarySnapshot =
        MonitorSummarySnapshotUtil.buildSnapshot({
          monitorType: MonitorType.Metrics,
          capturedAt: CHECKED_AT,
          evaluationSummary: summary([activeEvent(entity)]),
        })!;
      const stored: JSONObject = JSON.parse(
        JSON.stringify(MonitorSummarySnapshotUtil.serialize(snapshot)),
      ) as JSONObject;
      const restored: MonitorSummarySnapshot =
        MonitorSummarySnapshotUtil.deserialize(stored)!;
      const persistedSummary: MonitorEvaluationSummary =
        MonitorSummarySnapshotUtil.toSummaryInfoProps(
          restored,
        ).evaluationSummary!;
      const restoredEvent: MonitorEvaluationEvent = persistedSummary.events[0]!;

      expect(restoredEvent.at).toBeInstanceOf(Date);
      expect(
        entity === "Alert"
          ? restoredEvent.relatedAlertCreatedAt
          : restoredEvent.relatedIncidentCreatedAt,
      ).toBeInstanceOf(Date);

      render(<EvaluationLogList evaluationSummary={persistedSummary} />);

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 10:00 GMT`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
    });

    it("uses the user's selected timezone for both dates", () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      renderEvents([activeEvent(entity)]);

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 05:00 EST`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 06:32 EDT"),
      ).toBeVisible();
      expect(screen.queryByText(/BST|GMT/)).not.toBeInTheDocument();
    });

    it("converts the date as well as the time when the timezone crosses midnight", () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

      renderEvents([
        activeEvent(entity, {
          ...creationTime(entity, new Date("2026-09-17T23:45:00.000Z")),
        }),
      ]);

      expect(
        screen.getByText(`${entity} created at Sep 18 2026, 05:15 IST`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 16:02 IST"),
      ).toBeVisible();
    });

    it("honors the user's 12-hour time preference", () => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      renderEvents([
        activeEvent(entity, {
          at: new Date("2026-09-18T13:32:00.000Z"),
        }),
      ]);

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 10:00 AM GMT`),
      ).toBeVisible();
      expect(
        screen.getByText("Checked at Sep 18 2026, 02:32 PM BST"),
      ).toBeVisible();
    });

    it("labels legacy event timestamps as checks without inventing a creation date", () => {
      renderEvents([
        activeEvent(entity, {
          ...creationTime(entity, undefined),
        }),
      ]);

      expect(
        screen.getByText("Checked at Sep 18 2026, 11:32 BST"),
      ).toBeVisible();
      expect(screen.queryByText(/created at/i)).not.toBeInTheDocument();
    });

    it("does not substitute the evaluation time for a missing action timestamp", () => {
      renderEvents([activeEvent(entity, { at: undefined })]);

      expect(
        screen.getByText(`${entity} created at Jan 15 2026, 10:00 GMT`),
      ).toBeVisible();
      expect(screen.queryByText(/Checked at/)).not.toBeInTheDocument();
    });

    it("leaves timestamps absent when neither creation nor check time was recorded", () => {
      renderEvents([
        activeEvent(entity, {
          ...creationTime(entity, undefined),
          at: undefined,
        }),
      ]);

      expect(
        screen.queryByText(/created at|Checked at/i),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `View ${entity}` }),
      ).toBeVisible();
    });
  });

  it.each<ActionTimestampCase>([
    { type: "alert-created", label: "Created at" },
    { type: "incident-created", label: "Created at" },
    { type: "alert-resolved", label: "Resolved at" },
    { type: "incident-resolved", label: "Resolved at" },
    { type: "alert-skipped", label: "Skipped at" },
    { type: "incident-skipped", label: "Skipped at" },
    { type: "monitor-status-changed", label: "Action at" },
    { type: "probe-agreement", label: "Action at" },
  ])(
    "labels a $type action as '$label'",
    ({ type, label }: ActionTimestampCase) => {
      renderEvents([
        {
          type,
          title: "Monitor action",
          at: CHECKED_AT,
        },
      ]);

      expect(screen.getByText(`${label} Sep 18 2026, 11:32 BST`)).toBeVisible();
      expect(
        screen.queryByText(/Alert created at|Incident created at/),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Checked at/)).not.toBeInTheDocument();
    },
  );
});
