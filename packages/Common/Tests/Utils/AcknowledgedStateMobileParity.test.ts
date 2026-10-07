import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import AcknowledgedStateUtil, {
  AcknowledgedStateList,
} from "../../Utils/AcknowledgedState";
import ResolvedStateUtil from "../../Utils/ResolvedState";
import { StateListType } from "../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MOBILE APP'S COPY OF THE RULES SAYS WHAT THE SERVER'S SAYS, CASE FOR
 * CASE.
 *
 * The app is built without Common's runtime code, so it keeps its own copy of
 * the acknowledged and resolved rules (MobileApp/src/utils/acknowledgedState
 * and resolvedState). A copy drifts. This suite reads the app's two files,
 * compiles them as they are, and runs them next to
 * Common/Utils/AcknowledgedState and ResolvedState over the table both suites
 * share and over thousands of generated state lists - places missing, tied,
 * written as text, zero or below; flags on any state - asking each the same
 * questions. Any answer that differs fails here, whichever side moved.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const MOBILE_UTILS: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/utils",
);
const STATE_RULE_CASES: string = path.join(
  REPOSITORY_ROOT,
  "packages/MobileApp/src/__tests__/stateRuleCases.json",
);

interface MobileState {
  _id: string;
  order?: number | string | null;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

interface MobileRules {
  getAcknowledgedState: (states: Array<MobileState>) => MobileState | undefined;
  isAcknowledgedById: (
    states: Array<MobileState>,
    stateId: string | null | undefined,
  ) => boolean;
  getAcknowledgedStateIds: (states: Array<MobileState>) => Array<string>;
  getUnacknowledgedStateIds: (states: Array<MobileState>) => Array<string>;
  getResolvedState: (states: Array<MobileState>) => MobileState | undefined;
  isResolvedStateId: (
    states: Array<MobileState>,
    stateId: string | null | undefined,
  ) => boolean;
  getResolvedStateIds: (states: Array<MobileState>) => Array<string>;
  getUnresolvedStateIds: (states: Array<MobileState>) => Array<string>;
}

type ModuleExports = Record<string, unknown>;

/*
 * The app's file compiled to CommonJS as it is and run in a fresh context.
 * Its only import is the other copy ("./resolvedState").
 */
function loadMobileModule(
  fileName: string,
  modules: Record<string, ModuleExports>,
): ModuleExports {
  const source: string = fs.readFileSync(
    path.join(MOBILE_UTILS, fileName),
    "utf8",
  );

  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: fileName,
  }).outputText;

  const moduleObject: { exports: ModuleExports } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): ModuleExports => {
      const required: ModuleExports | undefined = modules[specifier];

      if (!required) {
        throw new Error(
          `The app's ${fileName} imports ${specifier}, which this suite does not provide.`,
        );
      }

      return required;
    },
  });

  return moduleObject.exports;
}

const resolvedStateModule: ModuleExports = loadMobileModule(
  "resolvedState.ts",
  {},
);
const acknowledgedStateModule: ModuleExports = loadMobileModule(
  "acknowledgedState.ts",
  { "./resolvedState": resolvedStateModule },
);

const MOBILE: MobileRules = {
  ...resolvedStateModule,
  ...acknowledgedStateModule,
} as unknown as MobileRules;

// The server's answers to the questions the app asks.
const SERVER: (list: AcknowledgedStateList) => MobileRules = (
  list: AcknowledgedStateList,
): MobileRules => {
  const idsOf: (states: Array<unknown>) => Array<string> = (
    states: Array<unknown>,
  ): Array<string> => {
    return states.map((state: unknown): string => {
      return (state as MobileState)._id;
    });
  };

  return {
    getAcknowledgedState: (states: Array<MobileState>) => {
      return (
        AcknowledgedStateUtil.getAcknowledgedState({ list, states }) ||
        undefined
      );
    },
    isAcknowledgedById: (
      states: Array<MobileState>,
      stateId: string | null | undefined,
    ) => {
      return AcknowledgedStateUtil.isAcknowledged({ list, states, stateId });
    },
    getAcknowledgedStateIds: (states: Array<MobileState>) => {
      return idsOf(AcknowledgedStateUtil.getAcknowledgedStates({ list, states }));
    },
    getUnacknowledgedStateIds: (states: Array<MobileState>) => {
      return idsOf(
        AcknowledgedStateUtil.getUnacknowledgedStates({ list, states }),
      );
    },
    getResolvedState: (states: Array<MobileState>) => {
      return ResolvedStateUtil.getResolvedState({ list, states }) || undefined;
    },
    isResolvedStateId: (
      states: Array<MobileState>,
      stateId: string | null | undefined,
    ) => {
      return ResolvedStateUtil.isResolved({ list, states, stateId });
    },
    getResolvedStateIds: (states: Array<MobileState>) => {
      return idsOf(ResolvedStateUtil.getResolvedStates({ list, states }));
    },
    getUnresolvedStateIds: (states: Array<MobileState>) => {
      return idsOf(ResolvedStateUtil.getUnresolvedStates({ list, states }));
    },
  };
};

interface Answers {
  acknowledgedStateId: string | null;
  resolvedStateId: string | null;
  acknowledged: Array<string>;
  unacknowledged: Array<string>;
  resolved: Array<string>;
  unresolved: Array<string>;
  byId: Record<string, [boolean, boolean]>;
}

const FOREIGN_ID: string = "somewhere-else";

// Every question both copies are asked about one list of states.
function ask(rules: MobileRules, states: Array<MobileState>): Answers {
  const byId: Record<string, [boolean, boolean]> = {};

  const lookups: Array<string | null> = [FOREIGN_ID, "", null];

  for (const state of states) {
    lookups.push(state._id, ` ${state._id.toUpperCase()} `);
  }

  for (const stateId of lookups) {
    byId[JSON.stringify(stateId)] = [
      rules.isAcknowledgedById(states, stateId),
      rules.isResolvedStateId(states, stateId),
    ];
  }

  return {
    acknowledgedStateId: rules.getAcknowledgedState(states)?._id ?? null,
    resolvedStateId: rules.getResolvedState(states)?._id ?? null,
    acknowledged: rules.getAcknowledgedStateIds(states),
    unacknowledged: rules.getUnacknowledgedStateIds(states),
    resolved: rules.getResolvedStateIds(states),
    unresolved: rules.getUnresolvedStateIds(states),
    byId: byId,
  };
}

/*
 * A deterministic stream of numbers (a linear congruential generator), so a
 * failing list can be found again from its index.
 */
function numbers(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const ORDERS: Array<number | string | null | undefined> = [
  null,
  undefined,
  1,
  2,
  3,
  4,
  5,
  0,
  -1,
  "3",
  " ",
  2.5,
];

const FLAGS: Array<Partial<MobileState>> = [
  {},
  {},
  { isCreatedState: true },
  { isAcknowledgedState: true },
  { isAcknowledgedState: true },
  { isResolvedState: true },
  { isResolvedState: true },
  { isAcknowledgedState: true, isResolvedState: true },
];

const IDS: Array<string> = [
  "0193c0de-5a7e-4eee-8fff-00000000c0a1",
  "0193c0de-5a7e-4eee-8fff-00000000c0a2",
  "0193c0de-5a7e-4eee-8fff-00000000c0a3",
  "0193c0de-5a7e-4eee-8fff-00000000c0a4",
  "0193c0de-5a7e-4eee-8fff-00000000c0a5",
  "0193c0de-5a7e-4eee-8fff-00000000c0a6",
  "0193c0de-5a7e-4eee-8fff-00000000c0a7",
];

function makeState(
  id: string,
  order: number | string | null | undefined,
  flags: Partial<MobileState>,
): MobileState {
  const state: MobileState = { _id: id, ...flags };

  if (order !== undefined) {
    state.order = order;
  }

  return state;
}

// Every list of up to two states, each with every place and flag.
function smallLists(): Array<Array<MobileState>> {
  const singles: Array<MobileState> = [];

  for (const order of ORDERS) {
    for (const flags of FLAGS) {
      singles.push(makeState(IDS[0]!, order, flags));
    }
  }

  const lists: Array<Array<MobileState>> = [[]];

  for (const first of singles) {
    lists.push([first]);

    for (const second of singles) {
      lists.push([first, { ...second, _id: IDS[1]! }]);
    }
  }

  return lists;
}

// Lists of three to seven states, places and flags drawn at random.
function randomLists(count: number): Array<Array<MobileState>> {
  const next: () => number = numbers(20261007);
  const lists: Array<Array<MobileState>> = [];

  for (let index: number = 0; index < count; index++) {
    const size: number = 3 + Math.floor(next() * 5);
    const ids: Array<string> = [...IDS]
      .sort(() => {
        return next() - 0.5;
      })
      .slice(0, size);

    lists.push(
      ids.map((id: string): MobileState => {
        return makeState(
          id,
          ORDERS[Math.floor(next() * ORDERS.length)],
          FLAGS[Math.floor(next() * FLAGS.length)]!,
        );
      }),
    );
  }

  return lists;
}

const LISTS: Array<[string, AcknowledgedStateList]> = [
  ["incident states", StateListType.IncidentState],
  ["alert states", StateListType.AlertState],
];

describe("the mobile app's copy of the rules loads from the app's own files", () => {
  test("every question this suite asks is answered by the app's copy", () => {
    for (const name of Object.keys(SERVER(StateListType.IncidentState))) {
      expect(typeof (MOBILE as unknown as ModuleExports)[name]).toBe(
        "function",
      );
    }
  });

  test("the app's copy really is the rule: it tells Investigating from Triage", () => {
    const states: Array<MobileState> = [
      { _id: "created", order: 1, isCreatedState: true },
      { _id: "triage", order: 2 },
      { _id: "acknowledged", order: 3, isAcknowledgedState: true },
      { _id: "investigating", order: 4 },
      { _id: "resolved", order: 5, isResolvedState: true },
    ];

    expect(MOBILE.isAcknowledgedById(states, "triage")).toBe(false);
    expect(MOBILE.isAcknowledgedById(states, "investigating")).toBe(true);
    expect(MOBILE.getAcknowledgedState(states)?._id).toBe("acknowledged");
  });
});

describe.each(LISTS)(
  "the mobile app and the server agree, over %s",
  (_name: string, list: AcknowledgedStateList) => {
    const server: MobileRules = SERVER(list);

    test("on every case of the table both suites run", () => {
      const table: { cases: Array<{ name: string; states: Array<MobileState> }> } =
        JSON.parse(fs.readFileSync(STATE_RULE_CASES, "utf8"));

      expect(table.cases.length).toBeGreaterThan(10);

      for (const ruleCase of table.cases) {
        expect({ case: ruleCase.name, ...ask(MOBILE, ruleCase.states) }).toEqual(
          { case: ruleCase.name, ...ask(server, ruleCase.states) },
        );
      }
    });

    test("on every list of up to two states, each with every place and flag", () => {
      const lists: Array<Array<MobileState>> = smallLists();

      expect(lists.length).toBeGreaterThan(9000);

      for (const states of lists) {
        expect({ states, ...ask(MOBILE, states) }).toEqual({
          states,
          ...ask(server, states),
        });
      }
    });

    test("on thousands of generated lists of three to seven states", () => {
      for (const states of randomLists(4000)) {
        expect({ states, ...ask(MOBILE, states) }).toEqual({
          states,
          ...ask(server, states),
        });
      }
    });
  },
);
