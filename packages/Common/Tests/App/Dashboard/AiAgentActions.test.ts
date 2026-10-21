import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_AGENT_RESET_AGENT_TEST_ID,
  AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
  AI_AGENT_TEST_CONNECTION_TEST_ID,
  AiAgentAction,
  AiAgentActionId,
  AiAgentActionsInput,
  getAiAgentActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentActions";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";

/*
 * What the AI agent card's ⋯ offers, decided once for a Kubernetes cluster's
 * AI agent page and every other resource's: "We can have both of these
 * buttons, like "Test Connection" and "Reset Agent," in a more button style
 * with three dots."
 *
 * Who is offered what is what the header's buttons offered before they
 * moved: a test the user may not run is locked and says which permission it
 * needs, it is left out while there is nothing honest to say, and the admin
 * actions are left out for everyone else. Every branch below, one at a time.
 */

const REQUIREMENT: string =
  "Testing the connection needs permission to edit this cluster (one of: Project Owner, Project Admin, Edit Kubernetes Cluster).";

const ALLOWED: PermissionGateResult = { isAllowed: true };

// A user the permission snapshot says may not edit the resource.
const LOCKED: PermissionGateResult = {
  isAllowed: false,
  disabledReason:
    "You do not have permission to update this Kubernetes Cluster.",
};

// The permission snapshot has not landed: nothing honest to say yet.
const UNKNOWN: PermissionGateResult = { isAllowed: false };

type Handler = ReturnType<typeof jest.fn<() => void>>;

interface Handlers {
  onRun: Handler;
  onSwitch: Handler;
  onReset: Handler;
}

function makeHandlers(): Handlers {
  return {
    onRun: jest.fn<() => void>(),
    onSwitch: jest.fn<() => void>(),
    onReset: jest.fn<() => void>(),
  };
}

/*
 * Everything offered to someone who may do everything, nothing running -
 * each case below takes away what it is about.
 */
function makeInput(
  handlers: Handlers,
  overrides: {
    hasTarget?: boolean;
    gate?: PermissionGateResult;
    isRunning?: boolean;
    switchToAgent?: "offered" | "not_offered" | "absent";
    isResetOffered?: boolean;
    isActing?: boolean;
  } = {},
): AiAgentActionsInput {
  const switchToAgent: "offered" | "not_offered" | "absent" =
    overrides.switchToAgent || "offered";

  return {
    testConnection: {
      hasTarget: overrides.hasTarget ?? true,
      gate: overrides.gate || ALLOWED,
      permissionRequirement: REQUIREMENT,
      isRunning: overrides.isRunning ?? false,
      onRun: handlers.onRun,
    },
    switchToAgent:
      switchToAgent === "absent"
        ? undefined
        : {
            isOffered: switchToAgent === "offered",
            onClick: handlers.onSwitch,
          },
    resetAgent: {
      isOffered: overrides.isResetOffered ?? true,
      onClick: handlers.onReset,
    },
    isActing: overrides.isActing ?? false,
  };
}

function ids(actions: Array<AiAgentAction>): Array<AiAgentActionId> {
  return actions.map((action: AiAgentAction): AiAgentActionId => {
    return action.id;
  });
}

function find(
  actions: Array<AiAgentAction>,
  id: AiAgentActionId,
): AiAgentAction | undefined {
  return actions.find((action: AiAgentAction): boolean => {
    return action.id === id;
  });
}

function get(
  actions: Array<AiAgentAction>,
  id: AiAgentActionId,
): AiAgentAction {
  const action: AiAgentAction | undefined = find(actions, id);

  if (!action) {
    throw new Error(`${id} is not offered.`);
  }

  return action;
}

describe("Test connection", () => {
  test("a user who may run it gets it, ready, with the play icon", () => {
    const handlers: Handlers = makeHandlers();
    const testAction: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers)),
      "test_connection",
    );

    expect(testAction).toEqual({
      id: "test_connection",
      text: "Test connection",
      icon: IconProp.Play,
      isDisabled: false,
      disabledReason: undefined,
      dataTestId: AI_AGENT_TEST_CONNECTION_TEST_ID,
      onClick: expect.any(Function),
    });

    testAction.onClick();

    expect(handlers.onRun).toHaveBeenCalledTimes(1);
    expect(handlers.onSwitch).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
  });

  test("a user who may not run it gets it locked, saying which permission it needs", () => {
    const handlers: Handlers = makeHandlers();
    const testAction: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers, { gate: LOCKED })),
      "test_connection",
    );

    expect(testAction.isDisabled).toBe(true);
    // The test's own requirement, not the gate's generic sentence.
    expect(testAction.disabledReason).toBe(REQUIREMENT);
    expect(testAction.disabledReason).not.toBe(LOCKED.disabledReason);

    testAction.onClick();

    expect(handlers.onRun).not.toHaveBeenCalled();
  });

  test("is left out while the permission snapshot has not landed", () => {
    const handlers: Handlers = makeHandlers();

    expect(
      find(
        getAiAgentActions(makeInput(handlers, { gate: UNKNOWN })),
        "test_connection",
      ),
    ).toBeUndefined();
  });

  test("is left out when there is nothing to test, whoever asks", () => {
    for (const gate of [ALLOWED, LOCKED, UNKNOWN]) {
      expect(
        find(
          getAiAgentActions(
            makeInput(makeHandlers(), { hasTarget: false, gate }),
          ),
          "test_connection",
        ),
      ).toBeUndefined();
    }
  });

  test("is locked while a test runs, with no reason to give - it runs once", () => {
    const handlers: Handlers = makeHandlers();
    const testAction: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers, { isRunning: true })),
      "test_connection",
    );

    expect(testAction.isDisabled).toBe(true);
    expect(testAction.disabledReason).toBeUndefined();

    testAction.onClick();

    expect(handlers.onRun).not.toHaveBeenCalled();
  });

  test("a running test does not hide why a locked one is locked", () => {
    const testAction: AiAgentAction = get(
      getAiAgentActions(
        makeInput(makeHandlers(), { isRunning: true, gate: LOCKED }),
      ),
      "test_connection",
    );

    expect(testAction.isDisabled).toBe(true);
    expect(testAction.disabledReason).toBe(REQUIREMENT);
  });

  test("is not held up by a reset or switch in flight", () => {
    const handlers: Handlers = makeHandlers();
    const testAction: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers, { isActing: true })),
      "test_connection",
    );

    expect(testAction.isDisabled).toBe(false);

    testAction.onClick();

    expect(handlers.onRun).toHaveBeenCalledTimes(1);
  });
});

describe("Switch to the AI agent", () => {
  test("is offered when the page offers it, with its own icon", () => {
    const handlers: Handlers = makeHandlers();
    const actions: Array<AiAgentAction> = getAiAgentActions(
      makeInput(handlers),
    );
    const switchAction: AiAgentAction = get(actions, "switch_to_agent");

    expect(switchAction).toEqual({
      id: "switch_to_agent",
      text: "Switch to the AI agent",
      icon: IconProp.ArrowCircleRight,
      isDisabled: false,
      disabledReason: undefined,
      dataTestId: AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
      onClick: expect.any(Function),
    });
    // One above the other in a menu, the two must not look alike.
    expect(switchAction.icon).not.toBe(get(actions, "reset_agent").icon);

    switchAction.onClick();

    expect(handlers.onSwitch).toHaveBeenCalledTimes(1);
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
  });

  test("is left out when the page does not offer it", () => {
    expect(
      find(
        getAiAgentActions(
          makeInput(makeHandlers(), { switchToAgent: "not_offered" }),
        ),
        "switch_to_agent",
      ),
    ).toBeUndefined();
  });

  test("is never offered by a page without it (every resource but a Kubernetes cluster)", () => {
    expect(
      find(
        getAiAgentActions(
          makeInput(makeHandlers(), { switchToAgent: "absent" }),
        ),
        "switch_to_agent",
      ),
    ).toBeUndefined();
  });

  test("is locked while another page action is in flight", () => {
    const handlers: Handlers = makeHandlers();
    const switchAction: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers, { isActing: true })),
      "switch_to_agent",
    );

    expect(switchAction.isDisabled).toBe(true);
    expect(switchAction.disabledReason).toBeUndefined();

    switchAction.onClick();

    expect(handlers.onSwitch).not.toHaveBeenCalled();
  });
});

describe("Reset agent", () => {
  test("is offered when the page offers it, with the refresh icon", () => {
    const handlers: Handlers = makeHandlers();
    const reset: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers)),
      "reset_agent",
    );

    expect(reset).toEqual({
      id: "reset_agent",
      text: "Reset agent",
      icon: IconProp.Refresh,
      isDisabled: false,
      disabledReason: undefined,
      dataTestId: AI_AGENT_RESET_AGENT_TEST_ID,
      onClick: expect.any(Function),
    });

    reset.onClick();

    expect(handlers.onReset).toHaveBeenCalledTimes(1);
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(handlers.onSwitch).not.toHaveBeenCalled();
  });

  test("is left out when the page does not offer it", () => {
    expect(
      find(
        getAiAgentActions(makeInput(makeHandlers(), { isResetOffered: false })),
        "reset_agent",
      ),
    ).toBeUndefined();
  });

  test("is locked while another page action is in flight", () => {
    const handlers: Handlers = makeHandlers();
    const reset: AiAgentAction = get(
      getAiAgentActions(makeInput(handlers, { isActing: true })),
      "reset_agent",
    );

    expect(reset.isDisabled).toBe(true);
    expect(reset.disabledReason).toBeUndefined();

    reset.onClick();

    expect(handlers.onReset).not.toHaveBeenCalled();
  });

  test("is not held up by a running test", () => {
    const reset: AiAgentAction = get(
      getAiAgentActions(makeInput(makeHandlers(), { isRunning: true })),
      "reset_agent",
    );

    expect(reset.isDisabled).toBe(false);
  });
});

describe("the list", () => {
  test("is the test, then the switch, then the reset", () => {
    expect(ids(getAiAgentActions(makeInput(makeHandlers())))).toEqual([
      "test_connection",
      "switch_to_agent",
      "reset_agent",
    ]);
  });

  test("keeps that order with any of them left out", () => {
    expect(
      ids(
        getAiAgentActions(
          makeInput(makeHandlers(), { switchToAgent: "not_offered" }),
        ),
      ),
    ).toEqual(["test_connection", "reset_agent"]);
    expect(
      ids(getAiAgentActions(makeInput(makeHandlers(), { hasTarget: false }))),
    ).toEqual(["switch_to_agent", "reset_agent"]);
    expect(
      ids(
        getAiAgentActions(
          makeInput(makeHandlers(), {
            switchToAgent: "absent",
            isResetOffered: false,
          }),
        ),
      ),
    ).toEqual(["test_connection"]);
  });

  test("is empty when nothing is offered, so the card shows no ⋯", () => {
    expect(
      getAiAgentActions(
        makeInput(makeHandlers(), {
          hasTarget: false,
          switchToAgent: "not_offered",
          isResetOffered: false,
        }),
      ),
    ).toEqual([]);
    expect(
      getAiAgentActions(
        makeInput(makeHandlers(), {
          gate: UNKNOWN,
          switchToAgent: "absent",
          isResetOffered: false,
        }),
      ),
    ).toEqual([]);
  });

  /*
   * The pages a member, a reader and an admin see, by what the pages hand
   * in: what each may do with a connected agent.
   */
  test.each([
    {
      who: "an admin",
      gate: ALLOWED,
      isResetOffered: true,
      expected: ["test_connection", "reset_agent"],
    },
    {
      who: "a member",
      gate: ALLOWED,
      isResetOffered: false,
      expected: ["test_connection"],
    },
    {
      who: "a reader",
      gate: LOCKED,
      isResetOffered: false,
      expected: ["test_connection"],
    },
    {
      who: "someone whose permissions have not loaded",
      gate: UNKNOWN,
      isResetOffered: false,
      expected: [],
    },
  ])(
    "$who gets $expected",
    (row: {
      who: string;
      gate: PermissionGateResult;
      isResetOffered: boolean;
      expected: Array<string>;
    }) => {
      expect(
        ids(
          getAiAgentActions(
            makeInput(makeHandlers(), {
              gate: row.gate,
              isResetOffered: row.isResetOffered,
              switchToAgent: "absent",
            }),
          ),
        ),
      ).toEqual(row.expected);
    },
  );

  test("each action has its own id, test id and icon", () => {
    const actions: Array<AiAgentAction> = getAiAgentActions(
      makeInput(makeHandlers()),
    );

    expect(new Set(ids(actions)).size).toBe(actions.length);
    expect(
      new Set(
        actions.map((action: AiAgentAction): string => {
          return action.dataTestId;
        }),
      ).size,
    ).toBe(actions.length);
    expect(
      new Set(
        actions.map((action: AiAgentAction): IconProp => {
          return action.icon;
        }),
      ).size,
    ).toBe(actions.length);
    for (const action of actions) {
      expect(Object.values(IconProp)).toContain(action.icon);
    }
  });

  test("the test ids are the ones the old header buttons carried", () => {
    expect([
      AI_AGENT_TEST_CONNECTION_TEST_ID,
      AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
      AI_AGENT_RESET_AGENT_TEST_ID,
    ]).toEqual([
      "ai-agent-test-button",
      "ai-agent-switch-button",
      "ai-agent-reset-button",
    ]);
  });

  /*
   * The menu translates each label at run time, so each must be a key of
   * the Dashboard's English locale file - with a translation wherever the
   * old buttons had one.
   */
  test("every label is a translation key, translated where the old buttons were", () => {
    const localesDir: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );
    const english: JSONObject = JSON.parse(
      fs.readFileSync(path.join(localesDir, "en.json"), "utf8"),
    ) as JSONObject;
    const german: JSONObject = JSON.parse(
      fs.readFileSync(path.join(localesDir, "de.json"), "utf8"),
    ) as JSONObject;

    for (const action of getAiAgentActions(makeInput(makeHandlers()))) {
      expect({ text: action.text, english: english[action.text] }).toEqual({
        text: action.text,
        english: action.text,
      });
      expect({
        text: action.text,
        isTranslated:
          typeof german[action.text] === "string" &&
          german[action.text] !== action.text,
      }).toEqual({ text: action.text, isTranslated: true });
    }
  });
});
