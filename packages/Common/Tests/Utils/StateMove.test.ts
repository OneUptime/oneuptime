import AlertState from "../../Models/DatabaseModels/AlertState";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ObjectID from "../../Types/ObjectID";
import StateMoveUtil, {
  StateMoveList,
  StateMoveRecord,
  StateMoveState,
} from "../../Utils/StateMove";
import {
  StateListRow,
  StateListType,
  isStateListRowAfter,
} from "../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A RECORD MAY MOVE NEXT - THE ONE RULE EVERY STATE TIMELINE ASKS
 * (Common/Utils/StateMove), pinned without a database.
 *
 * A record walks down its project's list of states. A new row of its state
 * timeline is refused when it puts the record in the state it is in, moves
 * it back up the list, or puts a back-dated row in the state of the row
 * after it. Episodes are held to it exactly as the incidents and alerts they
 * group are - the report this pins was a resolved episode moved back to an
 * earlier state, and the move cascading to its members. The one move back
 * up is OneUptime's grouping-rule reopen.
 */

interface Kind {
  name: string;
  record: StateMoveRecord;
  list: StateMoveList;
  subject: string;
  listName: string;
  // The project's states, top first; the last is one of its own, after the built-in end.
  states: Array<StateMoveState & { name: string; order: number }>;
}

let nextId: number = 1;

function stateNamed(
  name: string,
  order: number,
): StateMoveState & { name: string; order: number } {
  return {
    id: new ObjectID(
      `019acd20-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    ),
    name: name,
    order: order,
  };
}

function incidentLikeStates(): Array<
  StateMoveState & { name: string; order: number }
> {
  return [
    stateNamed("Created", 1),
    stateNamed("Acknowledged", 2),
    stateNamed("Investigating", 3),
    stateNamed("Resolved", 4),
    stateNamed("Closed", 5),
  ];
}

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    record: StateMoveRecord.Incident,
    list: StateListType.IncidentState,
    subject: "Incident",
    listName: "incident states",
    states: incidentLikeStates(),
  },
  {
    name: "an alert",
    record: StateMoveRecord.Alert,
    list: StateListType.AlertState,
    subject: "Alert",
    listName: "alert states",
    states: incidentLikeStates(),
  },
  {
    name: "an incident episode",
    record: StateMoveRecord.IncidentEpisode,
    list: StateListType.IncidentState,
    subject: "Episode",
    listName: "incident states",
    states: incidentLikeStates(),
  },
  {
    name: "an alert episode",
    record: StateMoveRecord.AlertEpisode,
    list: StateListType.AlertState,
    subject: "Episode",
    listName: "alert states",
    states: incidentLikeStates(),
  },
  {
    name: "a scheduled maintenance event",
    record: StateMoveRecord.ScheduledMaintenance,
    list: StateListType.ScheduledMaintenanceState,
    subject: "Scheduled Maintenance",
    listName: "scheduled maintenance states",
    states: [
      stateNamed("Scheduled", 1),
      stateNamed("Ongoing", 2),
      stateNamed("Ended", 3),
      stateNamed("Completed", 4),
      stateNamed("Archived", 5),
    ],
  },
];

function stateOf(
  kind: Kind,
  index: number,
): StateMoveState & { name: string; order: number } {
  return kind.states[index]!;
}

describe("StateMoveUtil.getMoveRefusal", () => {
  describe.each(KINDS)("$name", (kind: Kind) => {
    test("moves down the list, one state or several at once", () => {
      for (let from: number = 0; from < kind.states.length; from++) {
        for (let to: number = from + 1; to < kind.states.length; to++) {
          expect(
            StateMoveUtil.getMoveRefusal({
              record: kind.record,
              from: stateOf(kind, from),
              to: stateOf(kind, to),
            }),
          ).toBeNull();
        }
      }
    });

    test("never back up the list, with the sentence the timeline gives", () => {
      for (let from: number = 1; from < kind.states.length; from++) {
        for (let to: number = 0; to < from; to++) {
          const fromState: { name: string } = stateOf(kind, from);
          const toState: { name: string } = stateOf(kind, to);

          expect(
            StateMoveUtil.getMoveRefusal({
              record: kind.record,
              from: stateOf(kind, from),
              to: stateOf(kind, to),
            }),
          ).toBe(
            `${kind.subject} cannot transition to ${toState.name} state from ${fromState.name} state because ${toState.name} is before ${fromState.name} in the order of ${kind.listName}.`,
          );
        }
      }
    });

    test("not into the state it is in", () => {
      for (const state of kind.states) {
        expect(
          StateMoveUtil.getMoveRefusal({
            record: kind.record,
            from: state,
            to: { id: state.id },
          }),
        ).toBe(`${kind.subject} state cannot be same as previous state.`);
      }
    });

    test("from the state that closes the list, only into the project's own state after it", () => {
      const closing: StateMoveState = stateOf(kind, 3);
      const after: StateMoveState = stateOf(kind, 4);

      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: closing,
          to: after,
        }),
      ).toBeNull();

      for (const earlier of kind.states.slice(0, 3)) {
        expect(
          StateMoveUtil.getMoveRefusal({
            record: kind.record,
            from: closing,
            to: earlier,
          }),
        ).toContain(`${kind.subject} cannot transition to ${earlier.name}`);
      }
    });

    test("from the project's own state after the closing one, nowhere at all", () => {
      const last: StateMoveState = stateOf(kind, 4);

      for (const state of kind.states) {
        expect(
          StateMoveUtil.getMoveRefusal({
            record: kind.record,
            from: last,
            to: state,
          }),
        ).not.toBeNull();
      }
    });

    test("a back-dated row is not put in the state of the row after it", () => {
      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: stateOf(kind, 0),
          to: stateOf(kind, 2),
          nextStateId: stateOf(kind, 2).id,
        }),
      ).toBe(`${kind.subject} state cannot be same as next state.`);

      // Another state after it is no clash.
      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: stateOf(kind, 0),
          to: stateOf(kind, 1),
          nextStateId: stateOf(kind, 2).id,
        }),
      ).toBeNull();
    });

    test("a record's first row may be any state but the one after it", () => {
      for (const state of kind.states) {
        expect(
          StateMoveUtil.getMoveRefusal({
            record: kind.record,
            from: null,
            to: state,
          }),
        ).toBeNull();
      }

      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: undefined,
          to: stateOf(kind, 1),
          nextStateId: stateOf(kind, 1).id,
        }),
      ).toBe(`${kind.subject} state cannot be same as next state.`);
    });
  });

  test("an episode is refused exactly what the records it groups are refused, in its own name", () => {
    const pairs: Array<[Kind, Kind]> = [
      [KINDS[0]!, KINDS[2]!],
      [KINDS[1]!, KINDS[3]!],
    ];

    for (const [member, episode] of pairs) {
      for (let from: number = 0; from < 5; from++) {
        for (let to: number = 0; to < 5; to++) {
          const memberRefusal: string | null = StateMoveUtil.getMoveRefusal({
            record: member.record,
            from: stateOf(member, from),
            to: stateOf(member, to),
          });
          const episodeRefusal: string | null = StateMoveUtil.getMoveRefusal({
            record: episode.record,
            from: stateOf(episode, from),
            to: stateOf(episode, to),
          });

          expect(episodeRefusal === null).toBe(memberRefusal === null);

          if (memberRefusal) {
            expect(episodeRefusal).toBe(
              memberRefusal.replace(member.subject, "Episode"),
            );
          }
        }
      }
    }
  });

  test("a resolved episode is not moved back to an earlier state", () => {
    const episode: Kind = KINDS[2]!;

    expect(
      StateMoveUtil.getMoveRefusal({
        record: episode.record,
        from: stateOf(episode, 3),
        to: stateOf(episode, 1),
      }),
    ).toBe(
      "Episode cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of incident states.",
    );
  });

  test("the grouping rule's reopen is the one move back up the list", () => {
    for (const kind of [KINDS[2]!, KINDS[3]!]) {
      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: stateOf(kind, 3),
          to: stateOf(kind, 0),
          isGroupingRuleReopen: true,
        }),
      ).toBeNull();

      // It still never puts the episode in the state it is in.
      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: stateOf(kind, 3),
          to: stateOf(kind, 3),
          isGroupingRuleReopen: true,
        }),
      ).toBe("Episode state cannot be same as previous state.");

      // Nor in the state of the row after it.
      expect(
        StateMoveUtil.getMoveRefusal({
          record: kind.record,
          from: stateOf(kind, 3),
          to: stateOf(kind, 0),
          nextStateId: stateOf(kind, 0).id,
          isGroupingRuleReopen: true,
        }),
      ).toBe("Episode state cannot be same as next state.");
    }
  });

  test("states are compared by id whatever form the id takes", () => {
    const kind: Kind = KINDS[0]!;
    const state: StateMoveState & { name: string; order: number } = stateOf(
      kind,
      1,
    );

    // As a model's _id string, upper-cased, against the ObjectID.
    expect(
      StateMoveUtil.getMoveRefusal({
        record: kind.record,
        from: { _id: state.id!.toString().toUpperCase(), order: 2 },
        to: { id: state.id },
      }),
    ).toBe("Incident state cannot be same as previous state.");
  });

  test("a state without a place is compared by its id alone", () => {
    const kind: Kind = KINDS[2]!;

    // The state moved from has no place: nothing about its order is known.
    expect(
      StateMoveUtil.getMoveRefusal({
        record: kind.record,
        from: { id: ObjectID.generate(), name: "Old" },
        to: stateOf(kind, 0),
      }),
    ).toBeNull();

    // Nor the state moved to.
    expect(
      StateMoveUtil.getMoveRefusal({
        record: kind.record,
        from: stateOf(kind, 4),
        to: { id: ObjectID.generate() },
      }),
    ).toBeNull();
  });

  test("models and their places as text are read the same", () => {
    const resolved: IncidentState = new IncidentState();
    resolved._id = ObjectID.generate().toString();
    resolved.name = "Resolved";
    resolved.order = 4;

    const created: IncidentState = new IncidentState();
    created._id = ObjectID.generate().toString();
    created.name = "Created";
    created.order = 1;

    expect(
      StateMoveUtil.getMoveRefusal({
        record: StateMoveRecord.IncidentEpisode,
        from: resolved,
        to: { ...created, order: "1" } as unknown as StateMoveState,
      }),
    ).toBe(
      "Episode cannot transition to Created state from Resolved state because Created is before Resolved in the order of incident states.",
    );
  });
});

describe("StateMoveUtil.isMoveAllowed and getStatesToMoveTo", () => {
  describe.each(KINDS)("$name", (kind: Kind) => {
    test("allow exactly the moves getMoveRefusal takes", () => {
      for (const from of kind.states) {
        for (const to of kind.states) {
          expect(
            StateMoveUtil.isMoveAllowed({
              list: kind.list,
              states: kind.states,
              fromStateId: from.id,
              toStateId: to.id,
            }),
          ).toBe(
            StateMoveUtil.getMoveRefusal({
              record: kind.record,
              from: from,
              to: to,
            }) === null,
          );
        }
      }
    });

    test("offer from each state only the states after it, in the order given", () => {
      kind.states.forEach(
        (current: StateMoveState & { name: string }, index: number) => {
          expect(
            StateMoveUtil.getStatesToMoveTo({
              list: kind.list,
              states: kind.states,
              currentStateId: current.id,
            }).map((state: StateMoveState & { name: string }) => {
              return state.name;
            }),
          ).toEqual(
            kind.states.slice(index + 1).map((state: { name: string }) => {
              return state.name;
            }),
          );
        },
      );
    });
  });

  test("a record with no state yet may move into any state", () => {
    const kind: Kind = KINDS[0]!;

    expect(
      StateMoveUtil.getStatesToMoveTo({
        list: kind.list,
        states: kind.states,
        currentStateId: null,
      }),
    ).toEqual(kind.states);
    expect(
      StateMoveUtil.isMoveAllowed({
        list: kind.list,
        states: kind.states,
        fromStateId: undefined,
        toStateId: stateOf(kind, 0).id,
      }),
    ).toBe(true);
  });

  test("no state named to move into is no move", () => {
    const kind: Kind = KINDS[0]!;

    expect(
      StateMoveUtil.isMoveAllowed({
        list: kind.list,
        states: kind.states,
        fromStateId: stateOf(kind, 0).id,
        toStateId: null,
      }),
    ).toBe(false);
  });

  test("a record in a state the list does not hold may move into any other state", () => {
    const kind: Kind = KINDS[3]!;

    expect(
      StateMoveUtil.getStatesToMoveTo({
        list: kind.list,
        states: kind.states,
        currentStateId: ObjectID.generate(),
      }),
    ).toEqual(kind.states);
  });

  test("a state the list does not hold may be moved into from any state", () => {
    const kind: Kind = KINDS[1]!;

    expect(
      StateMoveUtil.isMoveAllowed({
        list: kind.list,
        states: kind.states,
        fromStateId: stateOf(kind, 4).id,
        toStateId: ObjectID.generate(),
      }),
    ).toBe(true);
  });

  test("reads the states as models: by _id, with their places", () => {
    const states: Array<AlertState> = ["Created", "Acknowledged", "Resolved"].map(
      (name: string, index: number): AlertState => {
        const state: AlertState = new AlertState();
        state._id = ObjectID.generate().toString();
        state.name = name;
        state.order = index + 1;
        return state;
      },
    );

    expect(
      StateMoveUtil.getStatesToMoveTo({
        list: StateListType.AlertState,
        states: states,
        currentStateId: new ObjectID(states[1]!._id!),
      }),
    ).toEqual([states[2]]);
  });

  test("a scheduled maintenance event's states are read by the same rule", () => {
    const states: Array<ScheduledMaintenanceState> = [
      "Scheduled",
      "Ongoing",
      "Completed",
    ].map((name: string, index: number): ScheduledMaintenanceState => {
      const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
      state._id = ObjectID.generate().toString();
      state.name = name;
      state.order = index + 1;
      return state;
    });

    expect(
      StateMoveUtil.getStatesToMoveTo({
        list: StateListType.ScheduledMaintenanceState,
        states: states,
        currentStateId: states[2]!._id,
      }),
    ).toEqual([]);
  });

  test("each record walks down its own list", () => {
    expect(StateMoveUtil.getList(StateMoveRecord.Incident)).toBe(
      StateListType.IncidentState,
    );
    expect(StateMoveUtil.getList(StateMoveRecord.IncidentEpisode)).toBe(
      StateListType.IncidentState,
    );
    expect(StateMoveUtil.getList(StateMoveRecord.Alert)).toBe(
      StateListType.AlertState,
    );
    expect(StateMoveUtil.getList(StateMoveRecord.AlertEpisode)).toBe(
      StateListType.AlertState,
    );
    expect(StateMoveUtil.getList(StateMoveRecord.ScheduledMaintenance)).toBe(
      StateListType.ScheduledMaintenanceState,
    );
  });
});

describe("isStateListRowAfter", () => {
  function row(order: number | null): StateListRow {
    return { id: ObjectID.generate().toString(), name: "", order, flags: [] };
  }

  test("a row placed below another is after it", () => {
    expect(isStateListRowAfter(row(3), row(2))).toBe(true);
    expect(isStateListRowAfter(row(2), row(3))).toBe(false);
  });

  test("two rows at the same place are not after each other", () => {
    expect(isStateListRowAfter(row(2), row(2))).toBe(false);
  });

  test("nothing is known of a row without a place", () => {
    expect(isStateListRowAfter(row(null), row(2))).toBeNull();
    expect(isStateListRowAfter(row(2), row(null))).toBeNull();
  });
});
