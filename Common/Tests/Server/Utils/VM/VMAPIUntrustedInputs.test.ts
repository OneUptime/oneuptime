import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

jest.mock("../../../../Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Utils/Logger", () => {
  return { __esModule: true, default: { error: jest.fn(), debug: jest.fn() } };
});

function storage(comment: string): JSONObject {
  return {
    local: {
      components: { github: { comment } },
      variables: { secret: "private-value" },
    },
    comments: [{ body: comment }, { body: "safe" }],
    secretArray: ["private-array-value"],
  };
}

describe("untrusted GitHub input stays data in workflow templates", () => {
  test("does not reinterpret an injected placeholder that also occurs later in source", () => {
    const result: string = VMUtil.replaceValueInPlace(
      storage("{{local.variables.secret}}"),
      "Comment: {{local.components.github.comment}}; authorized value: {{local.variables.secret}}",
      false,
    );
    expect(result).toBe(
      "Comment: {{local.variables.secret}}; authorized value: private-value",
    );
  });

  test("resolves repeated source placeholders without rescanning earlier values", () => {
    const result: string = VMUtil.replaceValueInPlace(
      {
        ...storage(
          "{{local.components.github.comment}} / {{local.variables.secret}}",
        ),
        name: "OneUptime",
      },
      "{{local.components.github.comment}} | {{local.components.github.comment}} | {{local.variables.secret}}",
      false,
    );
    expect(result).toBe(
      "{{local.components.github.comment}} / {{local.variables.secret}} | {{local.components.github.comment}} / {{local.variables.secret}} | private-value",
    );
  });

  test.each([true, false])(
    "keeps injected syntax literal with isJSON=%p",
    (isJSON: boolean) => {
      const result: string = VMUtil.replaceValueInPlace(
        storage("{{local.variables.secret}}"),
        '{"comment":"{{local.components.github.comment}}","configured":"{{local.variables.secret}}"}',
        isJSON,
      );
      expect(JSON.parse(result)).toEqual({
        comment: "{{local.variables.secret}}",
        configured: "private-value",
      });
    },
  );

  test("does not expose configured header secrets in another field of an object argument", () => {
    const comment: string =
      '{{local.variables.secret}} "quoted"\nC:\\temp\\incident $&';
    const result: JSONValue = VMUtil.replaceValueInPlace(
      storage(comment),
      {
        message: "{{local.components.github.comment}}",
        authorization: "Bearer {{local.variables.secret}}",
      } as never,
      false,
    ) as unknown as JSONValue;
    expect(result).toEqual({
      message: comment,
      authorization: "Bearer private-value",
    });
  });

  test("does not execute loop markup supplied as a scalar comment", () => {
    const comment: string = "{{#each secretArray}}{{this}}{{/each}}";
    expect(
      VMUtil.replaceValueInPlace(
        storage(comment),
        "Comment: {{local.components.github.comment}}",
        false,
      ),
    ).toBe(`Comment: ${comment}`);
  });

  test.each([
    "{{local.variables.secret}}",
    "{{#each secretArray}}{{this}}{{/each}}",
    "{{/each}}{{#each secretArray}}{{this}}{{/each}}",
    "{{body}} {{local.variables.secret}}",
    "$& $` $' $1",
  ])("does not evaluate object-loop data %s", (comment: string) => {
    const template: string = "{{#each comments}}{{@index}}:{{body}};{{/each}}";
    expect(VMUtil.replaceValueInPlace(storage(comment), template, false)).toBe(
      `0:${comment};1:safe;`,
    );
    expect(VMUtil.expandEachLoops(storage(comment), template, false)).toBe(
      `0:${comment};1:safe;`,
    );
  });

  test.each([
    "{{local.variables.secret}}",
    "{{#each secretArray}}{{this}}{{/each}}",
    "$& $` $' $1",
  ])("does not evaluate primitive-loop data %s", (comment: string) => {
    const data: JSONObject = { ...storage(comment), values: [comment] };
    expect(
      VMUtil.replaceValueInPlace(
        data,
        "{{#each values}}{{this}}{{/each}}",
        false,
      ),
    ).toBe(comment);
  });

  test("does not re-evaluate nested loop values at outer loop or global scope", () => {
    const comment: string =
      "{{local.variables.secret}} {{#each secretArray}}{{this}}{{/each}}";
    const data: JSONObject = {
      ...storage(comment),
      groups: [{ name: "G1", comments: [{ body: comment }] }],
    };
    expect(
      VMUtil.replaceValueInPlace(
        data,
        "{{#each groups}}{{name}}: {{#each comments}}{{body}}{{/each}}{{/each}}",
        false,
      ),
    ).toBe(`G1: ${comment}`);
  });

  test("resolves legitimate later loop fields without moving their values into untrusted text", () => {
    const data: JSONObject = storage(
      "{{local.variables.secret}} {{@index}} {{body}}",
    );
    expect(
      VMUtil.replaceValueInPlace(
        data,
        "{{#each comments}}{{body}} / {{local.variables.secret}} / {{@index}};{{/each}}",
        false,
      ),
    ).toBe(
      "{{local.variables.secret}} {{@index}} {{body}} / private-value / 0;safe / private-value / 1;",
    );
  });

  test("never rescans placeholders created across adjacent inserted values", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { first: "{{local.", second: "variables.secret}}", ...storage("") },
        "{{first}}{{second}}",
        false,
      ),
    ).toBe("{{local.variables.secret}}");
  });

  test("does not let a storage key spanning adjacent tokens replace the authored references", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { a: "A", b: "B", "a}}{{b": "shadow" },
        "{{a}}{{b}}",
        false,
      ),
    ).toBe("AB");
    expect(
      VMUtil.replaceValueInPlace(
        {
          requestBody: {
            a: "A",
            b: "B",
            "a}}{{requestBody": { b: "shadow" },
          },
        },
        "{{requestBody.a}}{{requestBody.b}}",
        false,
      ),
    ).toBe("AB");
  });

  test("does not resolve markup embedded in serialized objects", () => {
    const data: JSONObject = {
      ...storage(""),
      payload: { body: "{{local.variables.secret}}" },
    };
    expect(
      VMUtil.replaceValueInPlace(
        data,
        "{{payload}} | {{local.variables.secret}}",
        false,
      ),
    ).toBe('{\n  "body": "{{local.variables.secret}}"\n} | private-value');
  });

  test("escapes loop values once when rendering JSON", () => {
    const comment: string = '{{local.variables.secret}} "quoted"\nC:\\path';
    const result: string = VMUtil.replaceValueInPlace(
      storage(comment),
      '{"comments":"{{#each comments}}{{body}};{{/each}}"}',
      true,
    );
    expect(JSON.parse(result)).toEqual({ comments: `${comment};safe;` });
  });
});

describe("single-pass template evaluation preserves supported behavior", () => {
  test.each([0, 5, false, true, null, "hello"])(
    "preserves the exact-placeholder type for %p",
    (value: JSONValue) => {
      expect(VMUtil.replaceValueInPlace({ value }, " {{value}} ", false)).toBe(
        value,
      );
    },
  );

  test.each([{ a: 1 }, [1, 2, 3]])(
    "serializes exact-placeholder objects and arrays %p",
    (value: JSONObject | Array<number>) => {
      expect(VMUtil.replaceValueInPlace({ value }, "{{value}}", false)).toBe(
        JSON.stringify(value, null, 2),
      );
    },
  );

  test("preserves whitespace in a sole unresolved placeholder", () => {
    expect(VMUtil.replaceValueInPlace({}, " {{missing}} ", false)).toBe(
      " {{missing}} ",
    );
  });

  test("keeps top-level references untouched in expandEachLoops", () => {
    expect(
      VMUtil.expandEachLoops(
        { title: "Dashboard", items: [{ name: "one" }] },
        "{{title}}:{{#each items}}{{name}} in {{title}}{{/each}}",
        false,
      ),
    ).toBe("{{title}}:one in Dashboard");
  });

  test("expands sibling, nested and whitespace-delimited loop blocks from source", () => {
    const data: JSONObject = {
      title: "Root",
      groups: [{ name: "A", members: ["one", "two"] }],
      tail: ["last"],
    };
    expect(
      VMUtil.replaceValueInPlace(
        data,
        "{{#each groups}}{{name}}:{{#each\tmembers}}{{@index}}={{this}}/{{title}};{{/each}}{{/each}}{{#each tail}}{{this}}{{/each}}",
        false,
      ),
    ).toBe("A:0=one/Root;1=two/Root;last");
  });

  test("removes an unmatched loop opener without rescanning output", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { name: "OneUptime" },
        "Before {{#each missing}}{{name}} after",
        false,
      ),
    ).toBe("Before OneUptime after");
  });

  test("preserves unresolved loop variables and parent fallback", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { fallback: "root", items: [{ name: "item" }] },
        "{{#each items}}{{ name }}/{{ fallback }}/{{missing}}{{/each}}",
        false,
      ),
    ).toBe("item/root/{{missing}}");
  });

  test("handles empty, zero, false and null primitive loop items", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { items: ["", 0, false, null] },
        "{{#each items}}[{{@index}}={{this}}]{{/each}}",
        false,
      ),
    ).toBe("[0=][1=0][2=false][3=null]");
  });
});
