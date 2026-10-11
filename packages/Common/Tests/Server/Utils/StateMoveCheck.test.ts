import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import StateMoveCheck from "../../../Server/Utils/StateMoveCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { StateMoveRecord, StateMoveState } from "../../../Utils/StateMove";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE SERVER'S TWO ASKS OF THE ONE STATE MOVE RULE (Server/Utils/StateMoveCheck):
 *
 *   - assertTimelineRowAllowed: a new row of a record's state timeline,
 *     asked by every timeline service before it writes the row;
 *   - assertUpdateMovesAllowed: an update that writes a record's current
 *     state, asked by the record's service before anything is written, so a
 *     backward write is refused instead of landing on the record and then
 *     failing at its timeline.
 *
 * Both refuse with the rule's own sentence. The reads are handed in, so they
 * are faked here; what is pinned is what is read, when, and what is refused.
 */

const PROJECT_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000001");
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);

function incidentState(
  name: string,
  order: number,
  projectId: ObjectID = PROJECT_ID,
): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = ObjectID.generate().toString();
  state.projectId = projectId;
  state.name = name;
  state.order = order;
  return state;
}

// Created, Acknowledged, Resolved and - after it - Closed.
function projectStates(projectId: ObjectID = PROJECT_ID): {
  created: IncidentState;
  acknowledged: IncidentState;
  resolved: IncidentState;
  closed: IncidentState;
  all: Array<IncidentState>;
} {
  const created: IncidentState = incidentState("Created", 1, projectId);
  const acknowledged: IncidentState = incidentState(
    "Acknowledged",
    2,
    projectId,
  );
  const resolved: IncidentState = incidentState("Resolved", 3, projectId);
  const closed: IncidentState = incidentState("Closed", 4, projectId);

  return {
    created,
    acknowledged,
    resolved,
    closed,
    all: [created, acknowledged, resolved, closed],
  };
}

function idOf(state: IncidentState): ObjectID {
  return new ObjectID(state._id!);
}

function placed(state: IncidentState): StateMoveState {
  return { id: state._id, name: state.name, order: state.order };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("StateMoveCheck.assertTimelineRowAllowed", () => {
  function readerOf(state: IncidentState | null): Mock<
    () => Promise<StateMoveState | null>
  > {
    return jest.fn(async (): Promise<StateMoveState | null> => {
      return state ? { name: state.name, order: state.order } : null;
    });
  }

  test("a record's first row is compared with nothing, and reads nothing", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const read: Mock<() => Promise<StateMoveState | null>> = readerOf(
      states.closed,
    );

    await StateMoveCheck.assertTimelineRowAllowed({
      record: StateMoveRecord.IncidentEpisode,
      previousState: null,
      newStateId: idOf(states.closed),
      readNewState: read,
    });

    expect(read).not.toHaveBeenCalled();
  });

  test("a move down the list reads the state it moves to once, and passes", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const read: Mock<() => Promise<StateMoveState | null>> = readerOf(
      states.resolved,
    );

    await StateMoveCheck.assertTimelineRowAllowed({
      record: StateMoveRecord.IncidentEpisode,
      previousState: placed(states.acknowledged),
      newStateId: idOf(states.resolved),
      readNewState: read,
    });

    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each([
    [StateMoveRecord.Incident, "Incident"],
    [StateMoveRecord.IncidentEpisode, "Episode"],
  ])(
    "a %s moved back up the list is refused with the rule's sentence",
    async (record: StateMoveRecord, subject: string) => {
      const states: ReturnType<typeof projectStates> = projectStates();

      const error: unknown = await rejection(
        StateMoveCheck.assertTimelineRowAllowed({
          record: record,
          previousState: placed(states.resolved),
          newStateId: idOf(states.acknowledged),
          readNewState: readerOf(states.acknowledged),
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        `${subject} cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of incident states.`,
      );
    },
  );

  test("a move from a state of the project's own after Resolved, back to Resolved, is refused", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();

    await expect(
      StateMoveCheck.assertTimelineRowAllowed({
        record: StateMoveRecord.AlertEpisode,
        previousState: placed(states.closed),
        newStateId: idOf(states.resolved),
        readNewState: readerOf(states.resolved),
      }),
    ).rejects.toThrow(
      "Episode cannot transition to Resolved state from Closed state because Resolved is before Closed in the order of alert states.",
    );
  });

  test("the state it is in already is refused without reading it", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const read: Mock<() => Promise<StateMoveState | null>> = readerOf(
      states.resolved,
    );

    await expect(
      StateMoveCheck.assertTimelineRowAllowed({
        record: StateMoveRecord.ScheduledMaintenance,
        previousState: placed(states.resolved),
        newStateId: idOf(states.resolved),
        readNewState: read,
      }),
    ).rejects.toThrow(
      "Scheduled Maintenance state cannot be same as previous state.",
    );
    expect(read).not.toHaveBeenCalled();
  });

  test.each([
    ["no place", undefined],
    ["an empty place", ""],
    ["a null place", null],
  ])(
    "a row after a state with %s is compared by id alone, and reads nothing",
    async (_label: string, order: number | string | null | undefined) => {
      const states: ReturnType<typeof projectStates> = projectStates();
      const read: Mock<() => Promise<StateMoveState | null>> = readerOf(
        states.created,
      );

      await StateMoveCheck.assertTimelineRowAllowed({
        record: StateMoveRecord.Incident,
        previousState: { id: states.resolved._id, name: "Resolved", order },
        newStateId: idOf(states.created),
        readNewState: read,
      });

      expect(read).not.toHaveBeenCalled();
    },
  );

  test("a state that cannot be read has no place, and is compared by id alone", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();

    await StateMoveCheck.assertTimelineRowAllowed({
      record: StateMoveRecord.Incident,
      previousState: placed(states.resolved),
      newStateId: ObjectID.generate(),
      readNewState: readerOf(null),
    });
  });

  test("a back-dated row in the state of the row after it is refused", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();

    await expect(
      StateMoveCheck.assertTimelineRowAllowed({
        record: StateMoveRecord.Alert,
        previousState: placed(states.created),
        newStateId: idOf(states.acknowledged),
        nextStateId: idOf(states.acknowledged),
        readNewState: readerOf(states.acknowledged),
      }),
    ).rejects.toThrow("Alert state cannot be same as next state.");
  });

  test("the grouping rule's reopen moves an episode back up the list", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();

    await StateMoveCheck.assertTimelineRowAllowed({
      record: StateMoveRecord.IncidentEpisode,
      previousState: placed(states.resolved),
      newStateId: idOf(states.created),
      readNewState: readerOf(states.created),
      isGroupingRuleReopen: true,
    });
  });
});

describe("StateMoveCheck.assertUpdateMovesAllowed", () => {
  const MEMBER_PROPS: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  };

  interface Harness {
    findRowsAndHold: Mock<(select: unknown) => Promise<Array<IncidentEpisode>>>;
    getProjectStates: Mock<
      (projectId: ObjectID) => Promise<Array<StateMoveState>>
    >;
    run: (
      data: Record<string, unknown>,
      props?: DatabaseCommonInteractionProps,
    ) => Promise<void>;
  }

  function episodeIn(
    stateId: string | undefined,
    projectId: ObjectID = PROJECT_ID,
  ): IncidentEpisode {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode._id = ObjectID.generate().toString();
    episode.projectId = projectId;

    if (stateId) {
      episode.currentIncidentStateId = new ObjectID(stateId);
    }

    return episode;
  }

  function harness(data: {
    rows: Array<IncidentEpisode>;
    statesOf: (projectId: ObjectID) => Array<IncidentState>;
  }): Harness {
    const findRowsAndHold: Harness["findRowsAndHold"] = jest.fn(
      async (): Promise<Array<IncidentEpisode>> => {
        return data.rows;
      },
    );
    const getProjectStates: Harness["getProjectStates"] = jest.fn(
      async (projectId: ObjectID): Promise<Array<StateMoveState>> => {
        return data.statesOf(projectId);
      },
    );

    return {
      findRowsAndHold,
      getProjectStates,
      run: async (
        updateData: Record<string, unknown>,
        props: DatabaseCommonInteractionProps = MEMBER_PROPS,
      ): Promise<void> => {
        await StateMoveCheck.assertUpdateMovesAllowed<IncidentEpisode>({
          record: StateMoveRecord.IncidentEpisode,
          updateBy: {
            query: {},
            data: updateData,
            props: props,
          } as unknown as UpdateBy<IncidentEpisode>,
          stateKeys: ["currentIncidentStateId", "currentIncidentState"],
          stateModelName: "Incident State",
          findRowsAndHold: findRowsAndHold as never,
          getProjectStates: getProjectStates,
        });
      },
    };
  }

  test("an update that writes no state reads nothing", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.resolved._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await check.run({ title: "Checkout is slow" });

    expect(check.findRowsAndHold).not.toHaveBeenCalled();
    expect(check.getProjectStates).not.toHaveBeenCalled();
  });

  test("OneUptime's own writes of the state follow the timeline, and read nothing", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.resolved._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await check.run(
      { currentIncidentStateId: idOf(states.created) },
      { isRoot: true },
    );

    expect(check.findRowsAndHold).not.toHaveBeenCalled();
  });

  test("reads the rows the update writes, with their project and state, held to them", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.created._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await check.run({ currentIncidentStateId: idOf(states.acknowledged) });

    expect(check.findRowsAndHold).toHaveBeenCalledTimes(1);
    expect(check.findRowsAndHold.mock.calls[0]![0]).toEqual({
      _id: true,
      projectId: true,
      currentIncidentStateId: true,
    });
    expect(check.getProjectStates).toHaveBeenCalledTimes(1);
    expect(check.getProjectStates.mock.calls[0]![0].toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a write back up the list is refused, with the sentence the timeline gives", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.resolved._id)],
      statesOf: () => {
        return states.all;
      },
    });

    const error: unknown = await rejection(
      check.run({ currentIncidentStateId: idOf(states.acknowledged) }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Episode cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of incident states.",
    );
  });

  test("a write under the relation's name is held to the rule too", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.closed._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await expect(
      check.run({ currentIncidentState: { _id: states.resolved._id } }),
    ).rejects.toThrow(
      "Episode cannot transition to Resolved state from Closed state because Resolved is before Closed in the order of incident states.",
    );
  });

  test("the two names of the state that disagree are refused as ever", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.created._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await expect(
      check.run({
        currentIncidentStateId: idOf(states.acknowledged),
        currentIncidentState: { _id: states.resolved._id },
      }),
    ).rejects.toThrow(BadDataException);
    expect(check.findRowsAndHold).not.toHaveBeenCalled();
  });

  test("writing the state a record is in already moves nothing, and is left alone", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.resolved._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await check.run({ currentIncidentStateId: idOf(states.resolved) });

    expect(check.getProjectStates).not.toHaveBeenCalled();
  });

  test("a write down the list passes, and a write into a state the list does not hold is compared by id alone", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(states.resolved._id)],
      statesOf: () => {
        return states.all;
      },
    });

    await check.run({ currentIncidentStateId: idOf(states.closed) });
    await check.run({ currentIncidentStateId: ObjectID.generate() });
  });

  test("a record with no state yet may be written any state", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [episodeIn(undefined)],
      statesOf: () => {
        return states.all;
      },
    });

    await check.run({ currentIncidentStateId: idOf(states.created) });

    expect(check.getProjectStates).not.toHaveBeenCalled();
  });

  test("every record the update writes is held to the rule, and one moved back refuses the whole update", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const check: Harness = harness({
      rows: [
        episodeIn(states.created._id),
        episodeIn(states.acknowledged._id),
        episodeIn(states.closed._id),
      ],
      statesOf: () => {
        return states.all;
      },
    });

    await expect(
      check.run({ currentIncidentStateId: idOf(states.resolved) }),
    ).rejects.toThrow(
      "Episode cannot transition to Resolved state from Closed state",
    );
  });

  test("each project's states are read once, and each record is held to its own project's list", async () => {
    const here: ReturnType<typeof projectStates> = projectStates(PROJECT_ID);
    const there: ReturnType<typeof projectStates> =
      projectStates(OTHER_PROJECT_ID);

    // The same state id, placed differently in the two lists.
    there.all.forEach((state: IncidentState, index: number) => {
      state._id = here.all[here.all.length - 1 - index]!._id;
    });

    const check: Harness = harness({
      rows: [
        episodeIn(here.created._id, PROJECT_ID),
        episodeIn(here.acknowledged._id, PROJECT_ID),
        episodeIn(here.created._id, OTHER_PROJECT_ID),
      ],
      statesOf: (projectId: ObjectID) => {
        return projectId.toString() === PROJECT_ID.toString()
          ? here.all
          : there.all;
      },
    });

    // Resolved in the first list is the second state from the top in the other.
    const error: unknown = await rejection(
      check.run({ currentIncidentStateId: idOf(here.resolved) }),
    );

    expect((error as Error).message).toContain(
      "Episode cannot transition to",
    );
    expect(check.getProjectStates).toHaveBeenCalledTimes(2);
  });

  test("an incident's own update is held to the rule in its own name", async () => {
    const states: ReturnType<typeof projectStates> = projectStates();
    const incident: Incident = new Incident();
    incident._id = ObjectID.generate().toString();
    incident.projectId = PROJECT_ID;
    incident.currentIncidentStateId = idOf(states.resolved);

    await expect(
      StateMoveCheck.assertUpdateMovesAllowed<Incident>({
        record: StateMoveRecord.Incident,
        updateBy: {
          query: {},
          data: { currentIncidentStateId: idOf(states.created) },
          props: MEMBER_PROPS,
        } as unknown as UpdateBy<Incident>,
        stateKeys: ["currentIncidentStateId", "currentIncidentState"],
        stateModelName: "Incident State",
        findRowsAndHold: async (): Promise<Array<Incident>> => {
          return [incident];
        },
        getProjectStates: async (): Promise<Array<StateMoveState>> => {
          return states.all;
        },
      }),
    ).rejects.toThrow(
      "Incident cannot transition to Created state from Resolved state because Created is before Resolved in the order of incident states.",
    );
  });
});
