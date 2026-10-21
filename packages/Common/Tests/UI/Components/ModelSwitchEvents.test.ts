import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  announceModelSwitchSaved,
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
  subscribeToModelSwitchSaved,
} from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";

/*
 * One column of one record saved from two places on a screen (a monitor's
 * Monitoring switch and its banner's "Turn monitoring on" button): each
 * announces what it saved, and each hears only saves of that very column of
 * that very record, made somewhere else.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "7c7c7c7c-0000-4000-8000-0000000000aa",
);
const OTHER_ID: ObjectID = new ObjectID("7c7c7c7c-0000-4000-8000-0000000000bb");

const unsubscribes: Array<() => void> = [];

afterEach(() => {
  while (unsubscribes.length > 0) {
    unsubscribes.pop()!();
  }
  jest.restoreAllMocks();
});

function listen(source?: string): MockFunction {
  const onSaved: MockFunction = getJestMockFunction();

  unsubscribes.push(
    subscribeToModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      source,
      onSaved: (value: boolean): void => {
        onSaved(value);
      },
    }),
  );

  return onSaved;
}

describe("ModelSwitchEvents", () => {
  test("a save is heard with what the column now stores", () => {
    const onSaved: MockFunction = listen();

    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      value: false,
    });

    expect(onSaved.mock.calls).toEqual([[false]]);
  });

  test("it is a window event carrying the table, id, column, value and source", () => {
    const details: Array<ModelSwitchSaved> = [];
    const listener: (event: Event) => void = (event: Event): void => {
      details.push((event as CustomEvent).detail as ModelSwitchSaved);
    };
    window.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

    try {
      announceModelSwitchSaved({
        modelType: Monitor,
        modelId: MONITOR_ID,
        column: "disableActiveMonitoring",
        value: true,
        source: "settings-switch",
      });
    } finally {
      window.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
    }

    expect(details).toEqual([
      {
        tableName: "Monitor",
        modelId: MONITOR_ID.toString(),
        column: "disableActiveMonitoring",
        value: true,
        source: "settings-switch",
      },
    ]);
  });

  test("another record, column or table is not heard", () => {
    const onSaved: MockFunction = listen();

    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: OTHER_ID,
      column: "disableActiveMonitoring",
      value: false,
    });
    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "isArchived",
      value: false,
    });
    announceModelSwitchSaved({
      modelType: StatusPage,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      value: false,
    });

    expect(onSaved).not.toHaveBeenCalled();
  });

  test("a place does not hear its own save, and hears everyone else's", () => {
    const onSaved: MockFunction = listen("the-switch");

    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      value: true,
      source: "the-switch",
    });
    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      value: false,
      source: "the-banner",
    });
    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      value: true,
    });

    expect(onSaved.mock.calls).toEqual([[false], [true]]);
  });

  test("an event without a boolean value is ignored", () => {
    const onSaved: MockFunction = listen();

    window.dispatchEvent(
      new CustomEvent(MODEL_SWITCH_SAVED_EVENT, {
        detail: {
          tableName: "Monitor",
          modelId: MONITOR_ID.toString(),
          column: "disableActiveMonitoring",
          value: "false",
        },
      }),
    );
    window.dispatchEvent(new CustomEvent(MODEL_SWITCH_SAVED_EVENT));

    expect(onSaved).not.toHaveBeenCalled();
  });

  test("after unsubscribing nothing is heard", () => {
    const onSaved: MockFunction = getJestMockFunction();

    const unsubscribe: () => void = subscribeToModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      onSaved: (value: boolean): void => {
        onSaved(value);
      },
    });
    unsubscribe();

    announceModelSwitchSaved({
      modelType: Monitor,
      modelId: MONITOR_ID,
      column: "disableActiveMonitoring",
      value: false,
    });

    expect(onSaved).not.toHaveBeenCalled();
  });
});
