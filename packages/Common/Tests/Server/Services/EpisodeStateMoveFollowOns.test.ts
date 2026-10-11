import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT FOLLOWS AN EPISODE'S STATE CHANGE, BY THE ONE STATE MOVE RULE
 * (Common/Utils/StateMove):
 *
 *   - the cascade to its members: each incident or alert is moved only where
 *     its own timeline would take it - one in that state already, or past it
 *     (resolved on its own, or in a state of the project's own after
 *     Resolved), is left where it is. The report this pins: a resolved
 *     episode moved back up its list cascaded the move to its members as
 *     OneUptime;
 *   - the grouping rule's reopen goes through the timeline's own reopen
 *     (createReopen), and is the only change that does;
 *   - an update that writes an episode's state is held to the rule before
 *     anything is written, and an incident episode's is then recorded on its
 *     timeline like an alert episode's;
 *   - deleting a row of an episode's timeline - how a state set by mistake
 *     is put right, as for an incident or an alert - leaves the episode
 *     where its latest row puts it, resolvedAt with it.
 */

const PROJECT_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000001");
const EPISODE_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000002");

interface States {
  created: ObjectID;
  acknowledged: ObjectID;
  resolved: ObjectID;
  closed: ObjectID;
  all: Array<IncidentState | AlertState>;
}

function statesOf<T extends IncidentState | AlertState>(
  makeState: () => T,
  prefix: string,
): States {
  const make: (index: number, name: string, resolved: boolean) => T = (
    index: number,
    name: string,
    resolved: boolean,
  ): T => {
    const state: T = makeState();
    state._id = `7f000000-0000-4000-8000-${prefix}${String(index).padStart(2, "0")}`;
    state.projectId = PROJECT_ID;
    state.name = name;
    state.order = index;
    state.isResolvedState = resolved;
    return state;
  };

  const all: Array<T> = [
    make(1, "Created", false),
    make(2, "Acknowledged", false),
    make(3, "Resolved", true),
    // A state of the project's own after Resolved.
    make(4, "Closed", false),
  ];

  return {
    created: new ObjectID(all[0]!._id!),
    acknowledged: new ObjectID(all[1]!._id!),
    resolved: new ObjectID(all[2]!._id!),
    closed: new ObjectID(all[3]!._id!),
    all: all,
  };
}

interface EpisodeKind {
  name: string;
  states: () => States;
  stubProjectStates: (states: States) => void;
  // The members, each in a state: stubs their reads.
  stubMembers: (states: Array<ObjectID | undefined>) => Array<ObjectID>;
  // Records each member move the cascade makes.
  stubMemberMoves: () => Array<{ memberId: string; stateId: string }>;
  cascade: (stateId: ObjectID) => Promise<void>;
  episodeService: unknown;
  timelineService: unknown;
  changeEpisodeState: (data: {
    stateId: ObjectID;
    isGroupingRuleReopen?: boolean;
  }) => Promise<void>;
  stateKey: string;
  stateRelation: string;
  makeEpisode: (stateId: ObjectID) => BaseModel;
  makeTimeline: (stateId: ObjectID, startsAt: Date) => BaseModel;
  stubIsResolved: (states: States) => void;
}

const INCIDENT_EPISODE: EpisodeKind = {
  name: "an incident episode",
  states: (): States => {
    return statesOf((): IncidentState => {
      return new IncidentState();
    }, "0000000001");
  },
  stubProjectStates: (states: States): void => {
    getJestSpyOn(IncidentStateService, "getAllIncidentStates").mockResolvedValue(
      states.all,
    );
  },
  stubMembers: (memberStates: Array<ObjectID | undefined>): Array<ObjectID> => {
    const ids: Array<ObjectID> = memberStates.map((): ObjectID => {
      return ObjectID.generate();
    });

    getJestSpyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue(
      ids.map((id: ObjectID): IncidentEpisodeMember => {
        const member: IncidentEpisodeMember = new IncidentEpisodeMember();
        member.incidentId = id;
        return member;
      }),
    );
    getJestSpyOn(IncidentService, "findBy").mockResolvedValue(
      ids.map((id: ObjectID, index: number): Incident => {
        const incident: Incident = new Incident();
        incident._id = id.toString();
        incident.projectId = PROJECT_ID;

        if (memberStates[index]) {
          incident.currentIncidentStateId = memberStates[index];
        }

        return incident;
      }),
    );

    return ids;
  },
  stubMemberMoves: (): Array<{ memberId: string; stateId: string }> => {
    const moves: Array<{ memberId: string; stateId: string }> = [];

    getJestSpyOn(IncidentService, "changeIncidentState").mockImplementation(
      (async (data: {
        incidentId: ObjectID;
        incidentStateId: ObjectID;
      }): Promise<void> => {
        moves.push({
          memberId: data.incidentId.toString(),
          stateId: data.incidentStateId.toString(),
        });
      }) as never,
    );

    return moves;
  },
  cascade: (stateId: ObjectID): Promise<void> => {
    return IncidentEpisodeService.cascadeStateToMemberIncidents({
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      incidentStateId: stateId,
      props: { isRoot: true },
    });
  },
  episodeService: IncidentEpisodeService,
  timelineService: IncidentEpisodeStateTimelineService,
  changeEpisodeState: (data: {
    stateId: ObjectID;
    isGroupingRuleReopen?: boolean;
  }): Promise<void> => {
    return IncidentEpisodeService.changeEpisodeState({
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      incidentStateId: data.stateId,
      notifyOwners: true,
      rootCause: undefined,
      props: { isRoot: true },
      isGroupingRuleReopen: data.isGroupingRuleReopen,
    });
  },
  stateKey: "currentIncidentStateId",
  stateRelation: "currentIncidentState",
  makeEpisode: (stateId: ObjectID): BaseModel => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode._id = EPISODE_ID.toString();
    episode.projectId = PROJECT_ID;
    episode.currentIncidentStateId = stateId;
    return episode;
  },
  makeTimeline: (stateId: ObjectID, startsAt: Date): BaseModel => {
    const row: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    row._id = ObjectID.generate().toString();
    row.projectId = PROJECT_ID;
    row.incidentEpisodeId = EPISODE_ID;
    row.incidentStateId = stateId;
    row.startsAt = startsAt;
    return row;
  },
  stubIsResolved: (states: States): void => {
    getJestSpyOn(
      IncidentStateService,
      "isResolvedIncidentState",
    ).mockImplementation((async (data: {
      incidentStateId: ObjectID;
    }): Promise<boolean> => {
      return (
        data.incidentStateId.toString() === states.resolved.toString() ||
        data.incidentStateId.toString() === states.closed.toString()
      );
    }) as never);
  },
};

const ALERT_EPISODE: EpisodeKind = {
  name: "an alert episode",
  states: (): States => {
    return statesOf((): AlertState => {
      return new AlertState();
    }, "0000000002");
  },
  stubProjectStates: (states: States): void => {
    getJestSpyOn(AlertStateService, "getAllAlertStates").mockResolvedValue(
      states.all,
    );
  },
  stubMembers: (memberStates: Array<ObjectID | undefined>): Array<ObjectID> => {
    const ids: Array<ObjectID> = memberStates.map((): ObjectID => {
      return ObjectID.generate();
    });

    getJestSpyOn(AlertEpisodeMemberService, "findBy").mockResolvedValue(
      ids.map((id: ObjectID): AlertEpisodeMember => {
        const member: AlertEpisodeMember = new AlertEpisodeMember();
        member.alertId = id;
        return member;
      }),
    );
    getJestSpyOn(AlertService, "findBy").mockResolvedValue(
      ids.map((id: ObjectID, index: number): Alert => {
        const alert: Alert = new Alert();
        alert._id = id.toString();
        alert.projectId = PROJECT_ID;

        if (memberStates[index]) {
          alert.currentAlertStateId = memberStates[index];
        }

        return alert;
      }),
    );

    return ids;
  },
  stubMemberMoves: (): Array<{ memberId: string; stateId: string }> => {
    const moves: Array<{ memberId: string; stateId: string }> = [];

    getJestSpyOn(AlertService, "changeAlertState").mockImplementation(
      (async (data: {
        alertId: ObjectID;
        alertStateId: ObjectID;
      }): Promise<void> => {
        moves.push({
          memberId: data.alertId.toString(),
          stateId: data.alertStateId.toString(),
        });
      }) as never,
    );

    return moves;
  },
  cascade: (stateId: ObjectID): Promise<void> => {
    return AlertEpisodeService.cascadeStateToMemberAlerts({
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      alertStateId: stateId,
      props: { isRoot: true },
    });
  },
  episodeService: AlertEpisodeService,
  timelineService: AlertEpisodeStateTimelineService,
  changeEpisodeState: (data: {
    stateId: ObjectID;
    isGroupingRuleReopen?: boolean;
  }): Promise<void> => {
    return AlertEpisodeService.changeEpisodeState({
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      alertStateId: data.stateId,
      notifyOwners: true,
      rootCause: undefined,
      props: { isRoot: true },
      isGroupingRuleReopen: data.isGroupingRuleReopen,
    });
  },
  stateKey: "currentAlertStateId",
  stateRelation: "currentAlertState",
  makeEpisode: (stateId: ObjectID): BaseModel => {
    const episode: AlertEpisode = new AlertEpisode();
    episode._id = EPISODE_ID.toString();
    episode.projectId = PROJECT_ID;
    episode.currentAlertStateId = stateId;
    return episode;
  },
  makeTimeline: (stateId: ObjectID, startsAt: Date): BaseModel => {
    const row: AlertEpisodeStateTimeline = new AlertEpisodeStateTimeline();
    row._id = ObjectID.generate().toString();
    row.projectId = PROJECT_ID;
    row.alertEpisodeId = EPISODE_ID;
    row.alertStateId = stateId;
    row.startsAt = startsAt;
    return row;
  },
  stubIsResolved: (states: States): void => {
    getJestSpyOn(AlertStateService, "isResolvedAlertState").mockImplementation(
      (async (data: { alertStateId: ObjectID }): Promise<boolean> => {
        return (
          data.alertStateId.toString() === states.resolved.toString() ||
          data.alertStateId.toString() === states.closed.toString()
        );
      }) as never,
    );
  },
};

const KINDS: Array<EpisodeKind> = [INCIDENT_EPISODE, ALERT_EPISODE];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("$name", (kind: EpisodeKind) => {
  let states: States;

  beforeEach(() => {
    states = kind.states();
    kind.stubProjectStates(states);
  });

  describe("moves its members only where their own timelines take them", () => {
    test("into Acknowledged: the open member moves, the acknowledged, resolved and closed ones stay", async () => {
      const [open, acknowledged, resolved, closed] = kind.stubMembers([
        states.created,
        states.acknowledged,
        states.resolved,
        states.closed,
      ]) as [ObjectID, ObjectID, ObjectID, ObjectID];
      const moves: Array<{ memberId: string; stateId: string }> =
        kind.stubMemberMoves();

      await kind.cascade(states.acknowledged);

      expect(moves).toEqual([
        { memberId: open.toString(), stateId: states.acknowledged.toString() },
      ]);
      for (const untouched of [acknowledged, resolved, closed]) {
        expect(
          moves.find((move: { memberId: string }) => {
            return move.memberId === untouched.toString();
          }),
        ).toBeUndefined();
      }
    });

    test("into Resolved: every member not resolved yet moves; one in a state after Resolved stays", async () => {
      const [open, acknowledged] = kind.stubMembers([
        states.created,
        states.acknowledged,
        states.resolved,
        states.closed,
      ]) as [ObjectID, ObjectID, ObjectID, ObjectID];
      const moves: Array<{ memberId: string; stateId: string }> =
        kind.stubMemberMoves();

      await kind.cascade(states.resolved);

      expect(moves).toEqual([
        { memberId: open.toString(), stateId: states.resolved.toString() },
        {
          memberId: acknowledged.toString(),
          stateId: states.resolved.toString(),
        },
      ]);
    });

    test("back up the list - the grouping rule's reopen - no member is moved back", async () => {
      kind.stubMembers([
        states.acknowledged,
        states.resolved,
        states.closed,
      ]);
      const moves: Array<{ memberId: string; stateId: string }> =
        kind.stubMemberMoves();

      await kind.cascade(states.created);

      expect(moves).toEqual([]);
    });

    test("a member with no state yet, or in a state the list does not hold, is moved", async () => {
      const [stateless, unlisted] = kind.stubMembers([
        undefined,
        ObjectID.generate(),
      ]) as [ObjectID, ObjectID];
      const moves: Array<{ memberId: string; stateId: string }> =
        kind.stubMemberMoves();

      await kind.cascade(states.resolved);

      expect(
        moves.map((move: { memberId: string }) => {
          return move.memberId;
        }),
      ).toEqual([stateless.toString(), unlisted.toString()]);
    });

    test("a member whose move still fails is logged, and the others go on", async () => {
      const [first, second] = kind.stubMembers([
        states.created,
        states.created,
      ]) as [ObjectID, ObjectID];
      const moved: Array<string> = [];

      getJestSpyOn(
        kind === INCIDENT_EPISODE ? IncidentService : AlertService,
        kind === INCIDENT_EPISODE ? "changeIncidentState" : "changeAlertState",
      ).mockImplementation((async (data: {
        incidentId?: ObjectID;
        alertId?: ObjectID;
      }): Promise<void> => {
        const id: string = (data.incidentId || data.alertId)!.toString();

        if (id === first.toString()) {
          throw new Error("The database went away.");
        }

        moved.push(id);
      }) as never);

      await kind.cascade(states.acknowledged);

      expect(moved).toEqual([second.toString()]);
    });
  });

  describe("changes its state through its timeline", () => {
    function stubTimelineWrites(lastStateId: ObjectID): {
      creates: ReturnType<typeof getJestSpyOn>;
      reopens: ReturnType<typeof getJestSpyOn>;
    } {
      getJestSpyOn(kind.timelineService, "findOneBy").mockResolvedValue(
        kind.makeTimeline(lastStateId, new Date("2026-10-11T08:00:00.000Z")),
      );

      return {
        creates: getJestSpyOn(kind.timelineService, "create").mockResolvedValue(
          undefined as never,
        ),
        reopens: getJestSpyOn(
          kind.timelineService,
          "createReopen",
        ).mockResolvedValue(undefined as never),
      };
    }

    test("a change is a plain create of a timeline row, held to the rule", async () => {
      const writes: ReturnType<typeof stubTimelineWrites> = stubTimelineWrites(
        states.created,
      );

      await kind.changeEpisodeState({ stateId: states.resolved });

      expect(writes.creates).toHaveBeenCalledTimes(1);
      expect(writes.reopens).not.toHaveBeenCalled();
    });

    test("the grouping rule's reopen goes through the timeline's reopen", async () => {
      const writes: ReturnType<typeof stubTimelineWrites> = stubTimelineWrites(
        states.resolved,
      );

      await kind.changeEpisodeState({
        stateId: states.created,
        isGroupingRuleReopen: true,
      });

      expect(writes.reopens).toHaveBeenCalledTimes(1);
      expect(writes.creates).not.toHaveBeenCalled();
    });

    test("the state it is in already is no change: nothing is written", async () => {
      const writes: ReturnType<typeof stubTimelineWrites> = stubTimelineWrites(
        states.resolved,
      );

      await kind.changeEpisodeState({ stateId: states.resolved });

      expect(writes.creates).not.toHaveBeenCalled();
      expect(writes.reopens).not.toHaveBeenCalled();
    });
  });

  describe("an update that writes its state", () => {
    const MEMBER_PROPS: DatabaseCommonInteractionProps = {
      userId: ObjectID.generate(),
      tenantId: PROJECT_ID,
    };

    function beforeUpdate(
      data: Record<string, unknown>,
      props: DatabaseCommonInteractionProps = MEMBER_PROPS,
    ): Promise<unknown> {
      return (
        kind.episodeService as {
          onBeforeUpdate: (updateBy: UpdateBy<BaseModel>) => Promise<unknown>;
        }
      ).onBeforeUpdate({
        query: { _id: EPISODE_ID.toString() },
        data: data,
        props: props,
      } as unknown as UpdateBy<BaseModel>);
    }

    function stubEpisodeIn(stateId: ObjectID): ReturnType<typeof getJestSpyOn> {
      // The state and severity the update names are the project's.
      stubProjectDirectory({});
      getJestSpyOn(
        ProjectScopedReferenceValidator,
        "validateUpdateReferences",
      ).mockResolvedValue(undefined as never);

      return getJestSpyOn(
        kind.episodeService,
        "findRowsAndHoldUpdateToThem",
      ).mockResolvedValue([kind.makeEpisode(stateId)] as never);
    }

    test("back up the list is refused before anything is written, with the timeline's sentence", async () => {
      stubEpisodeIn(states.resolved);

      await expect(
        beforeUpdate({ [kind.stateKey]: states.acknowledged }),
      ).rejects.toThrow(
        `Episode cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of ${kind === INCIDENT_EPISODE ? "incident" : "alert"} states.`,
      );
    });

    test("from a state of the project's own after Resolved, back to Resolved, is refused", async () => {
      stubEpisodeIn(states.closed);

      await expect(
        beforeUpdate({ [kind.stateRelation]: { _id: states.resolved.toString() } }),
      ).rejects.toThrow(
        "Episode cannot transition to Resolved state from Closed state",
      );
    });

    test("down the list is taken", async () => {
      stubEpisodeIn(states.acknowledged);

      await beforeUpdate({ [kind.stateKey]: states.resolved });
    });

    test("an update that writes no state is not read for it", async () => {
      const rowsRead: ReturnType<typeof getJestSpyOn> = stubEpisodeIn(
        states.resolved,
      );

      await beforeUpdate({ title: "Checkout is slow" });

      expect(rowsRead).not.toHaveBeenCalled();
    });

    test("OneUptime's own writes of its state, carried over from the timeline, are not held to it again", async () => {
      stubEpisodeIn(states.resolved);
      const statesRead: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        kind === INCIDENT_EPISODE ? IncidentStateService : AlertStateService,
        kind === INCIDENT_EPISODE ? "getAllIncidentStates" : "getAllAlertStates",
      ).mockResolvedValue(states.all as never);

      // Back up the list, as a grouping rule's reopen carries it over: taken.
      await beforeUpdate({ [kind.stateKey]: states.created }, { isRoot: true });

      expect(statesRead).not.toHaveBeenCalled();
    });

    test("once saved, the state is recorded on its timeline, as OneUptime, for each episode written", async () => {
      const changes: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        kind.episodeService,
        "changeEpisodeState",
      ).mockResolvedValue(undefined as never);

      await (
        kind.episodeService as {
          onUpdateSuccess: (
            onUpdate: { updateBy: UpdateBy<BaseModel>; carryForward: unknown },
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { [kind.stateKey]: states.resolved },
            props: MEMBER_PROPS,
          } as unknown as UpdateBy<BaseModel>,
          carryForward: null,
        },
        [EPISODE_ID],
      );

      expect(changes).toHaveBeenCalledTimes(1);
      const change: Record<string, unknown> = changes.mock.calls[0]![0];
      expect(String(change["episodeId"])).toBe(EPISODE_ID.toString());
      expect(
        String(
          change[kind === INCIDENT_EPISODE ? "incidentStateId" : "alertStateId"],
        ),
      ).toBe(states.resolved.toString());
      expect(change["props"]).toEqual({ isRoot: true });
      expect(change["isGroupingRuleReopen"]).toBeUndefined();
    });

    test("OneUptime's own carried-over write records nothing more", async () => {
      const changes: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        kind.episodeService,
        "changeEpisodeState",
      ).mockResolvedValue(undefined as never);

      await (
        kind.episodeService as {
          onUpdateSuccess: (
            onUpdate: { updateBy: UpdateBy<BaseModel>; carryForward: unknown },
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { [kind.stateKey]: states.resolved },
            props: { isRoot: true },
          } as unknown as UpdateBy<BaseModel>,
          carryForward: null,
        },
        [EPISODE_ID],
      );

      expect(changes).not.toHaveBeenCalled();
    });
  });

  describe("deleting a row of its timeline puts it where its latest row is", () => {
    async function deleteSettlesOn(data: {
      latestStateId: ObjectID;
      resolvedAt: Date | null;
    }): Promise<Record<string, unknown>> {
      const latestAt: Date = new Date("2026-10-11T07:30:00.000Z");
      kind.stubIsResolved(states);

      getJestSpyOn(kind.timelineService, "findOneBy").mockResolvedValue(
        kind.makeTimeline(data.latestStateId, latestAt),
      );
      getJestSpyOn(kind.episodeService, "findOneById").mockResolvedValue({
        resolvedAt: data.resolvedAt,
      } as never);
      const writes: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        kind.episodeService,
        "updateOneBy",
      ).mockResolvedValue(1 as never);

      await (
        kind.timelineService as {
          onDeleteSuccess: (
            onDelete: { deleteBy: unknown; carryForward: unknown },
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onDeleteSuccess({ deleteBy: {}, carryForward: EPISODE_ID }, []);

      expect(writes).toHaveBeenCalledTimes(1);
      const write: {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = writes.mock.calls[0]![0];
      expect(write.query).toEqual({ _id: EPISODE_ID.toString() });
      expect(write.props).toEqual({ isRoot: true });

      return { ...write.data, latestAt };
    }

    test("the row that resolved it deleted: it is open again, and resolvedAt is cleared", async () => {
      const written: Record<string, unknown> = await deleteSettlesOn({
        latestStateId: states.acknowledged,
        resolvedAt: new Date("2026-10-11T09:00:00.000Z"),
      });

      expect(String(written[kind.stateKey])).toBe(
        states.acknowledged.toString(),
      );
      expect(written["resolvedAt"]).toBeNull();
    });

    test("still resolved: it keeps the time it was resolved at", async () => {
      const written: Record<string, unknown> = await deleteSettlesOn({
        latestStateId: states.resolved,
        resolvedAt: new Date("2026-10-11T09:00:00.000Z"),
      });

      expect(String(written[kind.stateKey])).toBe(states.resolved.toString());
      expect("resolvedAt" in written).toBe(false);
    });

    test("resolved again by the delete - its reopen undone - it takes the time its latest row started", async () => {
      const written: Record<string, unknown> = await deleteSettlesOn({
        latestStateId: states.closed,
        resolvedAt: null,
      });

      expect(String(written[kind.stateKey])).toBe(states.closed.toString());
      expect(written["resolvedAt"]).toEqual(written["latestAt"]);
    });
  });
});
