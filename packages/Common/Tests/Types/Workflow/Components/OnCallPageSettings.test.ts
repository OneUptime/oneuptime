/*
 * How a Page step's settings are read. The Builder and the server both read
 * them through OnCallPageSettings, so what it makes of a value is what a
 * page does:
 *
 *   - Page About is one of three choices, and an empty one is a new alert;
 *   - who to page is a list of ids - and, for people, email addresses -
 *     whatever shape the values from earlier steps arrived in: one id,
 *     several on a line, a list, a list written as JSON, a record, a list of
 *     records;
 *   - what is neither an id nor an email address is kept, to be said.
 *
 * The last block runs the values through the runner's own substitution
 * (VMAPI.replaceValueInPlace), since that decides which shapes arrive.
 */

import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DEFAULT_PAGE_ABOUT,
  PAGE_ARGUMENT_IDS,
  PAGE_ERROR_PORT_ID,
  PAGE_IN_PORT_ID,
  PAGE_RETURN_VALUE_IDS,
  PAGE_SUCCESS_PORT_ID,
  PageAbout,
  PageIdList,
  hasPageSettingValue,
  holdsPageSettingReference,
  readPageAbout,
  readPageIdList,
  readPageRecordId,
} from "../../../../Types/Workflow/Components/OnCallPageSettings";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

const A: string = "11111111-1111-4111-8111-111111111111";
const B: string = "22222222-2222-4222-8222-222222222222";
const C: string = "33333333-3333-4333-8333-333333333333";

function list(value: JSONValue | undefined): PageIdList {
  return readPageIdList(value, { allowEmails: true });
}

describe("the stored ids of a Page step's settings never change", () => {
  test("saved workflows and templates use these exact ids", () => {
    expect(PAGE_ARGUMENT_IDS).toEqual({
      users: "users",
      teams: "teams",
      onCallSchedules: "on-call-schedules",
      onCallPolicies: "on-call-policies",
      about: "about",
      title: "title",
      message: "message",
      alertSeverity: "alert-severity",
      incidentId: "incident-id",
      alertId: "alert-id",
    });
  });

  test("and what it returns is read by these ids", () => {
    expect(PAGE_RETURN_VALUE_IDS).toEqual({
      summary: "summary",
      pagedUsers: "paged-users",
      alertId: "alert-id",
      incidentId: "incident-id",
      error: "error",
    });
  });

  test("its ports are In, Success and Error", () => {
    expect([PAGE_IN_PORT_ID, PAGE_SUCCESS_PORT_ID, PAGE_ERROR_PORT_ID]).toEqual(
      ["in", "success", "error"],
    );
  });

  test("what a page is about is stored as one of three words", () => {
    expect(Object.values(PageAbout)).toEqual([
      "new-alert",
      "incident",
      "alert",
    ]);
  });
});

describe("Page About", () => {
  test("empty stands for a new alert", () => {
    expect(DEFAULT_PAGE_ABOUT).toBe(PageAbout.NewAlert);

    for (const empty of [undefined, null, "", "   ", "\n"]) {
      expect(readPageAbout(empty)).toBe(PageAbout.NewAlert);
    }
  });

  test.each([
    ["new-alert", PageAbout.NewAlert],
    ["incident", PageAbout.Incident],
    ["alert", PageAbout.Alert],
  ])("%s is read as stored", (stored: string, about: PageAbout) => {
    expect(readPageAbout(stored)).toBe(about);
  });

  test("spaces around it and capitals do not matter", () => {
    expect(readPageAbout("  Incident ")).toBe(PageAbout.Incident);
    expect(readPageAbout("ALERT")).toBe(PageAbout.Alert);
    expect(readPageAbout("New-Alert\n")).toBe(PageAbout.NewAlert);
  });

  test("anything else is none of the choices, not a guess at one", () => {
    for (const unknown of [
      "an incident",
      "episode",
      "{{local.components.x.returnValues.kind}}",
      "new alert",
      "incidents",
    ]) {
      expect(readPageAbout(unknown)).toBeNull();
    }
  });

  test("a value that is not text is none of them either", () => {
    for (const value of [0, 1, true, false, {}, [], ["incident"]]) {
      expect(readPageAbout(value)).toBeNull();
    }
  });
});

describe("who to page: ids", () => {
  test("nothing at all is nobody", () => {
    for (const empty of [undefined, null, "", "   ", [], [""], [null]]) {
      expect(list(empty as JSONValue)).toEqual({
        ids: [],
        emails: [],
        unreadable: [],
      });
    }
  });

  test("one id", () => {
    expect(list(A).ids).toEqual([A]);
    expect(list([A]).ids).toEqual([A]);
    expect(list(`  ${A}\n`).ids).toEqual([A]);
  });

  test("a list of ids, in the order they were named", () => {
    expect(list([B, A, C])).toEqual({
      ids: [B, A, C],
      emails: [],
      unreadable: [],
    });
  });

  test("each id once, whatever its case", () => {
    expect(list([A, A.toUpperCase(), B, A]).ids).toEqual([A, B]);
  });

  test("an id is kept as it was first written", () => {
    const upper: string = "ABCDEFAB-1111-4111-8111-ABCDEFABCDEF";

    expect(list([upper, upper.toLowerCase()]).ids).toEqual([upper]);
  });

  test.each([
    ["commas", `${A},${B},${C}`],
    ["commas and spaces", `${A}, ${B} , ${C}`],
    ["semicolons", `${A};${B};${C}`],
    ["spaces", `${A} ${B}   ${C}`],
    ["line breaks", `${A}\n${B}\r\n${C}`],
    ["a mix", `${A},\n ${B};\t${C},`],
  ])(
    "several ids in one text, separated by %s",
    (_name: string, text: string) => {
      expect(list(text)).toEqual({
        ids: [A, B, C],
        emails: [],
        unreadable: [],
      });
    },
  );

  test("a list written as JSON text: what a reference to a list becomes inside a setting", () => {
    expect(list(JSON.stringify([A, B])).ids).toEqual([A, B]);
    expect(list(JSON.stringify([A, B], null, 2)).ids).toEqual([A, B]);
    expect(list([C, JSON.stringify([A, B], null, 2)]).ids).toEqual([C, A, B]);
  });

  test("a record is read by its id", () => {
    expect(list({ _id: A, name: "Jane Doe" }).ids).toEqual([A]);
    expect(list({ id: B, name: "Platform" }).ids).toEqual([B]);
    expect(list(JSON.stringify({ _id: C, name: "Primary" })).ids).toEqual([C]);
  });

  test("an id as the API writes one is read by its value", () => {
    expect(list(new ObjectID(A).toJSON()).ids).toEqual([A]);
    expect(
      list({ _id: new ObjectID(B).toJSON(), name: "Jane Doe" } as JSONObject)
        .ids,
    ).toEqual([B]);
  });

  test("a list of records: an incident's owners, a Find Many result", () => {
    expect(
      list([
        { _id: A, name: "Jane Doe", email: "jane@example.com" },
        { _id: B, name: "John Roe", email: "john@example.com" },
      ]),
    ).toEqual({ ids: [A, B], emails: [], unreadable: [] });
  });

  test("lists inside lists are read through", () => {
    expect(list([[A], [[B]], [JSON.stringify([C])]]).ids).toEqual([A, B, C]);
  });

  test("but a list nested past any list of people is not read for ever", () => {
    let nested: JSONValue = A;

    for (let depth: number = 0; depth < 12; depth++) {
      nested = [nested];
    }

    expect(list(nested)).toEqual({ ids: [], emails: [], unreadable: [] });
  });
});

describe("who to page: email addresses", () => {
  test("a person can be named by the address they sign in with", () => {
    expect(list("jane@example.com")).toEqual({
      ids: [],
      emails: ["jane@example.com"],
      unreadable: [],
    });
  });

  test("addresses are lower-cased, and each is kept once", () => {
    expect(
      list(["Jane@Example.com", "jane@example.com", "JOHN@example.com"]).emails,
    ).toEqual(["jane@example.com", "john@example.com"]);
  });

  test("ids and addresses can be mixed in one setting", () => {
    expect(list(`${A}, jane@example.com\n${B};john@example.com`)).toEqual({
      ids: [A, B],
      emails: ["jane@example.com", "john@example.com"],
      unreadable: [],
    });
  });

  test("only where people are named: a team is never an email address", () => {
    expect(readPageIdList("platform@example.com")).toEqual({
      ids: [],
      emails: [],
      unreadable: ["platform@example.com"],
    });
    expect(
      readPageIdList("platform@example.com", { allowEmails: false }),
    ).toEqual({
      ids: [],
      emails: [],
      unreadable: ["platform@example.com"],
    });
  });

  test.each(["jane@", "@example.com", "jane@example", "jane example.com"])(
    "%s is not an address",
    (text: string) => {
      const result: PageIdList = list(text);

      expect(result.emails).toEqual([]);
      expect(result.unreadable.length).toBeGreaterThan(0);
    },
  );
});

describe("who to page: what cannot be read", () => {
  test("a name is not an id: it is kept, to be said", () => {
    expect(list("Jane")).toEqual({ ids: [], emails: [], unreadable: ["Jane"] });
  });

  test("a reference that resolved to nothing is left as written, and kept", () => {
    const reference: string =
      "{{local.components.webhook-1.returnValues.request-body.owner}}";

    expect(list([A, reference])).toEqual({
      ids: [A],
      emails: [],
      unreadable: [reference],
    });
  });

  test("the readable entries are still read", () => {
    expect(list(`${A}, nobody, ${B}, 12345`)).toEqual({
      ids: [A, B],
      emails: [],
      unreadable: ["nobody", "12345"],
    });
  });

  test("the same unreadable entry is kept once", () => {
    expect(list(["ops", "ops", "ops"]).unreadable).toEqual(["ops"]);
  });

  test("a number, a switch and a record without an id are not ids", () => {
    expect(list(42 as JSONValue).unreadable).toEqual(["42"]);
    expect(list(true as JSONValue).unreadable).toEqual(["true"]);
    expect(list({ name: "Jane" }).unreadable).toEqual(['{"name":"Jane"}']);
  });

  test("a long entry is cut short where it is quoted back", () => {
    const long: string = "x".repeat(500);
    const unreadable: Array<string> = list(long).unreadable;

    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]).toBe(`${"x".repeat(80)}…`);
  });

  test("text that only looks like JSON is read as text", () => {
    expect(list(`[${A}`)).toEqual({
      ids: [],
      emails: [],
      unreadable: [`[${A}`],
    });
    expect(list("{not json}").unreadable).toEqual(["{not", "json}"]);
  });
});

describe("a setting that names one record", () => {
  test("its id", () => {
    expect(readPageRecordId(A)).toBe(A);
    expect(readPageRecordId(`  ${A}  `)).toBe(A);
    expect(readPageRecordId([A])).toBe(A);
  });

  test("a record, read by its id: a trigger's whole incident works", () => {
    expect(readPageRecordId({ _id: A, title: "API is down" })).toBe(A);
    expect(readPageRecordId(JSON.stringify({ _id: B }))).toBe(B);
  });

  test("nothing, when it holds none", () => {
    for (const empty of [undefined, null, "", "  "]) {
      expect(readPageRecordId(empty as JSONValue)).toBeNull();
    }
  });

  test("nothing, when it holds two: which one is not ours to pick", () => {
    expect(readPageRecordId(`${A}, ${B}`)).toBeNull();
    expect(readPageRecordId([A, B])).toBeNull();
  });

  test("nothing, when it is not an id, or an id with something beside it", () => {
    expect(readPageRecordId("INC-8")).toBeNull();
    expect(readPageRecordId(`${A} INC-8`)).toBeNull();
    expect(
      readPageRecordId("{{local.components.x.returnValues.model._id}}"),
    ).toBeNull();
    expect(readPageRecordId("jane@example.com")).toBeNull();
  });
});

describe("whether a setting holds anything", () => {
  test("nothing, blank text, and a list of nothing do not", () => {
    for (const empty of [undefined, null, "", "  \n", [], ["", " "], [null]]) {
      expect(hasPageSettingValue(empty as JSONValue)).toBe(false);
    }
  });

  test("text, a reference, a list with an entry, a record, a number do", () => {
    for (const value of [
      A,
      "Jane",
      "{{local.variables.onCallUser}}",
      [A],
      ["", A],
      { _id: A },
      0,
      false,
    ]) {
      expect(hasPageSettingValue(value as JSONValue)).toBe(true);
    }
  });
});

describe("whether a saved setting takes its value from an earlier step", () => {
  test("it does when it holds a {{value}}, alone or inside other text", () => {
    for (const value of [
      "{{local.components.trigger.returnValues.model._id}}",
      "  {{local.variables.about}}  ",
      "Page about {{local.variables.what}}",
      "{{local.variables.a}} {{local.variables.b}}",
      ["a fixed entry", "{{local.components.find.returnValues.owners}}"],
      [["{{global.variables.team}}"]],
    ]) {
      expect(holdsPageSettingReference(value as JSONValue)).toBe(true);
    }
  });

  test("it does not when it holds only what was typed or picked", () => {
    for (const value of [
      undefined,
      null,
      "",
      "incident",
      "new-alert",
      A,
      "{ not a value }",
      "{{",
      "}}",
      [A, B],
      [],
      7,
      true,
      { about: "{{local.variables.about}}" },
    ]) {
      expect(holdsPageSettingReference(value as JSONValue)).toBe(false);
    }
  });

  test("such a setting is one that holds something", () => {
    expect(
      hasPageSettingValue(
        "{{local.components.trigger.returnValues.model._id}}",
      ),
    ).toBe(true);
  });

  test("and what it holds is not one of Page About's choices until the step runs", () => {
    expect(readPageAbout("{{local.variables.about}}")).toBeNull();
  });
});

describe("any mix of ids, however it is written, reads as the same ids", () => {
  const SEPARATORS: Array<string> = [",", ", ", ";", " ", "\n", "\r\n", "\t"];

  function uuid(random: SeededRandom): string {
    const hex: string = "0123456789abcdef";
    let text: string = "";

    for (let index: number = 0; index < 32; index++) {
      text += hex[random(16)];
    }

    return `${text.slice(0, 8)}-${text.slice(8, 12)}-4${text.slice(13, 16)}-8${text.slice(17, 20)}-${text.slice(20, 32)}`;
  }

  test("300 lists, each written five ways", () => {
    const random: SeededRandom = seededRandom(4721);

    for (let round: number = 0; round < 300; round++) {
      const count: number = 1 + random(8);
      const expected: Array<string> = [];

      while (expected.length < count) {
        const id: string = uuid(random);

        if (!expected.includes(id)) {
          expected.push(id);
        }
      }

      // Some of them named twice: once is enough.
      const named: Array<string> = [...expected];

      for (let repeat: number = 0; repeat < random(3); repeat++) {
        named.push(expected[random(expected.length)] as string);
      }

      const separator: string = SEPARATORS[random(SEPARATORS.length)] as string;

      const writings: Array<JSONValue> = [
        named,
        named.join(separator),
        JSON.stringify(named),
        named.map((id: string): JSONObject => {
          return { _id: id };
        }),
        [named.slice(0, 1), named.slice(1).join(separator)],
      ];

      for (const writing of writings) {
        expect({ round, read: list(writing) }).toEqual({
          round,
          read: { ids: expected, emails: [], unreadable: [] },
        });
      }
    }
  });
});

describe("as the workflow runner hands the settings over", () => {
  /*
   * RunWorkflow.getComponentArguments resolves every {{...}} of a setting
   * with VMAPI.replaceValueInPlace. A who-to-page setting is stored as a
   * list, so the runner writes it as JSON, fills the values in, and reads
   * it back: a value inside it arrives as text.
   */
  const storageMap: JSONObject = {
    local: {
      components: {
        "incident-on-create-1": {
          returnValues: {
            model: {
              _id: A,
              createdByUserId: B,
              ownerUsers: [{ _id: B }, { _id: C }],
              ownerEmails: "jane@example.com, john@example.com",
            },
          },
        },
        "webhook-1": {
          returnValues: {
            "request-body": {
              teams: [A, B],
              owner: 'O"Brien',
            },
          },
        },
      },
      variables: {},
    },
    global: { variables: {} },
  };

  function resolve(value: JSONValue): JSONValue {
    return VMUtil.replaceValueInPlace(
      storageMap,
      value as string,
      false,
    ) as JSONValue;
  }

  test("an id picked from a list stays that id", () => {
    expect(list(resolve([A, C])).ids).toEqual([A, C]);
  });

  test("a reference to one id becomes that id", () => {
    expect(
      list(
        resolve([
          A,
          "{{local.components.incident-on-create-1.returnValues.model.createdByUserId}}",
        ]),
      ),
    ).toEqual({ ids: [A, B], emails: [], unreadable: [] });
  });

  test("a reference to a list of ids becomes every one of them", () => {
    expect(
      list(
        resolve([
          "{{local.components.webhook-1.returnValues.request-body.teams}}",
        ]),
      ),
    ).toEqual({ ids: [A, B], emails: [], unreadable: [] });
  });

  test("a reference to a list of records becomes their ids", () => {
    expect(
      list(
        resolve([
          "{{local.components.incident-on-create-1.returnValues.model.ownerUsers}}",
        ]),
      ),
    ).toEqual({ ids: [B, C], emails: [], unreadable: [] });
  });

  test("a reference to addresses on one line becomes each address", () => {
    expect(
      list(
        resolve([
          "{{local.components.incident-on-create-1.returnValues.model.ownerEmails}}",
        ]),
      ),
    ).toEqual({
      ids: [],
      emails: ["jane@example.com", "john@example.com"],
      unreadable: [],
    });
  });

  test("the setting stored as one reference, not a list, reads the same", () => {
    expect(
      list(
        resolve(
          "{{local.components.incident-on-create-1.returnValues.model.ownerUsers}}",
        ),
      ),
    ).toEqual({ ids: [B, C], emails: [], unreadable: [] });
  });

  test("a value with a quote in it does not break the list around it", () => {
    expect(
      list(
        resolve([
          A,
          "{{local.components.webhook-1.returnValues.request-body.owner}}",
        ]),
      ),
    ).toEqual({ ids: [A], emails: [], unreadable: ['O"Brien'] });
  });

  test("a reference that names nothing is left as written, and said", () => {
    const missing: string =
      "{{local.components.webhook-1.returnValues.request-body.nobody}}";

    expect(list(resolve([missing]))).toEqual({
      ids: [],
      emails: [],
      unreadable: [missing],
    });
  });

  test("Incident ID from a trigger: the id, or the whole record", () => {
    expect(
      readPageRecordId(
        resolve(
          "{{local.components.incident-on-create-1.returnValues.model._id}}",
        ),
      ),
    ).toBe(A);
    expect(
      readPageRecordId(
        resolve("{{local.components.incident-on-create-1.returnValues.model}}"),
      ),
    ).toBe(A);
  });
});
