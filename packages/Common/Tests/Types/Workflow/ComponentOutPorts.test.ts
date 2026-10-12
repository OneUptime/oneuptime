/*
 * A step's outputs as it is set up now (Types/Workflow/ComponentOutPorts).
 *
 * Every step but one has the outputs its metadata lists, whatever its
 * settings say. A Switch / Case has one per case and Default, so everything
 * that asks what a step's outputs are - the canvas, the settings, the graph
 * checks, the builder dropping a removed case's connection, the runner naming
 * the output a run took - asks here. These hold that the one place answers
 * the same for every step it does not know about as metadata.outPorts did,
 * and from the settings for a Switch / Case.
 */

import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, { Port } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import {
  getComponentOutPorts,
  getNewStepArguments,
  hasOutPortsFromSettings,
  isOutPortFromSettings,
} from "../../../Types/Workflow/ComponentOutPorts";
import {
  SWITCH_DEFAULT_PORT,
  SWITCH_DEFAULT_PORT_ID,
} from "../../../Types/Workflow/Components/Switch";
import {
  getStarterSwitchCases,
  readSwitchCases,
  toStoredSwitchCases,
} from "../../../Types/Workflow/Components/SwitchCases";
import { describe, expect, test } from "@jest/globals";

type MetadataFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: ComponentID): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  }) as ComponentMetadata;
};

const SWITCH: ComponentMetadata = metadataOf(ComponentID.Switch);

type IdsFunction = (ports: Array<Port>) => Array<string>;

const ids: IdsFunction = (ports: Array<Port>): Array<string> => {
  return ports.map((port: Port): string => {
    return port.id;
  });
};

describe("a step's outputs", () => {
  test("every step but Switch / Case has exactly its metadata's outputs, whatever its settings say", () => {
    const settings: Array<JSONObject | undefined | null> = [
      undefined,
      null,
      {},
      { cases: toStoredSwitchCases(getStarterSwitchCases()) },
      { value: "x", operator: "==" },
    ];

    let checked: number = 0;

    for (const metadata of Components) {
      if (metadata.id === ComponentID.Switch) {
        continue;
      }

      for (const args of settings) {
        expect({
          step: metadata.id,
          ports: getComponentOutPorts({ metadata: metadata, arguments: args }),
        }).toEqual({ step: metadata.id, ports: metadata.outPorts });
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(50);
  });

  test("a Switch / Case has one output per case, in order, then Default", () => {
    const ports: Array<Port> = getComponentOutPorts({
      metadata: SWITCH,
      arguments: {
        cases: [
          { id: "case-3", comparison: "==", value: "a", compareAs: "text" },
          { id: "case-1", comparison: "==", value: "b", compareAs: "text" },
        ],
      },
    });

    expect(ids(ports)).toEqual(["case-3", "case-1", SWITCH_DEFAULT_PORT_ID]);
    expect(
      ports.map((port: Port): string => {
        return port.title;
      }),
    ).toEqual(["a", "b", "Default"]);
  });

  test("a Switch / Case with no settings yet has Default alone", () => {
    expect(
      getComponentOutPorts({ metadata: SWITCH, arguments: undefined }),
    ).toEqual([SWITCH_DEFAULT_PORT]);
  });

  test("its outputs follow its cases as they are added, renamed, moved and removed", () => {
    const outputsOf: (cases: Array<JSONObject>) => Array<string> = (
      cases: Array<JSONObject>,
    ): Array<string> => {
      return getComponentOutPorts({
        metadata: SWITCH,
        arguments: { cases: cases },
      }).map((port: Port): string => {
        return `${port.id}:${port.title}`;
      });
    };

    const first: JSONObject = { id: "case-1", comparison: "==", value: "a" };
    const second: JSONObject = { id: "case-2", comparison: "==", value: "b" };

    expect(outputsOf([first])).toEqual(["case-1:a", "default:Default"]);
    // Added.
    expect(outputsOf([first, second])).toEqual([
      "case-1:a",
      "case-2:b",
      "default:Default",
    ]);
    // Renamed: the id, and so a connection, stays.
    expect(outputsOf([{ ...first, value: "renamed" }, second])).toEqual([
      "case-1:renamed",
      "case-2:b",
      "default:Default",
    ]);
    // Moved.
    expect(outputsOf([second, first])).toEqual([
      "case-2:b",
      "case-1:a",
      "default:Default",
    ]);
    // Removed.
    expect(outputsOf([second])).toEqual(["case-2:b", "default:Default"]);
  });

  test("a step with no metadata has no outputs", () => {
    expect(getComponentOutPorts({ metadata: undefined })).toEqual([]);
    expect(getComponentOutPorts({ metadata: null })).toEqual([]);
  });

  test("a placeholder's partial metadata, with no outputs, has none", () => {
    expect(
      getComponentOutPorts({
        metadata: { title: "Trigger" } as unknown as ComponentMetadata,
      }),
    ).toEqual([]);
  });
});

describe("which steps' outputs come from their settings", () => {
  test("Switch / Case's do, and no other step's", () => {
    expect(hasOutPortsFromSettings(ComponentID.Switch)).toBe(true);

    for (const metadata of Components) {
      expect({
        step: metadata.id,
        fromSettings: hasOutPortsFromSettings(metadata.id),
      }).toEqual({
        step: metadata.id,
        fromSettings: metadata.id === ComponentID.Switch,
      });
    }

    expect(hasOutPortsFromSettings(undefined)).toBe(false);
    expect(hasOutPortsFromSettings(null)).toBe(false);
    expect(hasOutPortsFromSettings("")).toBe(false);
  });

  test("a case's output is the person's own words; Default is not", () => {
    expect(isOutPortFromSettings({ metadata: SWITCH, portId: "case-1" })).toBe(
      true,
    );
    expect(
      isOutPortFromSettings({ metadata: SWITCH, portId: "anything-else" }),
    ).toBe(true);
    expect(
      isOutPortFromSettings({
        metadata: SWITCH,
        portId: SWITCH_DEFAULT_PORT_ID,
      }),
    ).toBe(false);

    const ifElse: ComponentMetadata = metadataOf(ComponentID.IfElse);

    expect(isOutPortFromSettings({ metadata: ifElse, portId: "yes" })).toBe(
      false,
    );
    expect(isOutPortFromSettings({ metadata: ifElse, portId: "maybe" })).toBe(
      false,
    );
    expect(isOutPortFromSettings({ metadata: undefined, portId: "x" })).toBe(
      false,
    );
  });
});

describe("the settings a new step starts with", () => {
  test("a new Switch / Case starts with two cases, so its outputs are there to connect", () => {
    const args: JSONObject | null = getNewStepArguments(ComponentID.Switch);

    expect(args).not.toBeNull();
    expect(readSwitchCases(args?.["cases"])).toEqual(getStarterSwitchCases());
    expect(
      ids(getComponentOutPorts({ metadata: SWITCH, arguments: args })),
    ).toEqual(["case-1", "case-2", SWITCH_DEFAULT_PORT_ID]);
  });

  test("each new Switch / Case gets its own copy", () => {
    const first: JSONObject | null = getNewStepArguments(ComponentID.Switch);
    const second: JSONObject | null = getNewStepArguments(ComponentID.Switch);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first?.["cases"]).not.toBe(second?.["cases"]);
  });

  test("every other step starts with nothing", () => {
    for (const metadata of Components) {
      if (metadata.id === ComponentID.Switch) {
        continue;
      }

      expect({
        step: metadata.id,
        args: getNewStepArguments(metadata.id),
      }).toEqual({ step: metadata.id, args: null });
    }

    expect(getNewStepArguments("incident-create-one")).toBeNull();
    expect(getNewStepArguments(undefined)).toBeNull();
  });
});
