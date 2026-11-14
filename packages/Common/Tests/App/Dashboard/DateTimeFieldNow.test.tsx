/** @timezone Asia/Kolkata */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { AnnouncementFormKind } from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import { getAnnouncementFormFields } from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementFormFields";
import { getDefaultUserOverrideStartsAt } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import { getDefaultMaintenanceStartsAt } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import { getRuleExceptionWindowDefaults } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionFormFields";
import { ALERT_EPISODE_STATE_TIMELINE_FORM_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/StateTimeline";
import { ALERT_STATE_TIMELINE_FORM_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/StateTimeline";
import { INCIDENT_EPISODE_STATE_TIMELINE_FORM_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/StateTimeline";
import { INCIDENT_STATE_TIMELINE_FORM_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline";
import { MONITOR_STATUS_EVENT_FORM_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline";
import { SCHEDULED_MAINTENANCE_STATE_TIMELINE_FORM_FIELDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/StateTimeline";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { buildNewScheduleLayer } from "../../../Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import { getUserOverrideCoverWindow } from "../../../Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import Timezone from "../../../Types/Timezone";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * "NOW" IN A DATE AND TIME FIELD (issue #7593).
 *
 * Every date and time field shows hours and minutes. A field that starts
 * at "now" then shows the minute now is in - 11:15 at 11:15:52 - and what
 * it saves depends on what the time is for:
 *
 *   - A time that SCHEDULES something - when an override, a layer's
 *     rotation, an announcement, a rule exception's window starts - is the
 *     minute the field shows, 11:15:00. That minute has already begun, so
 *     what starts now is in force at once, never a minute late, and its
 *     hand-offs and ends fall on the minute every page prints.
 *   - A time that RECORDS when something happened - an incident, alert,
 *     episode or maintenance event changing state, a monitor's status
 *     changing - keeps its exact moment, 11:15:52.345. A state's start
 *     orders it on its timeline: one cut back to 11:15:00 would sort before
 *     a state entered at 11:15:30, and the timeline would read backwards.
 *     The field still shows 11:15, and a time picked in it is on the minute.
 *
 * Each "now" below is the product's own: the form fields and defaults the
 * pages use, read at the same instant, in a zone that is not UTC.
 */

// 11:15:52.345 in Kolkata (the person's zone below).
const NOW: Date = new Date("2026-11-13T05:45:52.345Z");
// 11:15:00 there: the minute the fields show.
const THIS_MINUTE: Date = new Date("2026-11-13T05:45:00.000Z");
const ONE_MINUTE_IN_MILLISECONDS: number = 60 * 1000;

const SCHEDULE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));
  OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

function toDate(value: unknown): Date {
  expect(value instanceof Date || typeof value === "string").toBe(true);

  return OneUptimeDate.fromString(value as string | Date);
}

interface FieldWithDefault {
  field?: unknown;
  title?: string | undefined;
  fieldType?: FormFieldSchemaType | undefined;
  getDefaultValue?: ((values: JSONObject) => unknown) | undefined;
}

// The one field of a list that fills in `name`.
function fieldFor(
  fields: ReadonlyArray<unknown>,
  name: string,
): FieldWithDefault {
  const matches: Array<FieldWithDefault> = (
    fields as ReadonlyArray<FieldWithDefault>
  ).filter((field: FieldWithDefault): boolean => {
    return Boolean(
      field.field &&
        typeof field.field === "object" &&
        (field.field as Record<string, unknown>)[name],
    );
  });

  expect(matches).toHaveLength(1);

  return matches[0]!;
}

type ScheduledNow = [string, () => Date];

const SCHEDULED_NOWS: Array<ScheduledNow> = [
  [
    "Add User Override's Starts",
    (): Date => {
      return toDate(getDefaultUserOverrideStartsAt());
    },
  ],
  [
    "a new layer's Rotation starts at",
    (): Date => {
      return toDate(
        buildNewScheduleLayer({
          onCallDutyPolicyScheduleId: SCHEDULE_ID,
          projectId: PROJECT_ID,
          name: "Layer 1",
          timezone: "Asia/Kolkata",
        }).startsAt,
      );
    },
  ],
  [
    "a new announcement's Start Showing Announcement At",
    (): Date => {
      return toDate(
        fieldFor(
          getAnnouncementFormFields(AnnouncementFormKind.Create),
          "showAnnouncementAt",
        ).getDefaultValue!({}),
      );
    },
  ],
  [
    "a new rule exception's window",
    (): Date => {
      return getRuleExceptionWindowDefaults(OneUptimeDate.getCurrentDate())
        .startsAt;
    },
  ],
  [
    "Get cover on a shift already under way",
    (): Date => {
      return getUserOverrideCoverWindow({
        start: new Date("2026-11-13T03:30:00.000Z"),
        end: new Date("2026-11-13T11:30:00.000Z"),
        now: OneUptimeDate.getCurrentDate(),
      })!.startsAt;
    },
  ],
];

describe("a 'now' that schedules something is the minute the field shows", () => {
  test.each(SCHEDULED_NOWS)(
    "%s starts at 11:15:00, not 11:15:52",
    (_what: string, read: () => Date) => {
      expect(read().toISOString()).toBe(THIS_MINUTE.toISOString());
    },
  );

  test.each(SCHEDULED_NOWS)(
    "%s has already begun: never later than now, and less than a minute before it",
    (_what: string, read: () => Date) => {
      const startsAt: number = read().getTime();

      expect(startsAt).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - startsAt).toBeLessThan(ONE_MINUTE_IN_MILLISECONDS);
    },
  );

  test("a new layer hands off on the minute too, a week after it starts", () => {
    const layer: OnCallDutyPolicyScheduleLayer = buildNewScheduleLayer({
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      projectId: PROJECT_ID,
      name: "Layer 1",
      timezone: "Asia/Kolkata",
    });

    expect(toDate(layer.handOffTime).toISOString()).toBe(
      "2026-11-20T05:45:00.000Z",
    );
  });

  test("a new rule exception's window ends two hours after the minute it starts, on the minute", () => {
    expect(
      getRuleExceptionWindowDefaults(
        OneUptimeDate.getCurrentDate(),
      ).endsAt.toISOString(),
    ).toBe("2026-11-13T07:45:00.000Z");
  });

  test("Get cover on a shift that starts later covers it from its own start", () => {
    expect(
      getUserOverrideCoverWindow({
        start: new Date("2026-11-13T12:30:00.000Z"),
        end: new Date("2026-11-13T20:30:00.000Z"),
        now: OneUptimeDate.getCurrentDate(),
      })!.startsAt.toISOString(),
    ).toBe("2026-11-13T12:30:00.000Z");
  });

  test("a new maintenance event starts at the next full hour, which has no seconds either", () => {
    const startsAt: Date = toDate(getDefaultMaintenanceStartsAt());

    // 12:00 in Kolkata, the next full hour after 11:15:52.
    expect(startsAt.toISOString()).toBe("2026-11-13T06:30:00.000Z");
  });
});

interface RecordedChange {
  name: string;
  fields: ReadonlyArray<unknown>;
}

const RECORDED_CHANGES: Array<RecordedChange> = [
  {
    name: "an incident's state change",
    fields: INCIDENT_STATE_TIMELINE_FORM_FIELDS,
  },
  {
    name: "an incident episode's state change",
    fields: INCIDENT_EPISODE_STATE_TIMELINE_FORM_FIELDS,
  },
  { name: "an alert's state change", fields: ALERT_STATE_TIMELINE_FORM_FIELDS },
  {
    name: "an alert episode's state change",
    fields: ALERT_EPISODE_STATE_TIMELINE_FORM_FIELDS,
  },
  {
    name: "a maintenance event's state change",
    fields: SCHEDULED_MAINTENANCE_STATE_TIMELINE_FORM_FIELDS,
  },
  {
    name: "a monitor's status change",
    fields: MONITOR_STATUS_EVENT_FORM_FIELDS,
  },
];

// The real Starts At of a timeline, alone in the real form.
async function renderStartsAt(field: FieldWithDefault): Promise<MockFunction> {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="recorded-now"
      fields={[field] as unknown as Fields<JSONObject>}
      onSubmit={onSubmit}
      submitButtonText="Save"
      disableAutofocus={true}
    />,
  );

  // BasicForm fills in its fields' defaults in an effect of its own.
  await waitFor(() => {
    expect(startsAtInput().value).not.toBe("");
  });

  return onSubmit;
}

function startsAtInput(): HTMLInputElement {
  const label: HTMLLabelElement | undefined = Array.from(
    document.querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "").trim().startsWith("Starts At");
  });

  expect(label).toBeDefined();

  return document.querySelector(
    `[id="${label!.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

async function save(onSubmit: MockFunction): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("Save"));
  });

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  return onSubmit.mock.calls[0]![0] as JSONObject;
}

describe.each(RECORDED_CHANGES)(
  "a 'now' that records $name",
  (change: RecordedChange) => {
    test("is a date and time field that starts at the exact moment, seconds and all", () => {
      const startsAt: FieldWithDefault = fieldFor(change.fields, "startsAt");

      expect(startsAt.title).toBe("Starts At");
      expect(startsAt.fieldType).toBe(FormFieldSchemaType.DateTime);
      expect(toDate(startsAt.getDefaultValue!({})).toISOString()).toBe(
        NOW.toISOString(),
      );
    });

    test("shows the minute, asks for no seconds, and left alone is saved at its moment", async () => {
      const onSubmit: MockFunction = await renderStartsAt(
        fieldFor(change.fields, "startsAt"),
      );

      expect(startsAtInput().value).toBe("2026-11-13T11:15");
      expect(startsAtInput()).toHaveAttribute("type", "datetime-local");
      expect(startsAtInput()).not.toHaveAttribute("step");

      const values: JSONObject = await save(onSubmit);

      expect(toDate(values["startsAt"]).toISOString()).toBe(NOW.toISOString());
    });

    test("a time picked in it is saved on the minute", async () => {
      const onSubmit: MockFunction = await renderStartsAt(
        fieldFor(change.fields, "startsAt"),
      );

      // What the browser hands back for 10:50 picked in the field.
      fireEvent.change(startsAtInput(), {
        target: { value: "2026-11-13T10:50" },
      });

      const values: JSONObject = await save(onSubmit);

      expect(toDate(values["startsAt"]).toISOString()).toBe(
        "2026-11-13T05:20:00.000Z",
      );
      expect(startsAtInput().value).toBe("2026-11-13T10:50");
    });
  },
);
