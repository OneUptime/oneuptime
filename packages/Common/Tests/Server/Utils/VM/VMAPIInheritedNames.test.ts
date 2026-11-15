jest.mock("../../../../Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ) => {
        return descriptor;
      };
    },
  };
});

import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import { JSONObject } from "../../../../Types/JSON";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ISSUE #8221: A TEMPLATE PATH NAMED LIKE WHAT EVERY OBJECT INHERITS.
 *
 * deepFind walks a {{path}} through the data a template is rendered with -
 * an incident, its monitor, a metric series' labels - and read each segment
 * with a plain read, `current[key] !== undefined`. Every object answers for
 * the names it inherits, so {{constructor}}, {{toString}} or
 * {{seriesLabels.toString}} on a series without that label rendered the
 * function's source ("function Object() { [native code] }") into an
 * incident's title or a notification, and {{__proto__}} the prototype.
 * Each segment is read as the value's own key now: a path the data does
 * not hold is left as written, as any mistyped one is, and a key so named
 * that the data does hold - a series label named "toString" - is read
 * like any other. An array's index and length are its own, so lists read
 * as they did.
 */

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();

afterEach(() => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
});

// The data a template is rendered with, as the server reads it from its JSON.
function data(json: string): JSONObject {
  return JSON.parse(json) as JSONObject;
}

const INCIDENT: JSONObject = data(
  JSON.stringify({
    incident: {
      title: "API latency",
      count: 3,
      seriesLabels: { region: "eu" },
      monitors: [{ name: "Checkout" }, { name: "Search" }],
    },
  }),
);

function render(storage: JSONObject, template: string): string {
  return VMUtil.replaceValueInPlace(storage, template, false);
}

describe("deepFind and a path named like what every object inherits", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "{{%s}} on data that does not hold it finds nothing, at the top and under a key",
    (name: string) => {
      expect(VMUtil.deepFind(INCIDENT, name)).toBeUndefined();
      expect(VMUtil.deepFind(INCIDENT, `incident.${name}`)).toBeUndefined();
      expect(
        VMUtil.deepFind(INCIDENT, `incident.seriesLabels.${name}`),
      ).toBeUndefined();
      // Nor through what was found: an inherited name is no step to anything.
      expect(VMUtil.deepFind(INCIDENT, `${name}.name`)).toBeUndefined();
      expect(
        VMUtil.deepFind(INCIDENT, `incident.title.${name}`),
      ).toBeUndefined();
      expect(
        VMUtil.deepFind(INCIDENT, `incident.count.${name}`),
      ).toBeUndefined();
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a series label named %s that the data holds is read like any other",
    (name: string) => {
      const storage: JSONObject = data(
        `{"incident":{"seriesLabels":{${JSON.stringify(name)}:"the label's value"}}}`,
      );

      expect(VMUtil.deepFind(storage, `incident.seriesLabels.${name}`)).toBe(
        "the label's value",
      );
      expect(render(storage, `Series {{incident.seriesLabels.${name}}}`)).toBe(
        "Series the label's value",
      );
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a template naming {{%s}} keeps the placeholder as written, never a function's source",
    (name: string) => {
      const titled: string = render(
        INCIDENT,
        `{{incident.title}}: {{${name}}} / {{incident.seriesLabels.${name}}}`,
      );

      expect(titled).toBe(
        `API latency: {{${name}}} / {{incident.seriesLabels.${name}}}`,
      );
      expect(titled).not.toContain("native code");
      expect(titled).not.toContain("[object Object]");
    },
  );

  test("the issue's cases: {{constructor}}, {{toString}} and {{seriesLabels.toString}} render nothing of a function", () => {
    for (const template of [
      "{{constructor}}",
      "{{toString}}",
      "{{incident.seriesLabels.toString}}",
      "Down: {{constructor}}",
    ]) {
      const rendered: string = render(INCIDENT, template);

      expect({ template, rendered }).toEqual({ template, rendered: template });
    }
  });

  test.each(INHERITED_PROPERTY_NAMES)(
    "a list read by a key named %s is no list, and throws nothing",
    (name: string) => {
      expect(VMUtil.deepFind(INCIDENT, `${name}[0]`)).toBeUndefined();
      expect(VMUtil.deepFind(INCIDENT, `${name}[last]`)).toBeUndefined();
      expect(VMUtil.deepFind(INCIDENT, `incident.${name}[0]`)).toBeUndefined();
    },
  );

  test("a list's index, its last item and its length are still the list's own", () => {
    expect(VMUtil.deepFind(INCIDENT, "incident.monitors[0].name")).toBe(
      "Checkout",
    );
    expect(VMUtil.deepFind(INCIDENT, "incident.monitors[last].name")).toBe(
      "Search",
    );
    expect(VMUtil.deepFind(INCIDENT, "incident.monitors.length")).toBe(2);
    expect(VMUtil.deepFind(INCIDENT, "incident.monitors.1.name")).toBe(
      "Search",
    );
    expect(VMUtil.deepFind(INCIDENT, "incident.title.length")).toBe(11);
    expect(render(INCIDENT, "{{incident.monitors[last].name}}")).toBe("Search");
  });

  test("a key with a dot of its own is still found, and one named like an inherited name too", () => {
    const storage: JSONObject = data(
      '{"customFields":{"Release 1.2":"blue","toString.x":"green"}}',
    );

    expect(VMUtil.deepFind(storage, "customFields.Release 1.2")).toBe("blue");
    expect(VMUtil.deepFind(storage, "customFields.toString.x")).toBe("green");
  });

  test("a path through __proto__ never reaches the prototype every object shares", () => {
    expect(VMUtil.deepFind(INCIDENT, "__proto__")).toBeUndefined();
    expect(
      VMUtil.deepFind(INCIDENT, "__proto__.hasOwnProperty"),
    ).toBeUndefined();
    expect(VMUtil.deepFind(INCIDENT, "incident.__proto__")).toBeUndefined();

    const own: JSONObject = data('{"labels":{"__proto__":"eu-1"}}');

    expect(VMUtil.deepFind(own, "labels.__proto__")).toBe("eu-1");
    expect(render(own, "Region {{labels.__proto__}}")).toBe("Region eu-1");
  });
});

describe("runsIntoNothing and a path named like what every object inherits", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a path through %s runs into nothing only where the data itself is empty",
    (name: string) => {
      expect(VMUtil.runsIntoNothing(INCIDENT, `${name}.x`)).toBe(false);
      expect(VMUtil.runsIntoNothing(INCIDENT, `${name}.${name}.x`)).toBe(false);
      expect(VMUtil.runsIntoNothing(INCIDENT, `incident.${name}[0]`)).toBe(
        false,
      );

      const empty: JSONObject = data(
        `{"alert":{${JSON.stringify(name)}:null}}`,
      );

      expect(VMUtil.runsIntoNothing(empty, `alert.${name}.name`)).toBe(true);
    },
  );

  test("__proto__.__proto__ is not the prototype's null: an empty-value template leaves it as written", () => {
    // Object.prototype's own prototype is null, which a plain read reached.
    expect(VMUtil.runsIntoNothing(INCIDENT, "__proto__.__proto__.x")).toBe(
      false,
    );

    let emptied: Array<string> = [];

    expect(
      VMUtil.replaceValueInPlace(
        INCIDENT,
        "Owner: {{__proto__.__proto__.name}}",
        false,
        {
          onEmptyValue: (path: string): void => {
            emptied = [...emptied, path];
          },
        },
      ),
    ).toBe("Owner: {{__proto__.__proto__.name}}");
    expect(emptied).toEqual([]);
  });
});
