import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../Server/Services/UserService";
import ProjectService from "../../../Server/Services/ProjectService";
import AIIncidentPostmortemRunner from "../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "../../../Server/Utils/AI/SRE/InvestigationGrader";
import MicrosoftTeamsAlertActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsIncidentActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsIncidentActionType,
} from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import {
  ACKNOWLEDGED_FEED_EMOJI,
  CREATED_FEED_EMOJI,
  RESOLVED_FEED_EMOJI,
} from "../../../Server/Utils/StateChangeFeedEmoji";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ACKNOWLEDGED BY ORDER (#4453): a record is acknowledged in its project's
 * acknowledged state (the first from the top flagged acknowledged), in any
 * state placed after it - "Investigating", without a flag - and once it is
 * resolved (Common/Utils/AcknowledgedState). On-call already read it so.
 *
 * What read the flag alone, or nothing at all, and so treated a record in
 * "Investigating" as not acknowledged:
 *
 *   - acknowledging an alert or an episode - from a page, Slack, Microsoft
 *     Teams - moved it back up its list into Acknowledged, and logged a
 *     second acknowledgement;
 *   - a responder acknowledging their page for an incident a colleague had
 *     already moved on got an error back instead of the page acknowledged;
 *   - Microsoft Teams offered the move back;
 *   - the move into it marked nothing: the SLA was not responded, the feed
 *     line read like any other change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-200000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5a7e-4fab-8bcd-2000000000b1");
const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-2000000000d1",
);
const ALERT_ID: ObjectID = new ObjectID("0193c0de-5a7e-4fab-8bcd-2000000000d2");
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-2000000000e1",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-2000000000e2",
);

const IDENTIFIED: string = "0193c0de-5a7e-4fab-8bcd-2000000000a1";
const ACKNOWLEDGED: string = "0193c0de-5a7e-4fab-8bcd-2000000000a2";
// The project's own state between Acknowledged and Resolved, without a flag.
const INVESTIGATING: string = "0193c0de-5a7e-4fab-8bcd-2000000000a3";
const RESOLVED: string = "0193c0de-5a7e-4fab-8bcd-2000000000a4";
// The project's own state placed after Resolved, without a flag.
const CLOSED: string = "0193c0de-5a7e-4fab-8bcd-2000000000a5";
// A state that is none of the project's.
const FOREIGN: string = "0193c0de-5a7e-4fab-8bcd-2000000000af";

const DECLARED_AT: Date = new Date("2026-10-06T08:00:00.000Z");

interface StateRow {
  id: string;
  name: string;
  order: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

// Listed out of order on purpose: nothing may lean on the order rows come in.
const STATES: Array<StateRow> = [
  { id: CLOSED, name: "Closed", order: 5 },
  { id: INVESTIGATING, name: "Investigating", order: 3 },
  { id: RESOLVED, name: "Resolved", order: 4, isResolvedState: true },
  { id: IDENTIFIED, name: "Identified", order: 1, isCreatedState: true },
  {
    id: ACKNOWLEDGED,
    name: "Acknowledged",
    order: 2,
    isAcknowledgedState: true,
  },
];

function stateRowOf(id: string): StateRow {
  return STATES.find((state: StateRow): boolean => {
    return state.id === id;
  })!;
}

function toModel<T extends IncidentState | AlertState>(
  modelType: { new (): T },
  row: StateRow,
): T {
  const state: T = new modelType();
  state._id = row.id;
  state.name = row.name;
  state.order = row.order;
  state.isCreatedState = Boolean(row.isCreatedState);
  state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
  state.isResolvedState = Boolean(row.isResolvedState);
  return state;
}

function idOf(query: unknown): string {
  const value: unknown =
    (query as Record<string, unknown> | undefined)?.["_id"] ?? query;
  return value ? value.toString().toLowerCase() : "";
}

/*
 * The project's states, served to whichever read a service makes: the whole
 * list (findBy), or one by id or by a flag (findOneBy, findOneById).
 */
function serveStates<T extends IncidentState | AlertState>(
  service: unknown,
  modelType: { new (): T },
): void {
  const target: Record<string, unknown> = service as Record<string, unknown>;

  jest
    .spyOn(target as never, "findBy" as never)
    .mockImplementation((async (): Promise<Array<T>> => {
      return STATES.map((row: StateRow): T => {
        return toModel(modelType, row);
      });
    }) as never);

  const findOne: (query: Record<string, unknown>) => T | null = (
    query: Record<string, unknown>,
  ): T | null => {
    if (query["_id"]) {
      const row: StateRow | undefined = STATES.find(
        (candidate: StateRow): boolean => {
          return candidate.id === idOf(query);
        },
      );
      return row ? toModel(modelType, row) : null;
    }

    for (const flag of [
      "isAcknowledgedState",
      "isResolvedState",
      "isCreatedState",
    ] as const) {
      if (query[flag] === true) {
        const row: StateRow | undefined = STATES.find(
          (candidate: StateRow): boolean => {
            return Boolean(candidate[flag]);
          },
        );
        return row ? toModel(modelType, row) : null;
      }
    }

    return null;
  };

  jest
    .spyOn(target as never, "findOneBy" as never)
    .mockImplementation((async (findOneBy: {
      query: Record<string, unknown>;
    }): Promise<T | null> => {
      return findOne(findOneBy.query);
    }) as never);

  jest
    .spyOn(target as never, "findOneById" as never)
    .mockImplementation((async (findOneById: {
      id: ObjectID | string;
    }): Promise<T | null> => {
      return findOne({ _id: findOneById.id.toString() });
    }) as never);
}

// Lets the fire-and-forget steps of a success hook (the SLA) settle.
async function flush(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  }
}

// What a refused promise was refused with.
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to be refused.");
}

/*
 * One record of each kind, in `stateId`, read whichever way its service
 * reads it: its own findOneBy and findOneById.
 */
function serveIncidentIn(stateId: string): void {
  const build: () => Incident = (): Incident => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 17;
    incident.currentIncidentStateId = new ObjectID(stateId);
    incident.declaredAt = DECLARED_AT;
    return incident;
  };

  jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
    return build();
  }) as never);
  jest.spyOn(IncidentService, "findOneById").mockImplementation((async () => {
    return build();
  }) as never);
}

function serveAlertIn(stateId: string): void {
  const build: () => Alert = (): Alert => {
    const alert: Alert = new Alert();
    alert._id = ALERT_ID.toString();
    alert.projectId = PROJECT_ID;
    alert.currentAlertStateId = new ObjectID(stateId);
    return alert;
  };

  jest.spyOn(AlertService, "findOneBy").mockImplementation((async () => {
    return build();
  }) as never);
  jest.spyOn(AlertService, "findOneById").mockImplementation((async () => {
    return build();
  }) as never);
}

function serveAlertEpisodeIn(stateId: string): void {
  jest
    .spyOn(AlertEpisodeService, "findOneById")
    .mockImplementation((async () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode._id = ALERT_EPISODE_ID.toString();
      episode.projectId = PROJECT_ID;
      episode.currentAlertStateId = new ObjectID(stateId);
      return episode;
    }) as never);
}

function serveIncidentEpisodeIn(stateId: string): void {
  jest
    .spyOn(IncidentEpisodeService, "findOneById")
    .mockImplementation((async () => {
      const episode: IncidentEpisode = new IncidentEpisode();
      episode._id = INCIDENT_EPISODE_ID.toString();
      episode.projectId = PROJECT_ID;
      episode.currentIncidentStateId = new ObjectID(stateId);
      return episode;
    }) as never);
}

/*
 * Every way a record of each kind is acknowledged, watched: the state row an
 * incident or an alert is moved with, the state change an episode is moved
 * with. Returns the state ids each was moved into.
 */
interface StateMoves {
  incident: Array<string>;
  alert: Array<string>;
  alertEpisode: Array<string>;
  incidentEpisode: Array<string>;
}

function watchStateMoves(): StateMoves {
  const moves: StateMoves = {
    incident: [],
    alert: [],
    alertEpisode: [],
    incidentEpisode: [],
  };

  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentStateTimeline;
    }): Promise<IncidentStateTimeline> => {
      moves.incident.push(createBy.data.incidentStateId!.toString());
      return createBy.data;
    }) as never);
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: AlertStateTimeline;
    }): Promise<AlertStateTimeline> => {
      moves.alert.push(createBy.data.alertStateId!.toString());
      return createBy.data;
    }) as never);
  jest
    .spyOn(AlertEpisodeService, "changeEpisodeState")
    .mockImplementation((async (data: {
      alertStateId: ObjectID;
    }): Promise<void> => {
      moves.alertEpisode.push(data.alertStateId.toString());
    }) as never);
  jest
    .spyOn(IncidentEpisodeService, "changeEpisodeState")
    .mockImplementation((async (data: {
      incidentStateId: ObjectID;
    }): Promise<void> => {
      moves.incidentEpisode.push(data.incidentStateId.toString());
    }) as never);
  jest
    .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
    .mockResolvedValue(undefined as never);

  return moves;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the state services answer by the one rule", () => {
  beforeEach(() => {
    serveStates(IncidentStateService, IncidentState);
    serveStates(AlertStateService, AlertState);
  });

  test.each([
    ["the created state", false, IDENTIFIED],
    ["the acknowledged state", true, ACKNOWLEDGED],
    ["a state between Acknowledged and Resolved", true, INVESTIGATING],
    ["the resolved state", true, RESOLVED],
    ["a state after Resolved", true, CLOSED],
    ["a state that is none of the project's", false, FOREIGN],
  ])(
    "a record in %s is acknowledged: %s",
    async (_label: string, expected: boolean, stateId: string) => {
      expect(
        await IncidentStateService.isAcknowledgedIncidentState({
          projectId: PROJECT_ID,
          incidentStateId: new ObjectID(stateId),
        }),
      ).toBe(expected);
      expect(
        await AlertStateService.isAcknowledgedAlertState({
          projectId: PROJECT_ID,
          alertStateId: new ObjectID(stateId),
        }),
      ).toBe(expected);
    },
  );

  test("the acknowledged state is the first from the top flagged acknowledged", async () => {
    expect(
      (await IncidentStateService.findAcknowledgedIncidentState(PROJECT_ID))
        ?._id,
    ).toBe(ACKNOWLEDGED);
    expect(
      (await AlertStateService.findAcknowledgedAlertState(PROJECT_ID))?._id,
    ).toBe(ACKNOWLEDGED);
  });

  test("an Acknowledged filter is the acknowledged state and the states after it, short of resolved", async () => {
    const ids: (list: Array<ObjectID>) => Array<string> = (
      list: Array<ObjectID>,
    ): Array<string> => {
      return list
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort();
    };

    expect(
      ids(
        await IncidentStateService.getAcknowledgedUnresolvedIncidentStateIds(
          PROJECT_ID,
        ),
      ),
    ).toEqual([ACKNOWLEDGED, INVESTIGATING].sort());
    expect(
      ids(
        await AlertStateService.getAcknowledgedUnresolvedAlertStateIds(
          PROJECT_ID,
        ),
      ),
    ).toEqual([ACKNOWLEDGED, INVESTIGATING].sort());
  });
});

describe("acknowledging a record that is acknowledged already is refused, and moves nothing back up its list", () => {
  let moves: StateMoves;

  beforeEach(() => {
    serveStates(IncidentStateService, IncidentState);
    serveStates(AlertStateService, AlertState);
    moves = watchStateMoves();
  });

  /*
   * Each kind: how it is acknowledged, and how its record is served in a
   * state.
   */
  const KINDS: Array<{
    kind: string;
    subject: string;
    serveIn: (stateId: string) => void;
    acknowledge: () => Promise<unknown>;
    moved: () => Array<string>;
  }> = [
    {
      kind: "incident",
      subject: "Incident",
      serveIn: serveIncidentIn,
      acknowledge: () => {
        return IncidentService.acknowledgeIncident(INCIDENT_ID, USER_ID);
      },
      moved: () => {
        return moves.incident;
      },
    },
    {
      kind: "alert",
      subject: "Alert",
      serveIn: serveAlertIn,
      acknowledge: () => {
        return AlertService.acknowledgeAlert(ALERT_ID, USER_ID);
      },
      moved: () => {
        return moves.alert;
      },
    },
    {
      kind: "alert episode",
      subject: "Episode",
      serveIn: serveAlertEpisodeIn,
      acknowledge: () => {
        return AlertEpisodeService.acknowledgeEpisode(
          ALERT_EPISODE_ID,
          USER_ID,
        );
      },
      moved: () => {
        return moves.alertEpisode;
      },
    },
    {
      kind: "incident episode",
      subject: "Episode",
      serveIn: serveIncidentEpisodeIn,
      acknowledge: () => {
        return IncidentEpisodeService.acknowledgeEpisode(
          INCIDENT_EPISODE_ID,
          USER_ID,
        );
      },
      moved: () => {
        return moves.incidentEpisode;
      },
    },
  ];

  describe.each(KINDS)("an $kind", (kind: (typeof KINDS)[number]) => {
    test("in a state between Acknowledged and Resolved is already acknowledged", async () => {
      kind.serveIn(INVESTIGATING);

      const error: unknown = await rejection(kind.acknowledge());

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        `${kind.subject} is already acknowledged.`,
      );
      expect(kind.moved()).toEqual([]);
    });

    test("in the acknowledged state is already acknowledged", async () => {
      kind.serveIn(ACKNOWLEDGED);

      await expect(kind.acknowledge()).rejects.toThrow(
        `${kind.subject} is already acknowledged.`,
      );
      expect(kind.moved()).toEqual([]);
    });

    test.each([
      ["resolved", RESOLVED],
      ["in a state after Resolved", CLOSED],
    ])("%s is already resolved", async (_label: string, stateId: string) => {
      kind.serveIn(stateId);

      await expect(kind.acknowledge()).rejects.toThrow(
        `${kind.subject} is already resolved.`,
      );
      expect(kind.moved()).toEqual([]);
    });

    test("still open is moved into the acknowledged state", async () => {
      kind.serveIn(IDENTIFIED);

      await kind.acknowledge();

      expect(kind.moved()).toEqual([ACKNOWLEDGED]);
    });
  });
});

describe("a responder acknowledging their page: on-call stops as for Acknowledged, and the record is left where it is", () => {
  let moves: StateMoves;
  let pagesCompleted: Array<JSONObject>;

  beforeEach(() => {
    serveStates(IncidentStateService, IncidentState);
    serveStates(AlertStateService, AlertState);
    moves = watchStateMoves();
    pagesCompleted = [];

    jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
      const user: User = new User();
      user._id = USER_ID.toString();
      return user;
    }) as never);
    jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((async (updateBy: {
        data: JSONObject;
      }): Promise<void> => {
        pagesCompleted.push(updateBy.data);
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  // The user's page for the record, acknowledged by them.
  async function acknowledgePage(triggeredBy: JSONObject): Promise<void> {
    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockImplementation((async () => {
        const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
        row._id = ObjectID.generate().toString();
        row.projectId = PROJECT_ID;
        row.userId = USER_ID;
        row.userNotificationLogId = ObjectID.generate();
        row.onCallDutyPolicyExecutionLogId = ObjectID.generate();
        row.onCallDutyPolicyExecutionLogTimelineId = ObjectID.generate();
        Object.assign(row, triggeredBy);
        return [row];
      }) as never);

    const hooks: Record<string, (...args: Array<unknown>) => Promise<unknown>> =
      UserOnCallLogTimelineService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >;

    await hooks["onUpdateSuccess"]!.call(
      UserOnCallLogTimelineService,
      {
        updateBy: {
          query: { _id: ObjectID.generate() },
          data: {
            acknowledgedAt: OneUptimeDate.getCurrentDate(),
            isAcknowledged: true,
          },
          props: { isRoot: true },
        },
      },
      [],
    );
  }

  const KINDS: Array<{
    kind: string;
    serveIn: (stateId: string) => void;
    triggeredBy: JSONObject;
    moved: () => Array<string>;
  }> = [
    {
      kind: "incident",
      serveIn: serveIncidentIn,
      triggeredBy: { triggeredByIncidentId: INCIDENT_ID },
      moved: () => {
        return moves.incident;
      },
    },
    {
      kind: "alert",
      serveIn: serveAlertIn,
      triggeredBy: { triggeredByAlertId: ALERT_ID },
      moved: () => {
        return moves.alert;
      },
    },
    {
      kind: "alert episode",
      serveIn: serveAlertEpisodeIn,
      triggeredBy: { triggeredByAlertEpisodeId: ALERT_EPISODE_ID },
      moved: () => {
        return moves.alertEpisode;
      },
    },
    {
      kind: "incident episode",
      serveIn: serveIncidentEpisodeIn,
      triggeredBy: { triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID },
      moved: () => {
        return moves.incidentEpisode;
      },
    },
  ];

  describe.each(KINDS)("for an $kind", (kind: (typeof KINDS)[number]) => {
    test("already moved on into a state between Acknowledged and Resolved: the page is acknowledged, the record stays put, nothing fails", async () => {
      kind.serveIn(INVESTIGATING);

      await acknowledgePage(kind.triggeredBy);

      expect(pagesCompleted).toHaveLength(1);
      expect(pagesCompleted[0]!["status"]).toBe(
        UserNotificationExecutionStatus.Completed,
      );
      expect(kind.moved()).toEqual([]);
    });

    test("already acknowledged by a colleague: the page is acknowledged, nothing is acknowledged twice", async () => {
      kind.serveIn(ACKNOWLEDGED);

      await acknowledgePage(kind.triggeredBy);

      expect(pagesCompleted).toHaveLength(1);
      expect(kind.moved()).toEqual([]);
    });

    test("still open: the page acknowledges the record", async () => {
      kind.serveIn(IDENTIFIED);

      await acknowledgePage(kind.triggeredBy);

      expect(pagesCompleted).toHaveLength(1);
      expect(kind.moved()).toEqual([ACKNOWLEDGED]);
    });
  });
});

describe("Microsoft Teams leaves a record that is acknowledged already as it is", () => {
  let moves: StateMoves;

  /*
   * A member who may acknowledge, as handleBotInvokeActivity hands every
   * card action its props: the acknowledgement is theirs, made the way the
   * dashboard makes it (WorkspaceMemberActions).
   */
  function responderProps(): DatabaseCommonInteractionProps {
    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [Permission.IncidentMember, Permission.AlertMember].map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
              };
            },
          ),
        },
      },
    };
  }

  // A card's Acknowledge, delivered as handleBotInvokeActivity delivers it.
  async function acknowledgeFromTeams(data: {
    kind: "incident" | "alert";
  }): Promise<unknown> {
    const turnContext: never = {
      sendActivity: async (): Promise<void> => {},
    } as never;

    try {
      if (data.kind === "incident") {
        await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
          actionType: MicrosoftTeamsIncidentActionType.AckIncident,
          actionValue: INCIDENT_ID.toString(),
          value: {},
          projectId: PROJECT_ID,
          oneUptimeUserId: USER_ID,
          databaseProps: responderProps(),
          turnContext: turnContext,
        });
      } else {
        await MicrosoftTeamsAlertActions.handleBotAlertAction({
          actionType: MicrosoftTeamsAlertActionType.AckAlert,
          actionValue: ALERT_ID.toString(),
          value: {},
          projectId: PROJECT_ID,
          oneUptimeUserId: USER_ID,
          databaseProps: responderProps(),
          turnContext: turnContext,
        });
      }
    } catch (error) {
      return error;
    }

    return null;
  }

  beforeEach(() => {
    serveStates(IncidentStateService, IncidentState);
    serveStates(AlertStateService, AlertState);
    moves = watchStateMoves();

    // The project's plan, as the card's checks read it where a plan decides.
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    } as never);
  });

  test.each([
    ["a state between Acknowledged and Resolved", INVESTIGATING],
    ["the acknowledged state", ACKNOWLEDGED],
    ["a state after Resolved", CLOSED],
  ])(
    "an incident in %s is not acknowledged again",
    async (_label: string, stateId: string) => {
      serveIncidentIn(stateId);

      const refusal: unknown = await acknowledgeFromTeams({ kind: "incident" });

      // handleBotInvokeActivity tells the member why, in these words.
      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toMatch(
        /^Incident is already (acknowledged|resolved)\.$/,
      );
      expect(moves.incident).toEqual([]);
    },
  );

  test("an incident still open is acknowledged", async () => {
    serveIncidentIn(IDENTIFIED);

    expect(await acknowledgeFromTeams({ kind: "incident" })).toBeNull();

    expect(moves.incident).toEqual([ACKNOWLEDGED]);
  });

  test("an alert in a state between Acknowledged and Resolved is not moved back to Acknowledged", async () => {
    serveAlertIn(INVESTIGATING);

    const refusal: unknown = await acknowledgeFromTeams({ kind: "alert" });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe("Alert is already acknowledged.");
    expect(moves.alert).toEqual([]);
  });

  test("an alert still open is acknowledged", async () => {
    serveAlertIn(IDENTIFIED);

    expect(await acknowledgeFromTeams({ kind: "alert" })).toBeNull();

    expect(moves.alert).toEqual([ACKNOWLEDGED]);
  });
});

describe("moving an incident into a state placed after Acknowledged is an acknowledgement", () => {
  let responded: Array<Date> = [];
  let feedLines: Array<string> = [];

  beforeEach(() => {
    responded = [];
    feedLines = [];

    serveStates(IncidentStateService, IncidentState);
    serveIncidentIn(IDENTIFIED);

    jest.spyOn(IncidentService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 17,
      numberWithPrefix: "INC-17",
    } as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/incident") as never,
      );
    jest
      .spyOn(IncidentService, "refreshIncidentMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
      }): Promise<void> => {
        feedLines.push(data.feedInfoInMarkdown);
      }) as never);
    jest
      .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
      .mockResolvedValue(undefined as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    const timelineService: Record<string, () => Promise<unknown>> =
      IncidentStateTimelineService as unknown as Record<
        string,
        () => Promise<unknown>
      >;
    jest
      .spyOn(timelineService, "isLastIncidentState")
      .mockResolvedValue(false as never);
    jest
      .spyOn(timelineService, "autoAssignIncidentCommander")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(IncidentService, "markMonitorsActiveForMonitoring")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AIIncidentPostmortemRunner, "draftPostmortemOnResolve")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(InvestigationGrader, "gradeInvestigationOnResolve")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentSlaService, "markResolved")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentSlaService, "markResponded")
      .mockImplementation((async (data: {
        respondedAt: Date;
      }): Promise<void> => {
        responded.push(data.respondedAt);
      }) as never);
    jest
      .spyOn(IncidentSlaService, "createSlaForIncident")
      .mockResolvedValue(undefined as never);
  });

  function row(stateId: string, startsAt: Date): IncidentStateTimeline {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline._id = ObjectID.generate().toString();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = INCIDENT_ID;
    timeline.incidentStateId = new ObjectID(stateId);
    timeline.incidentState = toModel(IncidentState, stateRowOf(stateId));
    timeline.startsAt = startsAt;
    return timeline;
  }

  // A new row in `to`, half an hour in, with the row before it in `from`.
  async function move(from: string, to: string): Promise<Date> {
    const startsAt: Date = OneUptimeDate.addRemoveMinutes(DECLARED_AT, 30);
    const created: IncidentStateTimeline = row(to, startsAt);

    const hooks: Record<string, (...args: Array<unknown>) => Promise<unknown>> =
      IncidentStateTimelineService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >;

    await hooks["onCreateSuccess"]!.call(
      IncidentStateTimelineService,
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: row(
            from,
            OneUptimeDate.addRemoveMinutes(startsAt, -10),
          ),
          statusTimelineAfterThisStatus: null,
          mutex: null,
        },
      },
      created,
    );

    await flush();

    return startsAt;
  }

  test("straight from the created state: the SLA is responded then, and the feed line marks an acknowledgement", async () => {
    const startsAt: Date = await move(IDENTIFIED, INVESTIGATING);

    expect(responded).toEqual([startsAt]);
    expect(feedLines).toHaveLength(1);
    expect(feedLines[0]!.startsWith(ACKNOWLEDGED_FEED_EMOJI)).toBe(true);
  });

  test("on from Acknowledged: still acknowledged - the SLA keeps its first response", async () => {
    await move(ACKNOWLEDGED, INVESTIGATING);

    expect(feedLines[0]!.startsWith(ACKNOWLEDGED_FEED_EMOJI)).toBe(true);
  });

  test("into the acknowledged state itself, as before", async () => {
    const startsAt: Date = await move(IDENTIFIED, ACKNOWLEDGED);

    expect(responded).toEqual([startsAt]);
    expect(feedLines[0]!.startsWith(ACKNOWLEDGED_FEED_EMOJI)).toBe(true);
  });

  test("into a resolved state the line marks the resolve", async () => {
    await move(INVESTIGATING, RESOLVED);

    expect(feedLines[0]!.startsWith(RESOLVED_FEED_EMOJI)).toBe(true);
  });

  test("a move back into the created state is no acknowledgement: nothing is responded", async () => {
    await move(INVESTIGATING, IDENTIFIED);

    expect(responded).toEqual([]);
    expect(feedLines[0]!.startsWith(CREATED_FEED_EMOJI)).toBe(true);
  });
});
