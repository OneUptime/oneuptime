/*
 * VMUtil.replaceValueInPlace asked to tell a value with nothing in it from a
 * reference to nothing at all: what a workflow's settings ask for
 * (Types/Workflow/EmptyValues, issue 5761).
 *
 * An alert raised by an SLO has no monitor, so a Slack message's
 * {{...model.monitor.name}} went out as written, braces and all, and the rest
 * of the message read fine. And a description nobody wrote went out as the word
 * "null". What must stay true:
 *
 *   - a reference to something that is not there is still left as written, so
 *     a mistyped name shows;
 *   - a value that is there is never changed, wherever it is found;
 *   - every other caller of the function sees no change at all.
 */

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
        _target: any,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ) => {
        return descriptor;
      };
    },
  };
});

import VMUtil, { EmptyValueOptions } from "../../../../Server/Utils/VM/VMAPI";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { describe, expect, jest, test } from "@jest/globals";

const WITH_EMPTY_VALUES: EmptyValueOptions = {};

type RenderFunction = (
  storage: JSONObject,
  template: unknown,
  isJSON?: boolean,
  options?: EmptyValueOptions,
) => any;

const render: RenderFunction = (
  storage: JSONObject,
  template: unknown,
  isJSON: boolean = false,
  options: EmptyValueOptions = WITH_EMPTY_VALUES,
): any => {
  return VMUtil.replaceValueInPlace(
    storage,
    template as string,
    isJSON,
    options,
  );
};

const renderAsEverywhereElse: RenderFunction = (
  storage: JSONObject,
  template: unknown,
  isJSON: boolean = false,
): any => {
  return VMUtil.replaceValueInPlace(storage, template as string, isJSON);
};

const ALERT_REFERENCE: string =
  "{{local.components.alert-on-create-1.returnValues.model.monitor.name}}";

const alertStorage: (model: JSONValue) => JSONObject = (
  model: JSONValue,
): JSONObject => {
  return {
    local: {
      variables: {},
      components: {
        "alert-on-create-1": { returnValues: { model: model } },
      },
    },
    global: { variables: {} },
  };
};

describe("the message issue 5761 reported", () => {
  const MESSAGE: string = `:warning: New Alert ALT-9\n*Severity:* {{local.components.alert-on-create-1.returnValues.model.alertSeverity.name}}\n*Monitor:* ${ALERT_REFERENCE}\n*Summary:* {{local.components.alert-on-create-1.returnValues.model.title}}`;

  test("an alert no monitor raised has an empty monitor, and the message reads", () => {
    expect(
      render(
        alertStorage({
          title: "SLO burn rate: Overall Calendar Month — Slow burn",
          alertSeverity: { name: "High" },
          monitor: null,
        }),
        MESSAGE,
      ),
    ).toBe(
      ":warning: New Alert ALT-9\n*Severity:* High\n*Monitor:* \n*Summary:* SLO burn rate: Overall Calendar Month — Slow burn",
    );
  });

  test("an alert a monitor raised names the monitor", () => {
    expect(
      render(
        alertStorage({
          title: "Latency high",
          alertSeverity: { name: "High" },
          monitor: { _id: "m-1", name: "Checkout API" },
        }),
        MESSAGE,
      ),
    ).toBe(
      ":warning: New Alert ALT-9\n*Severity:* High\n*Monitor:* Checkout API\n*Summary:* Latency high",
    );
  });

  test("no braces reach the message, whichever field has nothing in it", () => {
    const text: string = render(
      alertStorage({ title: null, alertSeverity: null, monitor: null }),
      MESSAGE,
    );

    expect(text).not.toContain("{{");
    expect(text).not.toContain("null");
  });
});

describe("a value with nothing in it, in text", () => {
  test("a field holding null is nothing, never the word null", () => {
    expect(
      render(
        { alert: { description: null } },
        "Details: {{alert.description}}.",
      ),
    ).toBe("Details: .");
  });

  test("a field of a related record the record does not have is nothing", () => {
    expect(
      render({ alert: { monitor: null } }, "[{{alert.monitor.name}}]"),
    ).toBe("[]");
  });

  test("however deep the path goes past the null", () => {
    expect(render({ a: { b: null } }, "[{{a.b.c.d.e.f}}]")).toBe("[]");
  });

  test("the record of a Find One that found none is nothing", () => {
    expect(
      render(
        { local: { components: { find: { returnValues: { model: null } } } } },
        "Owner: {{local.components.find.returnValues.model.name}}",
      ),
    ).toBe("Owner: ");
  });

  test("each of several, and the values beside them", () => {
    expect(
      render(
        { a: null, b: { c: null }, d: "kept" },
        "{{a.x}}|{{b.c.y}}|{{d}}|{{b.c}}",
      ),
    ).toBe("||kept|");
  });

  test("a whole setting that is one such reference is null, like any null", () => {
    expect(render({ a: null }, "{{a.b}}")).toBeNull();
    expect(render({ a: null }, "{{a}}")).toBeNull();
    expect(render({ a: null }, "  {{a.b}}  ")).toBeNull();
  });
});

describe("a list that does not hold the item", () => {
  test.each([
    ["the first of none", { items: [] }, "items[0].name"],
    ["the last of none", { items: [] }, "items[last].name"],
    ["past the end", { items: [{ name: "a" }] }, "items[5].name"],
    ["a list that is null", { items: null }, "items[0].name"],
    ["the last of a null list", { items: null }, "items[last]"],
    ["an item that is null", { items: [null] }, "items[0].name"],
    ["an item that is null, read whole", { items: [null] }, "items[0]"],
  ])("%s is nothing", (_name: string, storage: JSONObject, path: string) => {
    expect(render(storage, `[{{${path}}}]`)).toBe("[]");
  });

  test("an item that is there is read", () => {
    const storage: JSONObject = { items: [{ name: "a" }, { name: "b" }] };

    expect(render(storage, "{{items[0].name}}{{items[last].name}}")).toBe("ab");
  });

  test.each([
    ["not a list", { items: "text" }, "items[0]"],
    ["not there", {}, "items[0]"],
    ["an index that is not one", { items: [1] }, "items[first]"],
    ["an index below the list", { items: [1] }, "items[-1]"],
  ])(
    "%s is left as written",
    (_name: string, storage: JSONObject, path: string) => {
      expect(render(storage, `[{{${path}}}]`)).toBe(`[{{${path}}}]`);
    },
  );
});

describe("a reference to something that is not there is still left as written", () => {
  test.each([
    ["a mistyped root", "local.componets.x.returnValues.model.title"],
    ["a step that did not run", "local.components.y.returnValues.model.title"],
    ["a return value it does not have", "local.components.x.returnValues.nope"],
    [
      "a key the record does not hold",
      "local.components.x.returnValues.model.nope",
    ],
    [
      "a key under a key it does not hold",
      "local.components.x.returnValues.model.nope.name",
    ],
    [
      "a key of a value that is not an object",
      "local.components.x.returnValues.model.title.nope",
    ],
    ["an empty part", "local..components"],
  ])("%s", (_name: string, path: string) => {
    const storage: JSONObject = {
      local: {
        components: {
          x: { returnValues: { model: { title: "t", monitor: null } } },
        },
      },
    };

    expect(render(storage, `a {{${path}}} b`)).toBe(`a {{${path}}} b`);
    expect(render(storage, `{{${path}}}`)).toBe(`{{${path}}}`);
  });

  test("a reference with a space in it, as written", () => {
    expect(render({ a: null }, "{{ a.b }}")).toBe("{{ a.b }}");
  });
});

describe("a value that is there is never changed", () => {
  test.each([
    ["zero", 0, "0"],
    ["false", false, "false"],
    ["empty text", "", ""],
    ["the word null", "null", "null"],
    ["text", "x", "x"],
    ["braces", "{{y}}", "{{y}}"],
  ])("%s, in text", (_name: string, value: JSONValue, expected: string) => {
    expect(render({ a: { b: value } }, "[{{a.b}}]")).toBe(`[${expected}]`);
  });

  test("an object is indented JSON, as it was", () => {
    expect(render({ a: { b: 1 } }, "x {{a}}")).toBe(
      `x ${JSON.stringify({ b: 1 }, null, 2)}`,
    );
  });

  test("a value holding {{...}} is not read again", () => {
    expect(
      render({ a: { b: "{{c.d}}" }, c: null }, "{{a.b}} and {{c.d}}"),
    ).toBe("{{c.d}} and ");
  });

  /*
   * Asked with the options and without, a template that meets no empty value
   * comes out the same: nothing else about the function changed for workflows.
   */
  test("a template with no empty value in it renders as it does without the options", () => {
    const storage: JSONObject = {
      name: "Checkout",
      count: 0,
      yes: true,
      nested: { deep: { text: 'quote " and $& and {{x}}' } },
      items: [{ name: "first" }, { name: "second" }],
      plain: ["p", "q"],
    };

    const texts: Array<string> = generatedTexts(4000, 5761, [
      "{{name}}",
      "{{count}}",
      "{{yes}}",
      "{{nested.deep.text}}",
      "{{nested}}",
      "{{items[0].name}}",
      "{{items[last].name}}",
      "{{notThere}}",
      "{{not.there}}",
      "{{#each items}}{{name}}{{@index}}{{/each}}",
      "{{#each plain}}{{this}}{{/each}}",
      "{{#each notThere}}x{{/each}}",
      "{{",
      "}}",
      "text ",
      "\n",
      '"',
    ]);

    for (const text of texts) {
      expect(render(storage, text)).toBe(renderAsEverywhereElse(storage, text));
    }
  });
});

describe("in a JSON document", () => {
  test("inside a string it is empty text, and the string stays one", () => {
    expect(
      JSON.parse(render({ a: null }, '{"monitor": "{{a.name}}"}', true)),
    ).toEqual({ monitor: "" });
  });

  test("inside a string with text around it", () => {
    expect(
      JSON.parse(render({ a: null }, '{"text": "Monitor: {{a.name}}."}', true)),
    ).toEqual({ text: "Monitor: ." });
  });

  test("on its own it is null, where the template used to be invalid JSON", () => {
    expect(
      JSON.parse(render({ a: null }, '{"monitor": {{a.name}}}', true)),
    ).toEqual({ monitor: null });
    expect(() => {
      return JSON.parse(
        renderAsEverywhereElse({ a: null }, '{"monitor": {{a.name}}}', true),
      );
    }).toThrow();
  });

  test("a field holding null, both ways", () => {
    expect(
      JSON.parse(
        render(
          { a: { b: null } },
          '{"quoted": "{{a.b}}", "own": {{a.b}}}',
          true,
        ),
      ),
    ).toEqual({ quoted: "", own: null });
  });

  test("in a list, and beside values that are there", () => {
    expect(
      JSON.parse(
        render(
          { a: null, n: 5, o: { x: 1 } },
          '[{{a.b}}, {{n}}, {{o}}, "{{a.b}}-{{n}}"]',
          true,
        ),
      ),
    ).toEqual([null, 5, { x: 1 }, "-5"]);
  });

  test("a setting kept as an object stays one", () => {
    expect(
      render(
        { a: null, b: { c: 'say "hi"' } },
        {
          "X-Monitor": "{{a.name}}",
          "X-Note": "{{b.c}}",
          list: ["{{a.name}}"],
        },
      ),
    ).toEqual({ "X-Monitor": "", "X-Note": 'say "hi"', list: [""] });
  });

  test("a reference to nothing is still left as written, in the string", () => {
    expect(JSON.parse(render({}, '{"monitor": "{{a.name}}"}', true))).toEqual({
      monitor: "{{a.name}}",
    });
  });

  test("a value with a quote is still escaped beside an empty one", () => {
    expect(
      JSON.parse(
        render({ a: null, q: 'a "b"\nc' }, '{"t": "{{a.x}} {{q}}"}', true),
      ),
    ).toEqual({ t: ' a "b"\nc' });
  });
});

describe("in an {{#each}} loop", () => {
  const LOOP_STORAGE: JSONObject = {
    alerts: [
      { title: "a", monitor: { name: "m" } },
      { title: "b", monitor: null },
      { title: null, monitor: null },
    ],
  };

  test("a field of an element that has nothing there is nothing", () => {
    expect(
      render(
        LOOP_STORAGE,
        "{{#each alerts}}{{title}}:{{monitor.name}};{{/each}}",
      ),
    ).toBe("a:m;b:;:;");
  });

  test("a value further out is found before an empty one nearer in", () => {
    expect(
      render(
        { owner: { name: "outer" }, items: [{ owner: null }] },
        "{{#each items}}{{owner.name}}{{/each}}",
      ),
    ).toBe("outer");
  });

  test("a name no scope holds is left as written", () => {
    expect(render(LOOP_STORAGE, "{{#each alerts}}{{nope}}{{/each}}")).toBe(
      "{{nope}}{{nope}}{{nope}}",
    );
  });

  test("{{this}} of a null is nothing", () => {
    expect(
      render({ items: ["a", null, "b"] }, "{{#each items}}[{{this}}]{{/each}}"),
    ).toBe("[a][][b]");
  });

  test("a loop over a list a record does not have renders nothing", () => {
    expect(render({ a: null }, "x{{#each a.items}}{{name}}{{/each}}y")).toBe(
      "xy",
    );
  });

  test("in a JSON document, each element's own way", () => {
    expect(
      JSON.parse(
        render(
          LOOP_STORAGE,
          '[{{#each alerts}}{"t": "{{monitor.name}}", "m": {{monitor}}},{{/each}}null]',
          true,
        ),
      ),
    ).toEqual([
      { t: "m", m: { name: "m" } },
      { t: "", m: null },
      { t: "", m: null },
      null,
    ]);
  });
});

describe("what the caller is asked and told", () => {
  test("isEmptyPath decides a path that ran into nothing on its way", () => {
    const asked: Array<string> = [];

    expect(
      render(
        { model: { title: "t" } },
        "{{model.monitor.name}}|{{model.nope}}",
        false,
        {
          isEmptyPath: (path: string): boolean => {
            asked.push(path);
            return path === "model.monitor.name";
          },
        },
      ),
    ).toBe("|{{model.nope}}");
    expect(asked).toEqual(["model.monitor.name", "model.nope"]);
  });

  test("isEmptyPath is not asked about a value that is there", () => {
    const isEmptyPath: jest.Mock = jest.fn();

    render({ a: 1, b: null, c: null }, "{{a}} {{b}} {{c.d}}", false, {
      isEmptyPath: isEmptyPath as never,
    });

    expect(isEmptyPath).not.toHaveBeenCalled();
  });

  test("a whole setting isEmptyPath says is empty is null", () => {
    expect(
      render({ model: {} }, "{{model.monitor.name}}", false, {
        isEmptyPath: (): boolean => {
          return true;
        },
      }),
    ).toBeNull();
  });

  test("onEmptyValue is told each reference that came through empty, by its path", () => {
    const told: Array<string> = [];

    render(
      { a: null, b: { c: null }, d: "kept" },
      "{{a.x}} {{b.c}} {{d}} {{e}} {{a.x}}",
      false,
      {
        onEmptyValue: (path: string): void => {
          told.push(path);
        },
      },
    );

    expect(told).toEqual(["a.x", "b.c", "a.x"]);
  });

  test("onEmptyValue is told once for a whole setting", () => {
    const told: Array<string> = [];

    render({ a: null }, "{{a.x}}", false, {
      onEmptyValue: (path: string): void => {
        told.push(path);
      },
    });

    expect(told).toEqual(["a.x"]);
  });

  test("onEmptyValue is told of a name in a loop, trimmed as a loop reads it", () => {
    const told: Array<string> = [];

    render(
      { items: [{ owner: null }] },
      "{{#each items}}{{ owner.name }}{{/each}}",
      false,
      {
        onEmptyValue: (path: string): void => {
          told.push(path);
        },
      },
    );

    expect(told).toEqual(["owner.name"]);
  });

  test("a reference left as written tells it nothing", () => {
    const told: Array<string> = [];

    render({}, "{{a.x}}", false, {
      onEmptyValue: (path: string): void => {
        told.push(path);
      },
    });

    expect(told).toEqual([]);
  });
});

/*
 * Every other caller - incident and alert templates, a schedule - asks without
 * the options. A placeholder with no value stays as written there, and so does
 * the word null: TemplateMissingValueClaims and the template docs say so.
 */
describe("without the options nothing changes", () => {
  test("a path through a null is left as written", () => {
    expect(renderAsEverywhereElse({ a: null }, "[{{a.b}}]")).toBe("[{{a.b}}]");
  });

  test("a whole template through a null is left as written", () => {
    expect(renderAsEverywhereElse({ a: null }, "{{a.b}}")).toBe("{{a.b}}");
  });

  test("a field holding null is the word null", () => {
    expect(renderAsEverywhereElse({ a: null }, "[{{a}}]")).toBe("[null]");
  });

  test("a whole template that is a null is null", () => {
    expect(renderAsEverywhereElse({ a: null }, "{{a}}")).toBeNull();
  });

  test("past the end of a list is left as written", () => {
    expect(renderAsEverywhereElse({ a: [] }, "[{{a[0].b}}]")).toBe(
      "[{{a[0].b}}]",
    );
  });

  test("inside a JSON string, the word null", () => {
    expect(
      JSON.parse(renderAsEverywhereElse({ a: null }, '{"x": "{{a}}"}', true)),
    ).toEqual({ x: "null" });
  });

  test("in a loop", () => {
    expect(
      renderAsEverywhereElse(
        { items: [{ owner: null }, null] },
        "{{#each items}}[{{owner.name}}{{this}}]{{/each}}",
      ),
    ).toBe("[{{owner.name}}{{this}}][{{owner.name}}null]");
  });

  test("expandEachLoops writes as it did", () => {
    expect(
      VMUtil.expandEachLoops(
        { items: [{ owner: null }] },
        "{{#each items}}{{owner}}|{{owner.name}}{{/each}}",
        false,
      ),
    ).toBe("null|{{owner.name}}");
  });
});

describe("runsIntoNothing", () => {
  test.each([
    ["a null on the way", { a: null }, "a.b", true],
    ["a null deeper on the way", { a: { b: null } }, "a.b.c.d", true],
    ["a list that is null", { a: null }, "a[0]", true],
    ["the first of none", { a: [] }, "a[0]", true],
    ["the last of none", { a: [] }, "a[last]", true],
    ["past the end", { a: [1] }, "a[1]", true],
    ["an item that is null", { a: [null] }, "a[0]", true],
    ["on past an item that is null", { a: [null] }, "a[0].b", true],
    ["a null at the end", { a: null }, "a", true],
    ["a value", { a: { b: 1 } }, "a.b", false],
    ["a key that is not there", { a: {} }, "a.b", false],
    ["on past a key that is not there", { a: {} }, "a.b.c", false],
    ["no root", {}, "a.b", false],
    ["on past a number", { a: 1 }, "a.b", false],
    ["on past text", { a: "t" }, "a.b", false],
    ["on past false", { a: false }, "a.b", false],
    ["an index on what is not a list", { a: {} }, "a[0]", false],
    ["an index on what is not there", {}, "a[0]", false],
    ["an index that is not a number", { a: [1] }, "a[x]", false],
    ["an index below zero", { a: [1] }, "a[-1]", false],
    ["an item that is there", { a: [1] }, "a[0]", false],
    ["an empty path", { a: null }, "", false],
    // Written wrongly, whatever it would have read: left to show.
    ["an empty part", { a: null }, "a..b", false],
    ["an empty part first", { a: null }, ".a", false],
  ])(
    "%s",
    (_name: string, obj: JSONObject, path: string, expected: boolean) => {
      expect(VMUtil.runsIntoNothing(obj, path)).toBe(expected);
    },
  );

  test("leaves what it reads as it was", () => {
    const obj: JSONObject = { a: { b: null }, c: [] };
    const copy: JSONObject = JSON.parse(JSON.stringify(obj));

    VMUtil.runsIntoNothing(obj, "a.b.c");
    VMUtil.runsIntoNothing(obj, "c[0]");

    expect(obj).toEqual(copy);
  });

  // What a reference reads can be megabytes long: it is walked, never parsed.
  test("reads a path megabytes long in one pass", () => {
    const longPath: string = `a.${"x".repeat(4 * 1024 * 1024)}`;

    expect(VMUtil.runsIntoNothing({ a: null }, longPath)).toBe(true);
    expect(VMUtil.runsIntoNothing({ a: {} }, longPath)).toBe(false);
  });
});
