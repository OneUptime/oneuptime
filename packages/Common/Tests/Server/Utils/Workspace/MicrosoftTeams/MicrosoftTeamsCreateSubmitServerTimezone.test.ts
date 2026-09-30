/** @timezone America/Los_Angeles */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import logger from "../../../../../Server/Utils/Logger";
import { MicrosoftTeamsScheduledMaintenanceActionType } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProjectReferenceValidator from "../../../../../Server/Utils/Workspace/WorkspaceProjectReferenceValidator";
import URL from "../../../../../Types/API/URL";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Issue #4111, the maintenance form on a server that is not on UTC.
 *
 * The "create maintenance" form submits Input.Date and Input.Time as a bare
 * "2030-10-01" and "14:00". Before the fix the handler read them with
 * OneUptimeDate.fromString("2030-10-01T14:00"), that is in the server
 * process's own zone. The stock containers run on UTC, so only UTC users got
 * the time they typed; on a self-hosted server set to Los Angeles, 14:00
 * typed in New York was stored as 14:00 in Los Angeles.
 *
 * This file runs the process in America/Los_Angeles (the docblock above) and
 * submits the forms MicrosoftTeamsCreateSubmit.test.ts submits. The stored
 * instants must be the ones a UTC server stores: the zone comes from the form
 * (the zone it named), then from Teams, the last resort is UTC, and the
 * server's zone never enters, neither in reading the times nor in comparing
 * the start with now (a start that has only just gone by starts now).
 */

// 12:00 UTC is 05:00 in Los Angeles (PDT) and 08:00 in New York (EDT).
const NOW: Date = new Date("2026-09-29T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "5d0c1f4e-7a3b-4c8e-9f21-6b7a8c9d0e1f",
);
const USER_ID: ObjectID = new ObjectID("8e2a4c6b-1d3f-4a5b-8c7d-9e0f1a2b3c4d");
const CREATED_ID: ObjectID = new ObjectID(
  "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
);
const MAINTENANCE_LINK: URL = URL.fromString(
  `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/${CREATED_ID.toString()}`,
);

interface FakeTurn {
  turnContext: TurnContext;
  replies: Array<string>;
}

// A card submit whose activity carries what Teams said about the zone.
function createFakeTurn(activity: JSONObject): FakeTurn {
  const replies: Array<string> = [];

  const turnContext: TurnContext = {
    activity: {
      type: "message",
      id: "1727611260456",
      replyToId: "1727611200123",
      ...activity,
    },
    sendActivity: async (reply: unknown): Promise<{ id: string }> => {
      replies.push(typeof reply === "string" ? reply : JSON.stringify(reply));
      return { id: `reply-${replies.length}` };
    },
    deleteActivity: async (): Promise<void> => {},
  } as unknown as TurnContext;

  return { turnContext: turnContext, replies: replies };
}

function maintenanceForm(fields?: JSONObject): JSONObject {
  return {
    action:
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
    scheduledMaintenanceTitle: "Primary database upgrade",
    scheduledMaintenanceDescription: "Postgres 16 to 17.",
    startDate: "2030-10-01",
    startTime: "14:00",
    endDate: "2030-10-01",
    endTime: "15:00",
    ...fields,
  };
}

function submitMaintenance(turn: FakeTurn, value: JSONObject): Promise<void> {
  return MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
    MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
    turn.turnContext,
    value,
    {
      isAuthorized: true,
      projectId: PROJECT_ID,
      authToken: "",
      payloadType: "invoke",
      userId: USER_ID.toString(),
    },
    { userId: USER_ID, tenantId: PROJECT_ID },
  );
}

let createSpy: SpyInstance<typeof ScheduledMaintenanceService.create>;

// The one event handed to ScheduledMaintenanceService.create.
function eventPassedToCreate(): ScheduledMaintenance {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return createSpy.mock.calls[0]![0].data;
}

beforeEach((): void => {
  // Only Date is faked: "now" is pinned, every real timer keeps running.
  jest.useFakeTimers({
    now: NOW.getTime(),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });

  jest
    .spyOn(
      WorkspaceProjectReferenceValidator,
      "validateReferencesBelongToProject",
    )
    .mockResolvedValue();
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue();

  const created: ScheduledMaintenance = new ScheduledMaintenance();
  created.id = CREATED_ID;
  created.projectId = PROJECT_ID;
  createSpy = jest
    .spyOn(ScheduledMaintenanceService, "create")
    .mockResolvedValue(created);
  jest
    .spyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    )
    .mockResolvedValue(MAINTENANCE_LINK);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach((): void => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Microsoft Teams: a maintenance form submitted to a server in Los Angeles", (): void => {
  test("the server really is in Los Angeles, where the old reading of 14:00 lands at 21:00 UTC", (): void => {
    // Without this, every test below could pass on a UTC server by accident.
    expect(new Date(2030, 9, 1, 14, 0).toISOString()).toBe(
      "2030-10-01T21:00:00.000Z",
    );
    expect(NOW.getHours()).toBe(5);

    // What the handler before the fix stored for "2030-10-01" and "14:00".
    expect(OneUptimeDate.fromString("2030-10-01T14:00").toISOString()).toBe(
      "2030-10-01T21:00:00.000Z",
    );
  });

  type ZoneCase = {
    source: string;
    activity: JSONObject;
    cardTimezone?: string | undefined;
    startsAt: string;
    endsAt: string;
    label: string;
    // Only a UTC offset was known, and the confirmation says so.
    isOffsetOnly?: boolean | undefined;
  };

  // The same instants MicrosoftTeamsCreateSubmit.test.ts expects on a UTC server.
  const ZONE_CASES: Array<ZoneCase> = [
    {
      source: "the submitter's localTimezone (America/New_York)",
      activity: { localTimezone: "America/New_York" },
      startsAt: "2030-10-01T18:00:00.000Z",
      endsAt: "2030-10-01T19:00:00.000Z",
      label: "America/New_York",
    },
    {
      // The form told whoever filled it in which zone to type the times in.
      source:
        "the zone the form names (Asia/Kolkata), over the submitter's localTimezone (America/New_York)",
      activity: { localTimezone: "America/New_York" },
      cardTimezone: "Asia/Kolkata",
      startsAt: "2030-10-01T08:30:00.000Z",
      endsAt: "2030-10-01T09:30:00.000Z",
      label: "Asia/Kolkata",
    },
    {
      source: "the clientInfo entity (Europe/Berlin)",
      activity: {
        entities: [{ type: "clientInfo", timezone: "Europe/Berlin" }],
      },
      startsAt: "2030-10-01T12:00:00.000Z",
      endsAt: "2030-10-01T13:00:00.000Z",
      label: "Europe/Berlin",
    },
    {
      source: "the zone the form was sent for (Asia/Kolkata)",
      activity: {},
      cardTimezone: "Asia/Kolkata",
      startsAt: "2030-10-01T08:30:00.000Z",
      endsAt: "2030-10-01T09:30:00.000Z",
      label: "Asia/Kolkata",
    },
    {
      source: "the UTC offset of rawLocalTimestamp (+05:30)",
      activity: {
        localTimestamp: new Date("2026-09-29T12:00:00.000Z"),
        rawLocalTimestamp: "2026-09-29T17:30:00.000+05:30",
      },
      startsAt: "2030-10-01T08:30:00.000Z",
      endsAt: "2030-10-01T09:30:00.000Z",
      label: "UTC+05:30",
      isOffsetOnly: true,
    },
    {
      // Not the server's own -07:00, though it is on the same side of UTC.
      source: "the UTC offset of a string localTimestamp (-04:00)",
      activity: { localTimestamp: "2026-09-29T08:00:00.000-04:00" },
      startsAt: "2030-10-01T18:00:00.000Z",
      endsAt: "2030-10-01T19:00:00.000Z",
      label: "UTC-04:00",
      isOffsetOnly: true,
    },
    {
      // Here the old code stored 21:00 UTC: the server's 14:00.
      source: "nothing: UTC, not the server's Los Angeles",
      activity: {},
      startsAt: "2030-10-01T14:00:00.000Z",
      endsAt: "2030-10-01T15:00:00.000Z",
      label: "UTC",
    },
  ];

  test.each(ZONE_CASES)(
    "stores what a UTC server stores, with the zone from $source",
    async (zoneCase: ZoneCase): Promise<void> => {
      const turn: FakeTurn = createFakeTurn(zoneCase.activity);

      await submitMaintenance(
        turn,
        maintenanceForm(
          zoneCase.cardTimezone ? { timezone: zoneCase.cardTimezone } : {},
        ),
      );

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
        zoneCase.startsAt,
      );
      expect(scheduledMaintenance.endsAt?.toISOString()).toBe(zoneCase.endsAt);

      /*
       * Echoed as typed, in the zone used, not as the server's clock shows
       * it; a bare offset is today's, and the confirmation says so.
       */
      const offsetNote: string = zoneCase.isOffsetOnly
        ? `\n\nMicrosoft Teams did not say which time zone you are in, so these times were read at your current offset, ${zoneCase.label}. If daylight saving time changes before then, check them in OneUptime.`
        : "";
      expect(turn.replies).toEqual([
        `✅ Scheduled maintenance created successfully!\n\n**Starts:** Oct 1, 2030, 14:00 (${zoneCase.label})\n\n**Ends:** Oct 1, 2030, 15:00 (${zoneCase.label})${offsetNote}\n\nView scheduled maintenance: ${MAINTENANCE_LINK.toString()}`,
      ]);
    },
  );

  test("a user in Los Angeles too gets Los Angeles time, because Teams says so", async (): Promise<void> => {
    const turn: FakeTurn = createFakeTurn({
      localTimezone: "America/Los_Angeles",
    });

    await submitMaintenance(turn, maintenanceForm());

    const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
    expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
      "2030-10-01T21:00:00.000Z",
    );
    expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
      "2030-10-01T22:00:00.000Z",
    );
    expect(turn.replies[0]).toContain(
      "**Starts:** Oct 1, 2030, 14:00 (America/Los_Angeles)",
    );
  });

  test("a Berlin date in the week Europe has left summer time and Los Angeles has not uses Berlin's winter offset", async (): Promise<void> => {
    /*
     * On Oct 28, 2030 Berlin is on CET (UTC+1) while Los Angeles is still on
     * PDT, and on the pinned day Berlin is on CEST (UTC+2). Only Berlin's own
     * rules for that date give 13:00 UTC.
     */
    const turn: FakeTurn = createFakeTurn({ localTimezone: "Europe/Berlin" });

    await submitMaintenance(
      turn,
      maintenanceForm({ startDate: "2030-10-28", endDate: "2030-10-28" }),
    );

    const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
    expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
      "2030-10-28T13:00:00.000Z",
    );
    expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
      "2030-10-28T14:00:00.000Z",
    );
  });

  test("the start-in-the-past check compares instants: 10:00 UTC today is refused, though 10:00 in Los Angeles is still ahead", async (): Promise<void> => {
    // Read in the server's zone, 10:00 would be 17:00 UTC, five hours from now.
    const turn: FakeTurn = createFakeTurn({});

    await submitMaintenance(
      turn,
      maintenanceForm({
        startDate: "2026-09-29",
        startTime: "10:00",
        endDate: "2026-09-29",
        endTime: "11:00",
      }),
    );

    expect(turn.replies).toEqual([
      "Unable to create scheduled maintenance: the start time (Sep 29, 2026, 10:00 (UTC)) is in the past.",
    ]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a start that went by three minutes ago starts now: the grace is measured in instants, not on the server's clock", async (): Promise<void> => {
    /*
     * 12:03 UTC is 05:03 on the server. Read on the server's clock, 12:00
     * would be seven hours ahead (19:00 UTC) and stored as such.
     */
    jest.setSystemTime(new Date("2026-09-29T12:03:00.000Z"));
    const turn: FakeTurn = createFakeTurn({});

    await submitMaintenance(
      turn,
      maintenanceForm({
        startDate: "2026-09-29",
        startTime: "12:00",
        endDate: "2026-09-29",
        endTime: "13:00",
      }),
    );

    const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
    expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
      "2026-09-29T12:03:00.000Z",
    );
    expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
      "2026-09-29T13:00:00.000Z",
    );
    expect(turn.replies).toEqual([
      `✅ Scheduled maintenance created successfully!\n\n**Starts:** Sep 29, 2026, 12:03 (UTC)\n\n**Ends:** Sep 29, 2026, 13:00 (UTC)\n\nView scheduled maintenance: ${MAINTENANCE_LINK.toString()}`,
    ]);
  });
});
