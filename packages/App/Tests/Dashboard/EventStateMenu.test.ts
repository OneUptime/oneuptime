import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import StateMoveUtil, {
  StateMoveList,
  StateMoveRecord,
} from "Common/Utils/StateMove";
import { StateListType } from "Common/Utils/StateOrder";
import {
  EventStateMenuState,
  getEventStateMenuStates,
} from "../../FeatureSet/Dashboard/src/Components/EventView/EventStateMenu";

/*
 * The "Change state to" menu in the header of an incident, an alert, an
 * episode or a scheduled maintenance event offers the states the record may
 * move into next - by the rule every state timeline holds a move to
 * (Common/Utils/StateMove) - so it never offers a move the server refuses.
 * An episode is held to it exactly as an incident or an alert is: a resolved
 * episode is offered no state back up the list, only a state of the
 * project's own placed after Resolved.
 */

interface MenuState extends EventStateMenuState {
  name: string;
}

// A project's states of one list, top first, with a state of its own after the last built-in one.
interface Kind {
  name: string;
  record: StateMoveRecord;
  list: StateMoveList;
  states: Array<MenuState>;
}

let nextId: number = 1;

function stateNamed(name: string, order: number): MenuState {
  const id: string = `019acd20-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
  return { id: id, name: name, order: order };
}

function incidentLikeStates(): Array<MenuState> {
  return [
    stateNamed("Created", 1),
    stateNamed("Acknowledged", 2),
    // A state of the project's own between Acknowledged and Resolved.
    stateNamed("Investigating", 3),
    stateNamed("Resolved", 4),
    // And one after Resolved, where a record may still move from Resolved.
    stateNamed("Closed", 5),
  ];
}

function maintenanceStates(): Array<MenuState> {
  return [
    stateNamed("Scheduled", 1),
    stateNamed("Ongoing", 2),
    stateNamed("Ended", 3),
    stateNamed("Completed", 4),
    stateNamed("Archived", 5),
  ];
}

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    record: StateMoveRecord.Incident,
    list: StateListType.IncidentState,
    states: incidentLikeStates(),
  },
  {
    name: "an incident episode",
    record: StateMoveRecord.IncidentEpisode,
    list: StateListType.IncidentState,
    states: incidentLikeStates(),
  },
  {
    name: "an alert",
    record: StateMoveRecord.Alert,
    list: StateListType.AlertState,
    states: incidentLikeStates(),
  },
  {
    name: "an alert episode",
    record: StateMoveRecord.AlertEpisode,
    list: StateListType.AlertState,
    states: incidentLikeStates(),
  },
  {
    name: "a scheduled maintenance event",
    record: StateMoveRecord.ScheduledMaintenance,
    list: StateListType.ScheduledMaintenanceState,
    states: maintenanceStates(),
  },
];

function names(states: Array<MenuState>): Array<string> {
  return states.map((state: MenuState): string => {
    return state.name;
  });
}

function stateOf(kind: Kind, name: string): MenuState {
  const state: MenuState | undefined = kind.states.find(
    (candidate: MenuState): boolean => {
      return candidate.name === name;
    },
  );

  if (!state) {
    throw new Error(`No state named ${name}`);
  }

  return state;
}

function menuFor(
  kind: Kind,
  currentStateName: string | undefined,
  buttonStateNames: Array<string> = [],
): Array<string> {
  return names(
    getEventStateMenuStates({
      list: kind.list,
      states: kind.states,
      currentStateId: currentStateName
        ? stateOf(kind, currentStateName).id
        : undefined,
      buttonStateIds: buttonStateNames.map((name: string): string => {
        return stateOf(kind, name).id;
      }),
    }),
  );
}

describe("the Change state to menu offers only the moves the server takes", () => {
  test.each(KINDS)(
    "$name is offered only the states after the one it is in",
    (kind: Kind): void => {
      const [first, second, third, fourth, fifth] = names(kind.states) as [
        string,
        string,
        string,
        string,
        string,
      ];

      expect(menuFor(kind, first)).toEqual([second, third, fourth, fifth]);
      expect(menuFor(kind, second)).toEqual([third, fourth, fifth]);
      expect(menuFor(kind, third)).toEqual([fourth, fifth]);
      expect(menuFor(kind, fourth)).toEqual([fifth]);
      // In the last state of the list there is nowhere left to move to.
      expect(menuFor(kind, fifth)).toEqual([]);
    },
  );

  test.each(KINDS)(
    "$name in a state of the project's own after the last built-in one is offered nothing back up the list",
    (kind: Kind): void => {
      const last: string = kind.states[kind.states.length - 1]!.name;
      expect(menuFor(kind, last)).toEqual([]);
    },
  );

  test.each(KINDS)(
    "for $name the menu offers a state exactly when its timeline would take the move",
    (kind: Kind): void => {
      for (const from of kind.states) {
        const offered: Array<string> = menuFor(kind, from.name);

        for (const to of kind.states) {
          const refusal: string | null = StateMoveUtil.getMoveRefusal({
            record: kind.record,
            from: from,
            to: to,
          });

          expect({
            from: from.name,
            to: to.name,
            offered: offered.includes(to.name),
          }).toEqual({
            from: from.name,
            to: to.name,
            offered: refusal === null,
          });
        }
      }
    },
  );

  test("a resolved episode is offered no state back up the list, as a resolved incident is", (): void => {
    const incident: Kind = KINDS[0]!;
    const episode: Kind = KINDS[1]!;

    expect(menuFor(episode, "Resolved")).toEqual(["Closed"]);
    expect(menuFor(episode, "Resolved")).toEqual(menuFor(incident, "Resolved"));
    expect(menuFor(KINDS[3]!, "Resolved")).toEqual(
      menuFor(KINDS[2]!, "Resolved"),
    );
  });

  test("leaves out the states a button next to the menu offers already", (): void => {
    const kind: Kind = KINDS[1]!;

    // Created: Acknowledge and Resolve are buttons.
    expect(menuFor(kind, "Created", ["Acknowledged", "Resolved"])).toEqual([
      "Investigating",
      "Closed",
    ]);
  });

  test("offers each state once", (): void => {
    const kind: Kind = KINDS[0]!;
    const investigating: MenuState = stateOf(kind, "Investigating");

    expect(
      names(
        getEventStateMenuStates({
          list: kind.list,
          states: [...kind.states, investigating],
          currentStateId: stateOf(kind, "Acknowledged").id,
          buttonStateIds: [],
        }),
      ),
    ).toEqual(["Investigating", "Resolved", "Closed"]);
  });

  test("goes by the states' places, not by the order they are handed in", (): void => {
    const kind: Kind = KINDS[2]!;
    const shuffled: Array<MenuState> = [
      stateOf(kind, "Resolved"),
      stateOf(kind, "Created"),
      stateOf(kind, "Closed"),
      stateOf(kind, "Investigating"),
      stateOf(kind, "Acknowledged"),
    ];

    expect(
      names(
        getEventStateMenuStates({
          list: kind.list,
          states: shuffled,
          currentStateId: stateOf(kind, "Investigating").id,
          buttonStateIds: [],
        }),
      ),
    ).toEqual(["Resolved", "Closed"]);
  });

  test("a state handed in without its place takes its place in the list", (): void => {
    const kind: Kind = KINDS[0]!;
    const withoutPlaces: Array<MenuState> = kind.states.map(
      (state: MenuState): MenuState => {
        return { id: state.id, name: state.name };
      },
    );

    expect(
      names(
        getEventStateMenuStates({
          list: kind.list,
          states: withoutPlaces,
          currentStateId: withoutPlaces[1]!.id,
          buttonStateIds: [],
        }),
      ),
    ).toEqual(["Investigating", "Resolved", "Closed"]);
  });

  test("a record in a state the list does not hold keeps every state on offer", (): void => {
    const kind: Kind = KINDS[1]!;

    expect(
      names(
        getEventStateMenuStates({
          list: kind.list,
          states: kind.states,
          currentStateId: "019acd20-9999-4999-8999-999999999999",
          buttonStateIds: [],
        }),
      ),
    ).toEqual(names(kind.states));
    expect(menuFor(kind, undefined)).toEqual(names(kind.states));
  });
});

/*
 * Every header hands the panel the places its states hold and the list they
 * belong to, so the menu goes by the rule the record's own timeline holds.
 */
describe("every event header gives the menu its states' places and list", () => {
  const COMPONENTS: Array<{ component: string; list: string }> = [
    { component: "Incident", list: "StateListType.IncidentState" },
    { component: "IncidentEpisode", list: "StateListType.IncidentState" },
    { component: "Alert", list: "StateListType.AlertState" },
    { component: "AlertEpisode", list: "StateListType.AlertState" },
    {
      component: "ScheduledMaintenance",
      list: "StateListType.ScheduledMaintenanceState",
    },
  ];

  test.each(COMPONENTS)(
    "$component passes its states' order and $list",
    ({ component, list }: { component: string; list: string }): void => {
      const source: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Dashboard",
          "src",
          "Components",
          component,
          "ChangeState.tsx",
        ),
        "utf8",
      );

      const panel: string = source.slice(source.indexOf("<EventStatusPanel"));

      expect(panel).toMatch(/order: state\.order,/);
      expect(panel).toContain(`stateList={${list}}`);
    },
  );

  test("the panel's menu goes through getEventStateMenuStates and keeps no rule of its own", (): void => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "EventView",
        "EventStatusPanel.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("getEventStateMenuStates({");
    expect(source).not.toMatch(/stateIndex\s*>\s*currentStateIndex/);
  });
});
