/*
 * How VMUtil renders {{#each}} loops: text that an element or a variable
 * carries is rendered as written - never read again for {{...}} or for
 * {{#each}} - and a loop body resolves its own names, since its output is no
 * longer substituted into a second time.
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

import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import { JSONValue } from "../../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

describe("replaceValueInPlace — {{...}} text that an {{#each}} element carries", () => {
  /*
   * The expanded loop used to be substituted into again, so an element whose
   * text named a variable came out as that variable's value rather than as
   * written. When that text was all the loop rendered, it was also taken for
   * the whole template and lost the whitespace around it.
   */
  it("renders an element's placeholder text as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          items: [{ name: "{{monitorName}}" }],
          monitorName: "Nightly backups",
        },
        "{{#each items}}{{name}} {{/each}}",
        false,
      ),
    ).toBe("{{monitorName}} ");
  });

  it("renders it as written when it is all the loop renders", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          items: [{ name: "{{monitorName}}" }],
          monitorName: "Nightly backups",
        },
        "{{#each items}}{{name}}{{/each}}",
        false,
      ),
    ).toBe("{{monitorName}}");
  });

  it("renders a plain element's placeholder text as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["{{monitorName}}", "db"], monitorName: "Nightly backups" },
        "{{#each tags}}[{{this}}]{{/each}}",
        false,
      ),
    ).toBe("[{{monitorName}}][db]");
  });

  it("renders an enclosing variable's placeholder text as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          tags: ["a"],
          monitorName: "{{monitorDescription}}",
          monitorDescription: "Internal runbook notes",
        },
        "{{#each tags}}{{this}}: {{monitorName}}{{/each}}",
        false,
      ),
    ).toBe("a: {{monitorDescription}}");
  });

  it("does not substitute into a nested loop's output again", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          groups: [
            {
              name: "Core",
              members: [{ id: "{{name}}" }, { id: "db-1" }],
            },
          ],
        },
        "{{#each groups}}{{name}}: {{#each members}}{{id}} {{/each}}{{/each}}",
        false,
      ),
    ).toBe("Core: {{name}} db-1 ");
  });

  it("does not read a loop's output and the braces around it as one placeholder", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["monitorName"], monitorName: "Nightly backups" },
        "{{{{#each tags}}{{this}}{{/each}}}}",
        false,
      ),
    ).toBe("{{monitorName}}");
  });

  it("escapes the text as written in a JSON template", () => {
    const result: string = VMUtil.replaceValueInPlace(
      {
        items: [{ title: '"{{monitorName}}" is down' }],
        monitorName: "Nightly backups",
      },
      '[{{#each items}}{"title": "{{title}}"}{{/each}}]',
      true,
    );

    expect(JSON.parse(result)).toEqual([
      { title: '"{{monitorName}}" is down' },
    ]);
  });

  it("keeps the text as written in the key/value headers shape", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      { items: [{ name: "{{owner}}" }, { name: "db" }], owner: "ops" },
      {
        "X-Names": "{{#each items}}{{name}},{{/each}}",
        "X-Owner": "{{owner}}",
      } as never,
      false,
    ) as unknown as JSONValue;

    expect(result).toEqual({ "X-Names": "{{owner}},db,", "X-Owner": "ops" });
  });
});

describe("replaceValueInPlace — $ in a plain {{#each}} element", () => {
  /*
   * {{this}} was put in with the string form of String.replace, which reads
   * $&, $`, $' and $$ in the replacement as substitution patterns.
   */
  it("does not treat $& as a substitution pattern", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["a$&b"] },
        "{{#each tags}}{{this}}{{/each}}",
        false,
      ),
    ).toBe("a$&b");
  });

  it("does not treat $`, $' or $$ as substitution patterns", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["x$`y", "x$'y", "50$$"] },
        "{{#each tags}}{{this}} {{/each}}",
        false,
      ),
    ).toBe("x$`y x$'y 50$$ ");
  });
});

describe("replaceValueInPlace — names in one {{#each}} body", () => {
  /*
   * A body's names were collected first, then the first occurrence of each
   * was replaced in the body as it was being rewritten, so a value carrying
   * another name's placeholder was matched in place of the one the template
   * author wrote.
   */
  it("does not let a value capture a later name's substitution", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { items: [{ subject: "{{owner}}", owner: "ops" }] },
        "{{#each items}}{{subject}} / {{owner}}{{/each}}",
        false,
      ),
    ).toBe("{{owner}} / ops");
  });

  it("renders the same whichever name comes first", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { items: [{ subject: "{{owner}}", owner: "ops" }] },
        "{{#each items}}{{owner}} / {{subject}}{{/each}}",
        false,
      ),
    ).toBe("ops / {{owner}}");
  });

  it("replaces every occurrence of a name whose value contains it", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { items: [{ subject: "Fwd: {{subject}}" }] },
        "{{#each items}}{{subject}} | {{subject}}{{/each}}",
        false,
      ),
    ).toBe("Fwd: {{subject}} | Fwd: {{subject}}");
  });
});

describe("replaceValueInPlace — {{#each}} text inside a value", () => {
  /*
   * After each expansion the search for the next {{#each}} started again
   * from the top of the expanded text, so loop syntax inside a value was
   * expanded as though the template author had written it.
   */
  it("does not expand a plain element's {{#each}} text", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          tags: ["{{#each services}}{{this}}{{/each}}"],
          services: ["checkout"],
        },
        "{{#each tags}}{{this}};{{/each}}",
        false,
      ),
    ).toBe("{{#each services}}{{this}}{{/each}};");
  });

  it("does not expand an object element's {{#each}} text", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          items: [{ note: "{{#each services}}{{this}}{{/each}}" }],
          services: ["checkout"],
        },
        "{{#each items}}{{note}}{{/each}}",
        false,
      ),
    ).toBe("{{#each services}}{{this}}{{/each}}");
  });
});

describe("replaceValueInPlace — what an {{#each}} body resolves itself", () => {
  /*
   * A loop over plain values left every name but {{this}} and {{@index}} to
   * the pass over the whole output. Nothing passes over the output now, so
   * the loop resolves them, from the enclosing scope.
   */
  it("resolves enclosing variables in a loop over plain values", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["x", "y"], monitorName: "M" },
        "{{#each tags}}{{this}}@{{monitorName}} {{/each}}",
        false,
      ),
    ).toBe("x@M y@M ");
  });

  it("resolves a dotted enclosing path in a loop over plain values", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["a", "b"], requestBody: { receiver: "Ops" } },
        "{{#each tags}}{{this}} to {{requestBody.receiver}}. {{/each}}",
        false,
      ),
    ).toBe("a to Ops. b to Ops. ");
  });

  it("trims a name in a loop over plain values, as in a loop over objects", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["x"], items: [{ id: 1 }], monitorName: "M" },
        "{{#each tags}}{{ monitorName }}{{/each}} {{#each items}}{{ id }}{{/each}}",
        false,
      ),
    ).toBe("M 1");
  });

  it("looks a name up on the element before the enclosing scope", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { status: "resolved", items: [{ status: "firing" }, { name: "b" }] },
        "{{#each items}}{{status}} {{/each}}",
        false,
      ),
    ).toBe("firing resolved ");
  });

  it("looks a name up on each enclosing element, innermost first", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          region: "global",
          groups: [
            {
              name: "G1",
              region: "eu",
              members: [{ id: 1 }, { id: 2, region: "us" }],
            },
          ],
        },
        "{{#each groups}}{{#each members}}{{id}}:{{region}}:{{name}} {{/each}}{{/each}}",
        false,
      ),
    ).toBe("1:eu:G1 2:us:G1 ");
  });

  it("leaves a name nothing resolves as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { items: [{ a: 1 }], tags: ["t"] },
        "{{#each items}}{{a}}-{{missing}} {{/each}}{{#each tags}}{{this}}-{{missing}}{{/each}}",
        false,
      ),
    ).toBe("1-{{missing}} t-{{missing}}");
  });

  it("gives {{@index}} in a nested loop the outermost loop's index, as before", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          groups: [
            { members: [{ id: 1 }, { id: 2 }] },
            { members: [{ id: 3 }] },
          ],
        },
        "{{#each groups}}{{#each members}}{{@index}}{{/each}}|{{/each}}",
        false,
      ),
    ).toBe("00|1|");
  });

  it("gives {{this}} in a nested loop the outermost plain value, as before", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { outer: ["p", "q"], inner: ["1", "2"], rows: [{ x: 1 }] },
        "{{#each outer}}{{#each inner}}{{this}}{{/each}}{{#each rows}}{{this}}{{x}}{{/each}}|{{/each}}",
        false,
      ),
    ).toBe("ppp1|qqq1|");
  });

  it("still reads {{{this}}} as the value in braces", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { tags: ["a", "b"] },
        "{{#each tags}}{{{this}}}{{/each}}",
        false,
      ),
    ).toBe("{a}{b}");
  });

  it("escapes a plain element for a JSON template", () => {
    const result: string = VMUtil.replaceValueInPlace(
      { tags: ['say "hi"', "C:\\path", "line1\nline2"] },
      '[{{#each tags}}"{{this}}", {{/each}}"end"]',
      true,
    );

    expect(JSON.parse(result)).toEqual([
      'say "hi"',
      "C:\\path",
      "line1\nline2",
      "end",
    ]);
  });

  /*
   * The raw-value rule for a template that is one placeholder is decided
   * from the template; it used to be asked of the text the loops rendered.
   */
  it("does not treat a template with a loop in it as a single placeholder", () => {
    const result: unknown = VMUtil.replaceValueInPlace(
      { items: [], count: 5 },
      "{{#each items}}x{{/each}}{{count}}",
      false,
    );

    expect(result).toBe("5");
  });
});

describe("expandEachLoops", () => {
  it("returns the text outside the loops as written", () => {
    expect(
      VMUtil.expandEachLoops(
        { items: [{ n: "a" }, { n: "b" }], title: "T" },
        "{{title}}: {{#each items}}{{n}}{{/each}}",
        false,
      ),
    ).toBe("{{title}}: ab");
  });

  it("returns an element's {{#each}} text as written", () => {
    expect(
      VMUtil.expandEachLoops(
        {
          tags: ["{{#each services}}{{this}}{{/each}}"],
          services: ["checkout"],
        },
        "{{#each tags}}{{this}}{{/each}}",
        false,
      ),
    ).toBe("{{#each services}}{{this}}{{/each}}");
  });

  it("resolves enclosing variables in a loop over plain values", () => {
    expect(
      VMUtil.expandEachLoops(
        { tags: ["x"], monitorName: "M" },
        "{{#each tags}}{{this}}@{{monitorName}}{{/each}}",
        false,
      ),
    ).toBe("x@M");
  });

  it("drops an unmatched {{#each}} tag and keeps the text after it", () => {
    expect(
      VMUtil.expandEachLoops({ name: "N" }, "a {{#each items}}{{name}}", false),
    ).toBe("a {{name}}");

    expect(
      VMUtil.replaceValueInPlace(
        { name: "N" },
        "a {{#each items}}{{name}}",
        false,
      ),
    ).toBe("a N");
  });
});
