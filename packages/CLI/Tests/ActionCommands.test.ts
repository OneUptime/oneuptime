import { ApiRequestOptions } from "../Core/ApiClient";

const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import {
  clearTestCredentials,
  CliRun,
  INCIDENT_ID,
  OTHER_STATE_ID,
  printedJson,
  runCli,
  STATE_ID,
  useTestCredentials,
} from "./Helpers/RunCli";
import { CliAction } from "Common/Utils/DeveloperDocs/CliCommands";

/*
 * The dashboard's buttons as commands (Commands/ActionCommands.ts): each
 * finds the project's state, reads the record's, and moves the record by a
 * row of its state timeline - or leaves a record that is there already as
 * it is. Notes are records of their own.
 */

interface StateRow {
  _id: string;
  name: string;
  order: number;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
  isOngoingState?: boolean;
  isEndedState?: boolean;
}

const ACKNOWLEDGED: StateRow = {
  _id: STATE_ID,
  name: "Acknowledged",
  order: 2,
  isAcknowledgedState: true,
  isResolvedState: false,
};

const CREATED: StateRow = {
  _id: OTHER_STATE_ID,
  name: "Created",
  order: 1,
  isAcknowledgedState: false,
  isResolvedState: false,
};

/*
 * Answers like OneUptime: the project's first state with the asked flag,
 * and the record in `current`.
 */
function project(data: {
  target: StateRow | null;
  current: StateRow | null;
  currentRelation?: string;
}): void {
  mockExecuteApiRequest.mockImplementation(
    async (options: ApiRequestOptions): Promise<unknown> => {
      if (options.operation === "list") {
        return data.target ? [data.target] : [];
      }

      if (options.operation === "read") {
        return {
          _id: options.id,
          [data.currentRelation || "currentIncidentState"]: data.current,
        };
      }

      return { _id: "9f5d8e1a-0c2b-4d4e-8f7a-8b9c0d1e2f3a" };
    },
  );
}

function requests(): Array<ApiRequestOptions> {
  return mockExecuteApiRequest.mock.calls.map(
    (call: Array<unknown>): ApiRequestOptions => {
      return call[0] as ApiRequestOptions;
    },
  );
}

function resource(name: string): ResourceInfo {
  return discoverResources().find((candidate: ResourceInfo): boolean => {
    return candidate.name === name;
  }) as ResourceInfo;
}

describe("the dashboard's buttons as commands", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    useTestCredentials();
  });

  afterEach(() => {
    clearTestCredentials();
  });

  it("are the actions of incidents, alerts, their episodes and scheduled maintenance, and of nothing else", () => {
    expect(resource("incident").actions).toEqual([
      CliAction.Acknowledge,
      CliAction.Resolve,
      CliAction.AddNote,
    ]);
    expect(resource("alert").actions).toEqual([
      CliAction.Acknowledge,
      CliAction.Resolve,
      CliAction.AddNote,
    ]);
    expect(resource("incident-episode").actions).toEqual([
      CliAction.Acknowledge,
      CliAction.Resolve,
      CliAction.AddNote,
    ]);
    expect(resource("alert-episode").actions).toEqual([
      CliAction.Acknowledge,
      CliAction.Resolve,
      CliAction.AddNote,
    ]);
    expect(resource("scheduled-maintenance-event").actions).toEqual([
      CliAction.Start,
      CliAction.End,
      CliAction.AddNote,
    ]);

    const withActions: Array<string> = discoverResources()
      .filter((candidate: ResourceInfo): boolean => {
        return candidate.actions.length > 0;
      })
      .map((candidate: ResourceInfo): string => {
        return candidate.name;
      });

    expect(withActions.sort()).toEqual(
      [
        "alert",
        "alert-episode",
        "incident",
        "incident-episode",
        "scheduled-maintenance-event",
      ].sort(),
    );
  });

  it("acknowledge an incident: the project's acknowledged state, the incident's own, then a timeline row", async () => {
    project({ target: ACKNOWLEDGED, current: CREATED });

    const run: CliRun = await runCli([
      "incident",
      "acknowledge",
      INCIDENT_ID,
      "--json",
    ]);

    expect(run.exitCode).toBeUndefined();

    const [states, record, timeline] = requests() as [
      ApiRequestOptions,
      ApiRequestOptions,
      ApiRequestOptions,
    ];

    expect(requests()).toHaveLength(3);
    expect(states).toEqual(
      expect.objectContaining({
        apiPath: "/incident-state",
        operation: "list",
        query: { isAcknowledgedState: true },
        sort: { order: "ASC" },
        limit: 1,
      }),
    );
    expect(record).toEqual(
      expect.objectContaining({
        apiPath: "/incident",
        operation: "read",
        id: INCIDENT_ID,
      }),
    );
    expect(Object.keys(record.select || {})).toContain("currentIncidentState");
    expect(timeline).toEqual(
      expect.objectContaining({
        apiPath: "/incident-state-timeline",
        operation: "create",
        data: { incidentId: INCIDENT_ID, incidentStateId: STATE_ID },
      }),
    );
    expect(printedJson(run)).toEqual({
      _id: INCIDENT_ID,
      action: "acknowledge",
      changed: true,
      state: { _id: STATE_ID, name: "Acknowledged" },
    });
  });

  it("leave an acknowledged incident as it is, exit 0, and say nothing changed", async () => {
    project({ target: ACKNOWLEDGED, current: ACKNOWLEDGED });

    const run: CliRun = await runCli([
      "incident",
      "acknowledge",
      INCIDENT_ID,
      "--json",
    ]);

    expect(run.exitCode).toBeUndefined();
    expect(
      requests().map((request: ApiRequestOptions) => {
        return request.operation;
      }),
    ).toEqual(["list", "read"]);
    expect(printedJson(run)).toEqual({
      _id: INCIDENT_ID,
      action: "acknowledge",
      changed: false,
      state: { _id: STATE_ID, name: "Acknowledged" },
    });
  });

  it("count a state after Acknowledged as acknowledged, as the dashboard does, and a resolved one", async () => {
    const investigating: StateRow = {
      _id: OTHER_STATE_ID,
      name: "Investigating",
      order: 3,
      isAcknowledgedState: false,
      isResolvedState: false,
    };

    project({ target: ACKNOWLEDGED, current: investigating });

    const later: CliRun = await runCli([
      "incident",
      "acknowledge",
      INCIDENT_ID,
    ]);

    expect(later.exitCode).toBeUndefined();
    expect(later.printed.join("\n")).toBe(
      `Incident ${INCIDENT_ID} is acknowledged already: it is in Investigating. Nothing changed.`,
    );

    mockExecuteApiRequest.mockReset();
    project({
      target: ACKNOWLEDGED,
      current: {
        ...investigating,
        name: "Resolved",
        order: 4,
        isResolvedState: true,
      },
    });

    await runCli(["incident", "acknowledge", INCIDENT_ID]);

    expect(
      requests().some((request: ApiRequestOptions) => {
        return request.operation === "create";
      }),
    ).toBe(false);
  });

  it("resolve an incident unless it is resolved, and say so in a terminal", async () => {
    const resolved: StateRow = {
      _id: STATE_ID,
      name: "Resolved",
      order: 3,
      isAcknowledgedState: false,
      isResolvedState: true,
    };

    project({ target: resolved, current: ACKNOWLEDGED });

    const run: CliRun = await runCli(["incident", "resolve", INCIDENT_ID]);

    expect(requests()[0]?.query).toEqual({ isResolvedState: true });
    expect(requests()[2]?.data).toEqual({
      incidentId: INCIDENT_ID,
      incidentStateId: STATE_ID,
    });
    expect(run.printed.join("\n")).toBe(
      `Incident ${INCIDENT_ID} resolved: it is in Resolved now.`,
    );

    mockExecuteApiRequest.mockReset();
    project({ target: resolved, current: resolved });

    const again: CliRun = await runCli([
      "incident",
      "resolve",
      INCIDENT_ID,
      "--json",
    ]);

    expect((printedJson(again) as { changed: boolean }).changed).toBe(false);
    expect(requests()).toHaveLength(2);
  });

  it.each([
    [
      "alert",
      "/alert-state",
      "/alert-state-timeline",
      "alertId",
      "alertStateId",
      "currentAlertState",
    ],
    [
      "incident-episode",
      "/incident-state",
      "/incident-episode-state-timeline",
      "incidentEpisodeId",
      "incidentStateId",
      "currentIncidentState",
    ],
    [
      "alert-episode",
      "/alert-state",
      "/alert-episode-state-timeline",
      "alertEpisodeId",
      "alertStateId",
      "currentAlertState",
    ],
  ])(
    "acknowledge %s through its own states and timeline",
    async (
      name: string,
      statePath: string,
      timelinePath: string,
      recordColumn: string,
      stateColumn: string,
      relation: string,
    ) => {
      project({
        target: ACKNOWLEDGED,
        current: CREATED,
        currentRelation: relation,
      });

      const run: CliRun = await runCli([
        name,
        "acknowledge",
        INCIDENT_ID,
        "--json",
      ]);

      expect(run.exitCode).toBeUndefined();
      expect(requests()[0]?.apiPath).toBe(statePath);
      expect(Object.keys(requests()[1]?.select || {})).toContain(relation);
      expect(requests()[2]).toEqual(
        expect.objectContaining({
          apiPath: timelinePath,
          operation: "create",
          data: { [recordColumn]: INCIDENT_ID, [stateColumn]: STATE_ID },
        }),
      );
    },
  );

  it("start and end scheduled maintenance through its ongoing and ended states", async () => {
    const ongoing: StateRow = {
      _id: STATE_ID,
      name: "Ongoing",
      order: 2,
      isOngoingState: true,
    };

    project({
      target: ongoing,
      current: {
        _id: OTHER_STATE_ID,
        name: "Scheduled",
        order: 1,
        isOngoingState: false,
      },
      currentRelation: "currentScheduledMaintenanceState",
    });

    await runCli(["scheduled-maintenance-event", "start", INCIDENT_ID]);

    expect(requests()[0]).toEqual(
      expect.objectContaining({
        apiPath: "/scheduled-maintenance-state",
        query: { isOngoingState: true },
      }),
    );
    expect(requests()[2]).toEqual(
      expect.objectContaining({
        apiPath: "/scheduled-maintenance-state-timeline",
        data: {
          scheduledMaintenanceId: INCIDENT_ID,
          scheduledMaintenanceStateId: STATE_ID,
        },
      }),
    );

    mockExecuteApiRequest.mockReset();
    project({
      target: { _id: STATE_ID, name: "Ended", order: 3, isEndedState: true },
      current: ongoing,
      currentRelation: "currentScheduledMaintenanceState",
    });

    await runCli(["scheduled-maintenance-event", "end", INCIDENT_ID]);

    expect(requests()[0]?.query).toEqual({ isEndedState: true });
    expect(requests()[2]?.operation).toBe("create");
  });

  it("refuse an ID that is none before asking OneUptime anything", async () => {
    const run: CliRun = await runCli(["incident", "acknowledge", "INC-18"]);

    expect(run.exitCode).toBe(1);
    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(run.errors.join("\n")).toContain(
      '"INC-18" is not an ID. IDs look like 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11: `oneuptime incident list` shows them.',
    );
  });

  it("say what the key needs when it may not read the project's states", async () => {
    project({ target: null, current: CREATED });

    const run: CliRun = await runCli(["incident", "acknowledge", INCIDENT_ID]);

    expect(run.exitCode).toBe(1);
    expect(run.errors.join("\n")).toContain(
      'This project has no state for "acknowledge" that this key may read.',
    );
  });

  it("add an internal note to an incident, or a public one with --public", async () => {
    project({ target: null, current: null });

    const internal: CliRun = await runCli([
      "incident",
      "add-note",
      INCIDENT_ID,
      "--note",
      "Rolled back the 14:05 deploy.",
    ]);

    expect(requests()[0]).toEqual(
      expect.objectContaining({
        apiPath: "/incident-internal-note",
        operation: "create",
        data: {
          incidentId: INCIDENT_ID,
          note: "Rolled back the 14:05 deploy.",
        },
      }),
    );
    // It names the record, as acknowledge and resolve do.
    expect(internal.printed.join("\n")).toBe(
      `Added the note to Incident ${INCIDENT_ID}. Only the people who can see the Incident can read it.`,
    );

    mockExecuteApiRequest.mockReset();
    project({ target: null, current: null });

    const shared: CliRun = await runCli([
      "incident",
      "add-note",
      INCIDENT_ID,
      "--note",
      "We found the cause.",
      "--public",
      "--json",
    ]);

    expect(requests()[0]?.apiPath).toBe("/incident-public-note");
    expect(printedJson(shared)).toEqual({
      _id: "9f5d8e1a-0c2b-4d4e-8f7a-8b9c0d1e2f3a",
      recordId: INCIDENT_ID,
      visibility: "public",
    });

    mockExecuteApiRequest.mockReset();
    project({ target: null, current: null });

    const posted: CliRun = await runCli([
      "incident",
      "add-note",
      INCIDENT_ID,
      "--note",
      "We found the cause.",
      "--public",
    ]);

    expect(posted.printed.join("\n")).toBe(
      `Posted the note on the status pages that show Incident ${INCIDENT_ID}.`,
    );
  });

  it("give an alert, which has no status page notes, no --public", async () => {
    const run: CliRun = await runCli(["alert", "add-note", "--help"]);
    const help: string = run.printed.join("\n");

    expect(help).toContain("--note <markdown>");
    // Commander marks no option required: the description says it.
    expect(help).toContain("Required. The note, in Markdown");
    expect(help).not.toContain("--public");

    const incident: CliRun = await runCli(["incident", "add-note", "--help"]);

    expect(incident.printed.join("\n")).toContain("--public");
  });

  it("need the note's text", async () => {
    const missing: CliRun = await runCli(["incident", "add-note", INCIDENT_ID]);

    expect(missing.exitCode).toBe(1);
    expect(missing.errors.join("\n")).toContain(
      "required option '--note <markdown>' not specified",
    );

    const blank: CliRun = await runCli([
      "incident",
      "add-note",
      INCIDENT_ID,
      "--note",
      "  ",
    ]);

    expect(blank.exitCode).toBe(1);
    expect(blank.errors.join("\n")).toContain("--note needs the note's text.");
    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
  });
});
