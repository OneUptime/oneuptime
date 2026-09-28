import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Editing an incident's Affected Resources sends its monitor list, and the
 * status it puts its monitors in, back with every save. What that does to
 * the monitors themselves:
 *
 *   - a resolved incident touches no monitor. Resolving it restored its
 *     monitors, and nothing would ever undo a status (or, for a manual
 *     incident, the switch that stops probing) put on them afterwards;
 *   - an open incident puts the monitors added in its status, all of its
 *     monitors only when the edit changes that status, and restores the
 *     monitors taken off it;
 *   - a monitor taken off is restored whenever the incident was open before
 *     the update, even when the same update resolves it: resolving restores
 *     only the monitors the incident still holds;
 *   - an update that sends only the status (API, CLI, workflow) changes no
 *     membership, and must not throw;
 *   - the feed says "Monitor Status Changed" only when it did.
 *
 * Both hooks run for real, in order: onBeforeUpdate reads the stored
 * incidents through a stub of findBy and hands its carry-forward to
 * onUpdateSuccess. What the database holds after the write is served by a
 * stub of findOneById, and whether the incident is resolved by a stub of
 * isIncidentResolved (the stored state before the write, the state after it
 * from then on). The monitor side effects are spies.
 */

const projectId: ObjectID = new ObjectID(
  "6e1f0b2a-7c3d-4e5f-8a9b-0c1d2e3f4a01",
);
const userId: ObjectID = new ObjectID("6e1f0b2a-7c3d-4e5f-8a9b-0c1d2e3f4a02");

const INCIDENT_ID: string = "c1000000-0000-4000-8000-000000000001";
const SECOND_INCIDENT_ID: string = "c1000000-0000-4000-8000-000000000002";

const MONITOR_A: string = "d2000000-0000-4000-8000-00000000000a";
const MONITOR_B: string = "d2000000-0000-4000-8000-00000000000b";
const MONITOR_C: string = "d2000000-0000-4000-8000-00000000000c";

const OFFLINE: string = "e3000000-0000-4000-8000-0000000000f1";
const DEGRADED: string = "e3000000-0000-4000-8000-0000000000f2";

const RESOLVED_STATE: string = "f4000000-0000-4000-8000-0000000000aa";
// A state ordered after Resolved, so an incident in it is resolved too.
const CLOSED_STATE: string = "f4000000-0000-4000-8000-0000000000ab";
const ACKNOWLEDGED_STATE: string = "f4000000-0000-4000-8000-0000000000a2";

const HOST_ID: string = "a5000000-0000-4000-8000-000000000001";

const MONITOR_NAMES: Dictionary<string> = {
  [MONITOR_A]: "checkout-web",
  [MONITOR_B]: "payments-api",
  [MONITOR_C]: "search-api",
};

const STATUS_NAMES: Dictionary<string> = {
  [OFFLINE]: "Offline",
  [DEGRADED]: "Degraded",
};

// An update that matches several incidents can write to up to this many.
const LIMIT_FOR_TEST: number = 10;

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: userId,
};

type OnBeforeUpdate = (
  updateBy: UpdateBy<Incident>,
) => Promise<OnUpdate<Incident>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Incident>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Incident>>;

interface MonitorCarryForward {
  monitorsRemoved: Array<Monitor>;
  monitorsAdded: Array<Monitor>;
  isResolvedBeforeUpdate?: boolean | undefined;
  oldChangeMonitorStatusIdTo: ObjectID | undefined;
  newMonitorChangeStatusIdTo: ObjectID | undefined;
  isChangeMonitorStatusToCleared?: boolean | undefined;
}

// An incident as the database holds it before the update.
interface StoredIncident {
  id: string;
  incidentNumber: number;
  monitorIds: Array<string>;
  changeMonitorStatusToId: string | undefined;
  // Resolved before the update, and after it unless the update moves it.
  isResolved: boolean;
  isCreatedAutomatically: boolean;
}

function storedIncident(
  overrides: Partial<StoredIncident> = {},
): StoredIncident {
  return {
    id: INCIDENT_ID,
    incidentNumber: 42,
    monitorIds: [MONITOR_A],
    changeMonitorStatusToId: OFFLINE,
    isResolved: false,
    isCreatedAutomatically: false,
    ...overrides,
  };
}

function monitorStub(id: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  return monitor;
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsInQueryOperator(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<Array<unknown>>
  )
    .flat()
    .map((id: unknown): string => {
      return String(id).toLowerCase();
    });
}

function lowercaseIds(ids: Array<unknown>): Array<string> {
  return ids.map((id: unknown): string => {
    return String(id).toLowerCase();
  });
}

let storedIncidents: Array<StoredIncident> = [];
// The monitors each incident holds once the update is written.
let monitorsAfterWrite: Dictionary<Array<string>> = {};
// Whether each incident is resolved once the update is written.
let resolvedAfterWrite: Dictionary<boolean> = {};

let disableActiveMonitoringSpy: jest.SpyInstance;
let changeMonitorStatus: MockFunction;
let markMonitorsActive: MockFunction;
let disableActiveMonitoring: MockFunction;
let isIncidentResolved: MockFunction;
let createFeedItem: MockFunction;
let monitorUpdateOneById: MockFunction;

/*
 * Whether an incident is resolved at this point of the update: as stored
 * until the write, as the write (or a state change after it) left it from
 * then on.
 */
function isResolvedNow(incidentId: string): boolean {
  if (resolvedAfterWrite[incidentId] !== undefined) {
    return resolvedAfterWrite[incidentId] === true;
  }

  const stored: StoredIncident | undefined = storedIncidents.find(
    (incident: StoredIncident): boolean => {
      return incident.id === incidentId;
    },
  );

  return stored?.isResolved === true;
}

/*
 * The update moves the incident to another state: changeIncidentState runs
 * in onUpdateSuccess, and from then on the incident is resolved or not as
 * given. The calls, and the isIncidentResolved reads around them, are
 * recorded in order.
 */
function stubStateChange(
  isResolvedAfterStateChange: boolean,
  order: Array<string>,
): void {
  jest
    .spyOn(IncidentService, "changeIncidentState")
    .mockImplementation(((data: { incidentId: ObjectID }): Promise<void> => {
      order.push("changeIncidentState");
      resolvedAfterWrite[data.incidentId.toString()] =
        isResolvedAfterStateChange;
      return Promise.resolve();
    }) as never);

  isIncidentResolved.mockImplementation(
    (data: { incidentId: ObjectID }): Promise<boolean> => {
      const isResolved: boolean = isResolvedNow(data.incidentId.toString());
      order.push(`isIncidentResolved:${isResolved}`);
      return Promise.resolve(isResolved);
    },
  );
}

function monitorIdsOf(monitors: Array<Monitor>): Array<string> {
  return monitors.map((monitor: Monitor): string => {
    return monitor._id!.toString().toLowerCase();
  });
}

// The monitors restored, one list per markMonitorsActiveForMonitoring call.
function monitorsRestored(): Array<Array<string>> {
  return markMonitorsActive.mock.calls.map(
    (args: Array<unknown>): Array<string> => {
      return monitorIdsOf(args[1] as Array<Monitor>);
    },
  );
}

/*
 * The monitors a write leaves on an incident: the list the update sends,
 * or the stored ones when it sends none (null clears the list).
 */
function monitorIdsWritten(
  data: Dictionary<unknown>,
  incident: StoredIncident,
): Array<string> {
  if (data["monitors"] === undefined) {
    return incident.monitorIds;
  }

  return ((data["monitors"] as Array<unknown> | null) || []).map(
    (entry: unknown): string => {
      if (typeof entry === "string") {
        return entry.toLowerCase();
      }

      if (entry instanceof ObjectID) {
        return entry.toString().toLowerCase();
      }

      return String((entry as { _id?: unknown })._id).toLowerCase();
    },
  );
}

function makeUpdateBy(
  data: Dictionary<unknown>,
  query: Dictionary<unknown> = { _id: INCIDENT_ID },
): UpdateBy<Incident> {
  return {
    query: query as UpdateBy<Incident>["query"],
    data: data as UpdateBy<Incident>["data"],
    props: PROPS,
    limit: LIMIT_FOR_TEST,
    skip: 0,
  };
}

async function runBeforeUpdate(
  updateBy: UpdateBy<Incident>,
): Promise<OnUpdate<Incident>> {
  return await (
    IncidentService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate(updateBy);
}

function monitorCarryForwardOf(
  onUpdate: OnUpdate<Incident>,
  incidentId: string = INCIDENT_ID,
): MonitorCarryForward {
  return (onUpdate.carryForward as Dictionary<MonitorCarryForward>)[
    incidentId
  ]!;
}

/*
 * One update end to end: onBeforeUpdate, the write (what findOneById and
 * isIncidentResolved answer from then on), and onUpdateSuccess.
 */
async function runUpdate(
  data: Dictionary<unknown>,
  options: {
    query?: Dictionary<unknown>;
    monitorsAfterWrite?: Dictionary<Array<string>>;
  } = {},
): Promise<OnUpdate<Incident>> {
  const updateBy: UpdateBy<Incident> = makeUpdateBy(data, options.query);

  const onUpdate: OnUpdate<Incident> = await runBeforeUpdate(updateBy);

  for (const incident of storedIncidents) {
    monitorsAfterWrite[incident.id] =
      options.monitorsAfterWrite?.[incident.id] ||
      monitorIdsWritten(data, incident);
    resolvedAfterWrite[incident.id] = incident.isResolved;
  }

  await (
    IncidentService as unknown as { onUpdateSuccess: OnUpdateSuccess }
  ).onUpdateSuccess(
    onUpdate,
    storedIncidents.map((incident: StoredIncident): ObjectID => {
      return new ObjectID(incident.id);
    }),
  );

  return onUpdate;
}

// The feed item written for an incident, or undefined when none was.
function feedMarkdownFor(incidentId: string = INCIDENT_ID): string | undefined {
  const call: Array<unknown> | undefined = createFeedItem.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (
        String((args[0] as { incidentId: ObjectID }).incidentId) === incidentId
      );
    },
  );

  if (!call) {
    return undefined;
  }

  return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
}

function monitorLink(monitorId: string): string {
  return `https://oneuptime.example/monitors/${monitorId}`;
}

// The status changes made, as [monitor ids, status id] per call.
function statusChanges(): Array<[Array<string>, string]> {
  return changeMonitorStatus.mock.calls.map(
    (args: Array<unknown>): [Array<string>, string] => {
      return [
        lowercaseIds(args[1] as Array<ObjectID>),
        String(args[2]).toLowerCase(),
      ];
    },
  );
}

beforeEach(() => {
  storedIncidents = [storedIncident()];
  monitorsAfterWrite = {};
  resolvedAfterWrite = {};

  jest.spyOn(IncidentService, "findBy").mockImplementation((() => {
    return Promise.resolve(
      storedIncidents.map((stored: StoredIncident): Incident => {
        const incident: Incident = new Incident();
        incident._id = stored.id;
        incident.projectId = projectId;
        incident.monitors = stored.monitorIds.map(monitorStub);
        if (stored.changeMonitorStatusToId) {
          incident.changeMonitorStatusToId = new ObjectID(
            stored.changeMonitorStatusToId,
          );
        }
        return incident;
      }),
    );
  }) as never);

  jest.spyOn(IncidentService, "findOneById").mockImplementation(((findBy: {
    id: ObjectID;
  }): Promise<Incident | null> => {
    const stored: StoredIncident | undefined = storedIncidents.find(
      (incident: StoredIncident): boolean => {
        return incident.id === findBy.id.toString();
      },
    );

    if (!stored) {
      return Promise.resolve(null);
    }

    const incident: Incident = new Incident();
    incident._id = stored.id;
    incident.projectId = projectId;
    incident.incidentNumber = stored.incidentNumber;
    incident.incidentNumberWithPrefix = `INC-${stored.incidentNumber}`;
    incident.isCreatedAutomatically = stored.isCreatedAutomatically;
    incident.monitors = (
      monitorsAfterWrite[stored.id] || stored.monitorIds
    ).map(monitorStub);
    return Promise.resolve(incident);
  }) as never);

  isIncidentResolved = getJestMockFunction();
  isIncidentResolved.mockImplementation(
    (data: { incidentId: ObjectID }): Promise<boolean> => {
      return Promise.resolve(isResolvedNow(data.incidentId.toString()));
    },
  );
  jest
    .spyOn(IncidentService, "isIncidentResolved")
    .mockImplementation(isIncidentResolved as never);

  markMonitorsActive = getJestMockFunction();
  markMonitorsActive.mockResolvedValue(undefined);
  jest
    .spyOn(IncidentService, "markMonitorsActiveForMonitoring")
    .mockImplementation(markMonitorsActive as never);

  disableActiveMonitoring = getJestMockFunction();
  disableActiveMonitoring.mockResolvedValue(undefined);
  // Restored by the tests that follow the real one down to the monitors.
  disableActiveMonitoringSpy = jest
    .spyOn(IncidentService, "disableActiveMonitoringIfManualIncident")
    .mockImplementation(
      disableActiveMonitoring as never,
    ) as unknown as jest.SpyInstance;

  changeMonitorStatus = getJestMockFunction();
  changeMonitorStatus.mockResolvedValue(undefined);
  jest
    .spyOn(MonitorService, "changeMonitorStatus")
    .mockImplementation(changeMonitorStatus as never);

  monitorUpdateOneById = getJestMockFunction();
  monitorUpdateOneById.mockResolvedValue(undefined);
  jest
    .spyOn(MonitorService, "updateOneById")
    .mockImplementation(monitorUpdateOneById as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation(((findBy: {
    query: { _id: unknown };
  }): Promise<Array<Monitor>> => {
    return Promise.resolve(
      idsInQueryOperator(findBy.query._id).map((id: string): Monitor => {
        const monitor: Monitor = monitorStub(id);
        monitor.name = MONITOR_NAMES[id] || id;
        return monitor;
      }),
    );
  }) as never);

  jest.spyOn(MonitorService, "getMonitorLinkInDashboard").mockImplementation(((
    _projectId: ObjectID,
    monitorId: ObjectID,
  ) => {
    return Promise.resolve(URL.fromString(monitorLink(monitorId.toString())));
  }) as never);

  jest.spyOn(MonitorStatusService, "findOneBy").mockImplementation(((findBy: {
    query: { _id: unknown };
  }): Promise<MonitorStatus | null> => {
    const id: string = String(findBy.query._id).toLowerCase();

    if (!STATUS_NAMES[id]) {
      return Promise.resolve(null);
    }

    const status: MonitorStatus = new MonitorStatus();
    status._id = id;
    status.name = STATUS_NAMES[id];
    return Promise.resolve(status);
  }) as never);

  createFeedItem = getJestMockFunction();
  createFeedItem.mockResolvedValue(undefined);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(createFeedItem as never);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/incidents"));

  jest
    .spyOn(
      IncidentService as unknown as {
        validateProjectScopedReferences: () => Promise<void>;
      },
      "validateProjectScopedReferences",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService: editing the monitors of a resolved incident", () => {
  beforeEach(() => {
    storedIncidents = [storedIncident({ isResolved: true })];
  });

  test("adding a monitor puts no monitor back in the incident's status, and the feed still lists it", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    expect(markMonitorsActive).not.toHaveBeenCalled();

    const markdown: string | undefined = feedMarkdownFor();

    expect(markdown).toContain(
      `**🌎 Monitors Added**:\n- [payments-api](${monitorLink(MONITOR_B)})\n`,
    );
    expect(markdown).not.toContain("checkout-web");
    expect(markdown).not.toContain("Monitor Status Changed");
  });

  test("a manual incident's added monitor is never switched off active monitoring", async () => {
    /*
     * The switch is only cleared when an incident resolves, so setting it on
     * a resolved incident stops probing the monitor for good.
     */
    disableActiveMonitoringSpy.mockRestore();

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(monitorUpdateOneById).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("removing a monitor does not restore it again", async () => {
    storedIncidents = [
      storedIncident({ isResolved: true, monitorIds: [MONITOR_A, MONITOR_B] }),
    ];

    await runUpdate({
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain(
      `**🗑️ Monitors Removed**:\n- [payments-api](${monitorLink(MONITOR_B)})\n`,
    );
  });

  test("changing the monitor status puts no monitor in it, and the feed records the change", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: DEGRADED },
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain(
      "**🔄 Monitor Status Changed**:\n- **From** Offline to Degraded",
    );
  });

  test("replacing every monitor touches none of them", async () => {
    await runUpdate({
      monitors: [MONITOR_B, MONITOR_C],
      changeMonitorStatusToId: DEGRADED,
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();

    const markdown: string | undefined = feedMarkdownFor();

    expect(markdown).toContain("**🗑️ Monitors Removed**:");
    expect(markdown).toContain("**🌎 Monitors Added**:");
  });

  test("the incident's state is read after the update is written", async () => {
    /*
     * An edit that resolves the incident and adds a monitor at once: changing
     * the state restores every monitor the incident holds then, the added
     * one included, so the added monitor must not be put in the incident's
     * status after that.
     */
    storedIncidents = [storedIncident({ isResolved: false })];

    const order: Array<string> = [];

    jest
      .spyOn(IncidentService, "changeIncidentState")
      .mockImplementation(((data: { incidentId: ObjectID }): Promise<void> => {
        order.push("changeIncidentState");
        resolvedAfterWrite[data.incidentId.toString()] = true;
        return Promise.resolve();
      }) as never);

    isIncidentResolved.mockImplementation(
      (data: { incidentId: ObjectID }): Promise<boolean> => {
        order.push("isIncidentResolved");
        return Promise.resolve(
          resolvedAfterWrite[data.incidentId.toString()] === true,
        );
      },
    );

    await runUpdate({
      currentIncidentStateId: new ObjectID(RESOLVED_STATE),
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(order).toEqual(["changeIncidentState", "isIncidentResolved"]);
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
  });
});

describe("IncidentService: editing the monitors of an open incident", () => {
  test("an added monitor is put in the incident's status, and only it", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);

    const args: Array<unknown> = changeMonitorStatus.mock.calls[0]!;

    expect(String(args[0])).toBe(projectId.toString());
    expect(lowercaseIds(args[1] as Array<ObjectID>)).toEqual([MONITOR_B]);
    expect(String(args[2])).toBe(OFFLINE);
    expect(args[3]).toBe(true);
    expect(args[4]).toBe(
      "Status was changed because Incident INC-42 was updated.",
    );
    expect(args[6]).toBe(PROPS);

    expect(disableActiveMonitoring).toHaveBeenCalledTimes(1);
    expect(String(disableActiveMonitoring.mock.calls[0]![0])).toBe(INCIDENT_ID);
    expect(markMonitorsActive).not.toHaveBeenCalled();

    expect(feedMarkdownFor()).toContain(
      `**🌎 Monitors Added**:\n- [payments-api](${monitorLink(MONITOR_B)})\n`,
    );
  });

  test("a manual incident stops probing its monitors when one is added", async () => {
    disableActiveMonitoringSpy.mockRestore();

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    const switchedOff: Array<string> = monitorUpdateOneById.mock.calls
      .filter((args: Array<unknown>): boolean => {
        return (
          (args[0] as { data: Dictionary<unknown> }).data[
            "disableActiveMonitoringBecauseOfManualIncident"
          ] === true
        );
      })
      .map((args: Array<unknown>): string => {
        return String((args[0] as { id: ObjectID }).id).toLowerCase();
      });

    expect(switchedOff.sort()).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("an automatically created incident leaves probing on when a monitor is added", async () => {
    storedIncidents = [storedIncident({ isCreatedAutomatically: true })];

    disableActiveMonitoringSpy.mockRestore();

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(monitorUpdateOneById).not.toHaveBeenCalled();
    expect(statusChanges()).toEqual([[[MONITOR_B], OFFLINE]]);
  });

  test("a removed monitor is restored, and no monitor is put in the status again", async () => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    await runUpdate({
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(markMonitorsActive).toHaveBeenCalledTimes(1);
    expect(String(markMonitorsActive.mock.calls[0]![0])).toBe(
      projectId.toString(),
    );
    expect(
      lowercaseIds(
        (markMonitorsActive.mock.calls[0]![1] as Array<Monitor>).map(
          (monitor: Monitor): string => {
            return monitor._id!.toString();
          },
        ),
      ),
    ).toEqual([MONITOR_B]);

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain(
      `**🗑️ Monitors Removed**:\n- [payments-api](${monitorLink(MONITOR_B)})\n`,
    );
  });

  test("replacing a monitor restores the old one and puts the new one in the status", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(
      (markMonitorsActive.mock.calls[0]![1] as Array<Monitor>).map(
        (monitor: Monitor): string => {
          return monitor._id!.toString();
        },
      ),
    ).toEqual([MONITOR_A]);
    expect(statusChanges()).toEqual([[[MONITOR_B], OFFLINE]]);
  });

  test("saving the edit form unchanged puts no monitor in the status again", async () => {
    /*
     * The Affected Resources form sends the monitors and the status back
     * with every save, here with only the hosts edited. A probe may have
     * moved a monitor out of the incident's status since; forcing it back
     * wrote "Status was changed because Incident #N was updated.".
     */
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
      hosts: [{ _id: HOST_ID }],
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    // Nothing changed for the monitors, so there is nothing to look up.
    expect(isIncidentResolved).not.toHaveBeenCalled();
    // And nothing for the feed: "From Offline to Offline" is not a change.
    expect(createFeedItem).not.toHaveBeenCalled();
  });

  test("changing the monitor status puts every monitor in the new one", async () => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: DEGRADED },
    });

    expect(statusChanges()).toEqual([[[MONITOR_A, MONITOR_B], DEGRADED]]);
    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain(
      "**🔄 Monitor Status Changed**:\n- **From** Offline to Degraded",
    );
  });

  test("changing the status and adding a monitor puts all of them in the new status at once", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: DEGRADED },
    });

    expect(statusChanges()).toEqual([[[MONITOR_A, MONITOR_B], DEGRADED]]);
    expect(disableActiveMonitoring).toHaveBeenCalledTimes(1);
  });

  test("giving an incident a status it did not have puts every monitor in it", async () => {
    storedIncidents = [
      storedIncident({
        monitorIds: [MONITOR_A, MONITOR_B],
        changeMonitorStatusToId: undefined,
      }),
    ];

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(statusChanges()).toEqual([[[MONITOR_A, MONITOR_B], OFFLINE]]);
  });

  test("an added monitor of an incident without a status keeps its own", async () => {
    storedIncidents = [storedIncident({ changeMonitorStatusToId: undefined })];

    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    // Probing still stops for a manual incident's monitors, as on create.
    expect(disableActiveMonitoring).toHaveBeenCalledTimes(1);
  });

  test("clearing the status while adding a monitor puts the added monitor in no status", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: null,
      changeMonitorStatusToId: null,
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).toHaveBeenCalledTimes(1);
  });

  test("the status is put only on monitors the incident holds after the write", async () => {
    /*
     * The monitors are read back once the update is written, so a status
     * is never put on a monitor the write did not leave on the incident.
     */
    await runUpdate(
      {
        monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
        changeMonitorStatusTo: { _id: OFFLINE },
      },
      { monitorsAfterWrite: { [INCIDENT_ID]: [MONITOR_A] } },
    );

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });
});

describe("IncidentService: an update that changes the incident's state and its monitors at once", () => {
  test("resolving the incident and taking a monitor off restores the monitor taken off", async () => {
    /*
     * Resolving restores only the monitors the incident holds after the
     * write (IncidentStateTimelineService), so the one taken off in the same
     * update is restored here or never: it would sit in the incident's
     * status, and a manual incident would keep it from being probed.
     */
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    const order: Array<string> = [];
    stubStateChange(true, order);

    await runUpdate({
      currentIncidentStateId: new ObjectID(RESOLVED_STATE),
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(monitorsRestored()).toEqual([[MONITOR_B]]);
    expect(String(markMonitorsActive.mock.calls[0]![0])).toBe(
      projectId.toString(),
    );
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    // The state is read before the write, while it is still open.
    expect(order).toEqual(["isIncidentResolved:false", "changeIncidentState"]);
    expect(feedMarkdownFor()).toContain(
      `**🗑️ Monitors Removed**:\n- [payments-api](${monitorLink(MONITOR_B)})\n`,
    );
  });

  test("resolving the incident and taking every monitor off restores all of them", async () => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    stubStateChange(true, []);

    await runUpdate({
      currentIncidentStateId: new ObjectID(RESOLVED_STATE),
      monitors: [],
    });

    expect(monitorsRestored()).toEqual([[MONITOR_A, MONITOR_B]]);
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("resolving the incident and replacing a monitor restores the old one and leaves the new one alone", async () => {
    const order: Array<string> = [];
    stubStateChange(true, order);

    await runUpdate({
      currentIncidentStateId: new ObjectID(RESOLVED_STATE),
      monitors: [{ _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(monitorsRestored()).toEqual([[MONITOR_A]]);
    // Resolving restored the added monitor with the others it holds.
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    expect(order).toEqual([
      "isIncidentResolved:false",
      "changeIncidentState",
      "isIncidentResolved:true",
    ]);
  });

  test("resolving the incident and changing its status restores the monitor taken off and puts none in the new status", async () => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    stubStateChange(true, []);

    await runUpdate({
      currentIncidentStateId: new ObjectID(RESOLVED_STATE),
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: DEGRADED },
    });

    expect(monitorsRestored()).toEqual([[MONITOR_B]]);
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain("**From** Offline to Degraded");
  });

  test("acknowledging the incident and taking a monitor off restores it as on any open incident", async () => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];

    stubStateChange(false, []);

    await runUpdate({
      currentIncidentStateId: new ObjectID(ACKNOWLEDGED_STATE),
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(monitorsRestored()).toEqual([[MONITOR_B]]);
    expect(statusChanges()).toEqual([[[MONITOR_C], OFFLINE]]);
    expect(disableActiveMonitoring).toHaveBeenCalledTimes(1);
  });

  test("reopening a resolved incident and taking a monitor off does not restore it again", async () => {
    /*
     * It was restored when the incident resolved. Restoring it again could
     * overwrite a status set on it since.
     */
    storedIncidents = [
      storedIncident({ monitorIds: [MONITOR_A, MONITOR_B], isResolved: true }),
    ];

    const order: Array<string> = [];
    stubStateChange(false, order);

    await runUpdate({
      currentIncidentStateId: new ObjectID(ACKNOWLEDGED_STATE),
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(order).toEqual(["isIncidentResolved:true", "changeIncidentState"]);
    expect(feedMarkdownFor()).toContain("**🗑️ Monitors Removed**:");
  });

  test("reopening a resolved incident and adding a monitor puts the added monitor in the incident's status", async () => {
    storedIncidents = [storedIncident({ isResolved: true })];

    stubStateChange(false, []);

    await runUpdate({
      currentIncidentStateId: new ObjectID(ACKNOWLEDGED_STATE),
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    expect(statusChanges()).toEqual([[[MONITOR_B], OFFLINE]]);
    expect(disableActiveMonitoring).toHaveBeenCalledTimes(1);
    expect(markMonitorsActive).not.toHaveBeenCalled();
  });

  test("moving a resolved incident to a later resolved state and taking a monitor off does not restore it", async () => {
    /*
     * The update changes the state, but the incident was resolved before it
     * as well, so its monitors were restored already.
     */
    storedIncidents = [
      storedIncident({ monitorIds: [MONITOR_A, MONITOR_B], isResolved: true }),
    ];

    stubStateChange(true, []);

    await runUpdate({
      currentIncidentStateId: new ObjectID(CLOSED_STATE),
      monitors: [{ _id: MONITOR_A }],
    });

    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("each incident of the update restores the monitors taken off it by its own state before the update", async () => {
    storedIncidents = [
      storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] }),
      storedIncident({
        id: SECOND_INCIDENT_ID,
        incidentNumber: 43,
        monitorIds: [MONITOR_B, MONITOR_C],
        isResolved: true,
      }),
    ];

    stubStateChange(true, []);

    await runUpdate(
      {
        currentIncidentStateId: new ObjectID(RESOLVED_STATE),
        monitors: [MONITOR_B],
      },
      { query: { projectId: projectId } },
    );

    // Only the incident that was open restores the monitor taken off it.
    expect(monitorsRestored()).toEqual([[MONITOR_A]]);
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedMarkdownFor(INCIDENT_ID)).toContain(
      `**🗑️ Monitors Removed**:\n- [checkout-web](${monitorLink(MONITOR_A)})\n`,
    );
    expect(feedMarkdownFor(SECOND_INCIDENT_ID)).toContain(
      `**🗑️ Monitors Removed**:\n- [search-api](${monitorLink(MONITOR_C)})\n`,
    );
  });
});

describe("IncidentService: an update that sends the monitor status without the monitor list", () => {
  beforeEach(() => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];
  });

  test("does not throw, and takes no monitor off the incident", async () => {
    const onUpdate: OnUpdate<Incident> = await runBeforeUpdate(
      makeUpdateBy({ changeMonitorStatusToId: new ObjectID(DEGRADED) }),
    );

    const carryForward: MonitorCarryForward = monitorCarryForwardOf(onUpdate);

    expect(carryForward.monitorsRemoved).toEqual([]);
    expect(carryForward.monitorsAdded).toEqual([]);
    expect(String(carryForward.oldChangeMonitorStatusIdTo)).toBe(OFFLINE);
    expect(String(carryForward.newMonitorChangeStatusIdTo)).toBe(DEGRADED);
  });

  test("puts every monitor in the new status and restores none", async () => {
    await runUpdate({ changeMonitorStatusToId: new ObjectID(DEGRADED) });

    expect(statusChanges()).toEqual([[[MONITOR_A, MONITOR_B], DEGRADED]]);
    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(disableActiveMonitoring).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain("**From** Offline to Degraded");
    expect(feedMarkdownFor()).not.toContain("Monitors Removed");
  });

  test.each([
    ["a bare id string", { changeMonitorStatusToId: DEGRADED }],
    ["the relation object", { changeMonitorStatusTo: { _id: DEGRADED } }],
    ["a bare id in the relation", { changeMonitorStatusTo: DEGRADED }],
  ] as Array<[string, Dictionary<unknown>]>)(
    "reads the status given as %s",
    async (_label: string, data: Dictionary<unknown>) => {
      await runUpdate(data);

      expect(statusChanges()).toEqual([[[MONITOR_A, MONITOR_B], DEGRADED]]);
    },
  );

  test("the same status again changes nothing and writes no feed item", async () => {
    await runUpdate({ changeMonitorStatusToId: new ObjectID(OFFLINE) });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(markMonitorsActive).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
  });

  test("on a resolved incident, puts no monitor in the new status", async () => {
    storedIncidents = [
      storedIncident({ monitorIds: [MONITOR_A, MONITOR_B], isResolved: true }),
    ];

    await runUpdate({ changeMonitorStatusToId: new ObjectID(DEGRADED) });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedMarkdownFor()).toContain("**From** Offline to Degraded");
  });
});

describe("IncidentService: the feed's monitor status line", () => {
  test("is not written when the status saved is the one the incident had", async () => {
    await runUpdate({
      title: "Checkout is slow",
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: OFFLINE },
    });

    const markdown: string | undefined = feedMarkdownFor();

    // The feed item is written for the title.
    expect(markdown).toContain("Checkout is slow");
    expect(markdown).not.toContain("Monitor Status Changed");
  });

  test("compares the ids regardless of case", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusToId: OFFLINE.toUpperCase(),
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
  });

  test("is written once when the status changes", async () => {
    await runUpdate({
      monitors: [{ _id: MONITOR_A }],
      changeMonitorStatusTo: { _id: DEGRADED },
    });

    const markdown: string = feedMarkdownFor()!;

    expect(markdown.match(/Monitor Status Changed/g)).toHaveLength(1);
    expect(
      (createFeedItem.mock.calls[0]![0] as { incidentFeedEventType: string })
        .incidentFeedEventType,
    ).toBe(IncidentFeedEventType.IncidentUpdated);
  });
});

describe("IncidentService.onBeforeUpdate: which monitors an update adds and removes", () => {
  beforeEach(() => {
    storedIncidents = [storedIncident({ monitorIds: [MONITOR_A, MONITOR_B] })];
  });

  function addedIds(carryForward: MonitorCarryForward): Array<string> {
    return carryForward.monitorsAdded.map((monitor: Monitor): string => {
      return monitor._id!.toString().toLowerCase();
    });
  }

  function removedIds(carryForward: MonitorCarryForward): Array<string> {
    return carryForward.monitorsRemoved.map((monitor: Monitor): string => {
      return monitor._id!.toString().toLowerCase();
    });
  }

  test.each([
    ["relation objects", [{ _id: MONITOR_A }, { _id: MONITOR_B }]],
    ["bare id strings (API update)", [MONITOR_A, MONITOR_B]],
    ["ObjectIDs", [new ObjectID(MONITOR_A), new ObjectID(MONITOR_B)]],
    ["models", [monitorStub(MONITOR_A), monitorStub(MONITOR_B)]],
    ["upper-case ids", [MONITOR_A.toUpperCase(), MONITOR_B.toUpperCase()]],
  ] as Array<[string, Array<unknown>]>)(
    "re-sending the same monitors as %s changes nothing",
    async (_label: string, monitors: Array<unknown>) => {
      const carryForward: MonitorCarryForward = monitorCarryForwardOf(
        await runBeforeUpdate(makeUpdateBy({ monitors: monitors })),
      );

      expect(removedIds(carryForward)).toEqual([]);
      expect(addedIds(carryForward)).toEqual([]);
    },
  );

  test("records the monitors added and removed", async () => {
    const carryForward: MonitorCarryForward = monitorCarryForwardOf(
      await runBeforeUpdate(
        makeUpdateBy({ monitors: [MONITOR_B, { _id: MONITOR_C }] }),
      ),
    );

    expect(removedIds(carryForward)).toEqual([MONITOR_A]);
    expect(addedIds(carryForward)).toEqual([MONITOR_C]);
  });

  test("a monitor sent twice is added once", async () => {
    const carryForward: MonitorCarryForward = monitorCarryForwardOf(
      await runBeforeUpdate(
        makeUpdateBy({
          monitors: [MONITOR_A, MONITOR_B, MONITOR_C, { _id: MONITOR_C }],
        }),
      ),
    );

    expect(addedIds(carryForward)).toEqual([MONITOR_C]);
  });

  test.each([
    ["an empty list", []],
    ["null", null],
  ] as Array<[string, Array<unknown> | null]>)(
    "%s takes every monitor off",
    async (_label: string, monitors: Array<unknown> | null) => {
      const carryForward: MonitorCarryForward = monitorCarryForwardOf(
        await runBeforeUpdate(makeUpdateBy({ monitors: monitors })),
      );

      expect(removedIds(carryForward)).toEqual([MONITOR_A, MONITOR_B]);
      expect(addedIds(carryForward)).toEqual([]);
    },
  );

  test("records clearing the status", async () => {
    const carryForward: MonitorCarryForward = monitorCarryForwardOf(
      await runBeforeUpdate(
        makeUpdateBy({
          monitors: [MONITOR_A, MONITOR_B],
          changeMonitorStatusTo: null,
        }),
      ),
    );

    expect(carryForward.isChangeMonitorStatusToCleared).toBe(true);
    expect(carryForward.newMonitorChangeStatusIdTo).toBeUndefined();
  });

  test("a status sent is not a clear, even next to a null relation", async () => {
    const carryForward: MonitorCarryForward = monitorCarryForwardOf(
      await runBeforeUpdate(
        makeUpdateBy({
          changeMonitorStatusTo: null,
          changeMonitorStatusToId: DEGRADED,
        }),
      ),
    );

    expect(carryForward.isChangeMonitorStatusToCleared).toBe(false);
    expect(String(carryForward.newMonitorChangeStatusIdTo)).toBe(DEGRADED);
  });

  test.each([
    ["open", false],
    ["resolved", true],
  ] as Array<[string, boolean]>)(
    "records that the incident was %s before an update that takes a monitor off",
    async (_label: string, isResolved: boolean) => {
      storedIncidents = [
        storedIncident({
          monitorIds: [MONITOR_A, MONITOR_B],
          isResolved: isResolved,
        }),
      ];

      const carryForward: MonitorCarryForward = monitorCarryForwardOf(
        await runBeforeUpdate(makeUpdateBy({ monitors: [MONITOR_A] })),
      );

      expect(carryForward.isResolvedBeforeUpdate).toBe(isResolved);
      expect(isIncidentResolved).toHaveBeenCalledTimes(1);
      expect(
        String(
          (isIncidentResolved.mock.calls[0]![0] as { incidentId: ObjectID })
            .incidentId,
        ),
      ).toBe(INCIDENT_ID);
    },
  );

  test.each([
    ["adds a monitor", { monitors: [MONITOR_A, MONITOR_B, MONITOR_C] }],
    ["re-sends the same monitors", { monitors: [MONITOR_A, MONITOR_B] }],
    ["sends only the status", { changeMonitorStatusToId: DEGRADED }],
  ] as Array<[string, Dictionary<unknown>]>)(
    "does not read the state before an update that %s",
    async (_label: string, data: Dictionary<unknown>) => {
      const carryForward: MonitorCarryForward = monitorCarryForwardOf(
        await runBeforeUpdate(makeUpdateBy(data)),
      );

      expect(carryForward.isResolvedBeforeUpdate).toBeUndefined();
      expect(isIncidentResolved).not.toHaveBeenCalled();
    },
  );

  test("an update that touches neither reads no incident", async () => {
    const onUpdate: OnUpdate<Incident> = await runBeforeUpdate(
      makeUpdateBy({ title: "Renamed" }),
    );

    expect(onUpdate.carryForward).toEqual({});
    expect(IncidentService.findBy).not.toHaveBeenCalled();
  });
});

describe("IncidentService: an update that matches several incidents", () => {
  test("each incident puts the monitors added to it in its own status", async () => {
    storedIncidents = [
      storedIncident({ monitorIds: [MONITOR_A] }),
      storedIncident({
        id: SECOND_INCIDENT_ID,
        incidentNumber: 43,
        monitorIds: [MONITOR_B],
        changeMonitorStatusToId: DEGRADED,
      }),
    ];

    await runUpdate(
      { monitors: [MONITOR_A, MONITOR_B] },
      { query: { projectId: projectId } },
    );

    expect(statusChanges()).toEqual([
      [[MONITOR_B], OFFLINE],
      [[MONITOR_A], DEGRADED],
    ]);
    expect(changeMonitorStatus.mock.calls[1]![4]).toBe(
      "Status was changed because Incident INC-43 was updated.",
    );
    expect(disableActiveMonitoring).toHaveBeenCalledTimes(2);
  });

  test("a resolved one is left alone while an open one is updated", async () => {
    storedIncidents = [
      storedIncident({ monitorIds: [MONITOR_A] }),
      storedIncident({
        id: SECOND_INCIDENT_ID,
        incidentNumber: 43,
        monitorIds: [MONITOR_C],
        changeMonitorStatusToId: DEGRADED,
        isResolved: true,
      }),
    ];

    await runUpdate(
      { monitors: [MONITOR_A, MONITOR_B] },
      { query: { projectId: projectId } },
    );

    expect(statusChanges()).toEqual([[[MONITOR_B], OFFLINE]]);
    expect(
      disableActiveMonitoring.mock.calls.map((args: Array<unknown>): string => {
        return String(args[0]);
      }),
    ).toEqual([INCIDENT_ID]);
    // The resolved incident's removed monitor is not restored again.
    expect(markMonitorsActive).not.toHaveBeenCalled();

    // Both feeds still record the edit.
    expect(feedMarkdownFor(INCIDENT_ID)).toContain("**🌎 Monitors Added**:");
    expect(feedMarkdownFor(SECOND_INCIDENT_ID)).toContain(
      `**🗑️ Monitors Removed**:\n- [search-api](${monitorLink(MONITOR_C)})\n`,
    );
  });
});
