/*
 * Each script of the Zabbix templates, run in the workflow sandbox on the
 * arguments the runner hands it, and held to what it decides:
 *
 *   - read-event-1: which event Zabbix sent, and what Incident or Alert From
 *     Another Tool does with it - open, resolve, acknowledge or note; the
 *     severity a new record opens at, for every Zabbix severity and any
 *     number of project severities (the place the script names, as the step
 *     picks it: pickSeverityIndex); the title, the description, the note,
 *     the reason on the timeline and the link to the problem; what it
 *     ignores, and why;
 *   - plan-state-1: what a record's new state means in Zabbix, and the
 *     message Update Zabbix Problem sends with it;
 *   - build-message-1: the message a private note becomes.
 *
 * Moving a record forward, and only forward, is Incident From Another
 * Tool's (FromAnotherTool.test.ts); reading a problem in Zabbix, choosing
 * what to send and reading Zabbix's answer is Update Zabbix Problem's
 * (ZabbixUpdateProblem.test.ts): the scripts that did both are gone.
 *
 * The scripts read text somebody outside wrote, so each is also given about
 * 400,000 characters of the shapes that cost a pattern the most, and has to
 * answer in time that grows with the text, not its square.
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import { pickSeverityIndex } from "../../../Types/Workflow/Components/FromAnotherTool";
import {
  ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER,
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZABBIX_SEVERITY_NAMES,
  ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER,
  ZabbixEventKind,
} from "../../../Types/Workflow/Templates";
import {
  ALERT,
  EVENT_ID,
  INCIDENT,
  KINDS,
  PROBLEM_LINK,
  TRIGGER_ID,
  ZABBIX_URL,
  ZabbixEventProps,
  ZabbixKindFixture,
  noteModel,
  quoted,
  recordModel,
  runZabbixScript,
  stateNamed,
  zabbixFirstMediaTypeBody,
  zabbixPostedBody,
} from "./ZabbixTemplateFixtures";
import { describe, expect, jest, test } from "@jest/globals";
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(120000);

/* ------------------------------- read-event-1 ------------------------------- */

async function read(
  kind: ZabbixKindFixture,
  payload: JSONValue,
  props: {
    severities?: Array<JSONObject> | undefined;
    zabbixUrl?: string | undefined;
    editCode?: ((code: string) => string) | undefined;
  } = {},
): Promise<JSONObject> {
  return await runZabbixScript({
    templateId: kind.problemTemplateId,
    componentId: "read-event-1",
    args: {
      zabbixUrl: props.zabbixUrl === undefined ? ZABBIX_URL : props.zabbixUrl,
      // The webhook's body, quoted into the arguments: JSON text, or text as it came.
      payload: typeof payload === "string" ? payload : quoted(payload),
    },
    editCode: props.editCode,
  });
}

function event(props: ZabbixEventProps = {}): JSONObject {
  return zabbixPostedBody(props);
}

/*
 * The severity a problem opens at: the one the script names, by name or by
 * its place, as Incident From Another Tool picks it among the project's.
 */
async function opensAt(
  kind: ZabbixKindFixture,
  payload: JSONValue,
  props: {
    severities?: Array<JSONObject> | undefined;
    editCode?: ((code: string) => string) | undefined;
  } = {},
): Promise<string> {
  const result: JSONObject = await read(kind, payload, {
    editCode: props.editCode,
  });
  const ordered: Array<JSONObject> = [
    ...(props.severities || kind.severities),
  ].sort((a: JSONObject, b: JSONObject): number => {
    return Number(a["order"]) - Number(b["order"]);
  });

  return String(
    ordered[
      pickSeverityIndex({
        given: String(result["severity"]),
        severities: ordered.map((severity: JSONObject) => {
          return { id: String(severity["_id"]), name: String(severity["name"]) };
        }),
      }).index
    ]?.["name"],
  );
}

// A project's severities, most severe first: "S1", "S2", ...
function severities(count: number): Array<JSONObject> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      _id: `ffffffff-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `S${index + 1}`,
      order: index + 1,
    };
  }).reverse();
}

/*
 * Where each Zabbix severity lands, as the script's comment says: Disaster
 * and High at the most severe of the project's severities, Average and
 * Warning in the middle, Information and Not classified at the least, with
 * the ones in between spread across the range.
 */
const EXPECTED_SEVERITY: Record<number, Array<string>> = {
  // Zabbix severity:  5     4     3     2     1     0
  1: ["S1", "S1", "S1", "S1", "S1", "S1"],
  2: ["S1", "S1", "S2", "S2", "S2", "S2"],
  3: ["S1", "S1", "S2", "S2", "S3", "S3"],
  4: ["S1", "S1", "S3", "S3", "S4", "S4"],
  5: ["S1", "S1", "S3", "S3", "S5", "S5"],
  6: ["S1", "S1", "S4", "S4", "S6", "S6"],
};

describe("read-event-1: the severity a problem opens at", () => {
  for (const count of [1, 2, 3, 4, 5, 6]) {
    test(`with ${count} project severit${count === 1 ? "y" : "ies"}, Disaster to Not classified land at ${EXPECTED_SEVERITY[count]!.join(", ")}`, async () => {
      const landed: Array<string> = [];

      for (const severityNumber of [5, 4, 3, 2, 1, 0]) {
        landed.push(
          await opensAt(INCIDENT, event({ severityNumber }), {
            severities: severities(count),
          }),
        );
      }

      expect(landed).toEqual(EXPECTED_SEVERITY[count]);
    });
  }

  test.each(KINDS)(
    "a new project's $noun severities: Disaster and High at the most severe, the rest by rank",
    async (kind: ZabbixKindFixture) => {
      const landed: Array<string> = [];

      for (const severityNumber of [5, 4, 3, 2, 1, 0]) {
        landed.push(await opensAt(kind, event({ severityNumber })));
      }

      expect(landed).toEqual(
        kind === INCIDENT
          ? [
              "Critical Incident",
              "Critical Incident",
              "Major Incident",
              "Major Incident",
              "Minor Incident",
              "Minor Incident",
            ]
          : ["High", "High", "Low", "Low", "Low", "Low"],
      );
    },
  );

  test("the number decides, whatever the severity is called: an administrator can rename Zabbix's severities", async () => {
    const result: JSONObject = await read(
      INCIDENT,
      event({ severityNumber: 5, severityName: "P1 - wake everyone" }),
    );

    expect(result["severityNumber"]).toBe(5);
    expect(result["severity"]).toBe("most severe");
    expect(result["zabbixSeverity"]).toBe("P1 - wake everyone");
    expect(
      await opensAt(
        INCIDENT,
        event({ severityNumber: 5, severityName: "P1 - wake everyone" }),
      ),
    ).toBe("Critical Incident");
  });

  test.each([
    [5, "most severe"],
    [4, "most severe"],
    [3, "middle"],
    [2, "middle"],
    [1, "least severe"],
    [0, "least severe"],
  ])(
    "Zabbix severity %p is named by its place among the project's: %p",
    async (severityNumber: number, place: string) => {
      expect(
        (await read(INCIDENT, event({ severityNumber })))["severity"],
      ).toBe(place);
    },
  );

  test.each(
    ZABBIX_SEVERITY_NAMES.map((name: string, index: number) => {
      return [name, index] as [string, number];
    }),
  )(
    "without a number, the severity named %s is Zabbix's %s",
    async (name: string, index: number) => {
      const result: JSONObject = await read(
        INCIDENT,
        zabbixFirstMediaTypeBody({ severityNumber: index }),
      );

      expect(result["severityNumber"]).toBe(index);
      expect(result["zabbixSeverity"]).toBe(name);
    },
  );

  test("a severity Zabbix does not name, and no number, is Not classified, as Zabbix calls an unknown one", async () => {
    const result: JSONObject = await read(INCIDENT, {
      ...zabbixFirstMediaTypeBody(),
      severity: "Catastrophic",
    });

    expect(result["severityNumber"]).toBe(0);
    expect(
      await opensAt(INCIDENT, {
        ...zabbixFirstMediaTypeBody(),
        severity: "Catastrophic",
      }),
    ).toBe("Minor Incident");
  });

  test.each(["6", "-1", "4.5", "high", ""])(
    "a number Zabbix never sends (%j) is not read as one: the name decides",
    async (value: string) => {
      const result: JSONObject = await read(INCIDENT, {
        ...event({ severityNumber: 4 }),
        severity_number: value,
      });

      expect(result["severityNumber"]).toBe(4);
    },
  );

  test("a severity listed by name in SEVERITY_BY_NAME wins over the places, as its comment says", async () => {
    const editCode: (code: string) => string = (code: string): string => {
      return code.replace(
        "const SEVERITY_BY_NAME = {};",
        "const SEVERITY_BY_NAME = { 2: 'minor incident' };",
      );
    };

    expect(
      (await read(INCIDENT, event({ severityNumber: 2 }), { editCode }))[
        "severity"
      ],
    ).toBe("minor incident");
    expect(
      await opensAt(INCIDENT, event({ severityNumber: 2 }), { editCode }),
    ).toBe("Minor Incident");
  });

  /*
   * A name the project does not have reaches the step as written, and the
   * step opens the record at the most severe and says so in the run log
   * (FromAnotherTool.test.ts). The old script fell back to the place
   * silently; a misspelt name is said now.
   */
  test("a name listed that the project does not have is handed on as written", async () => {
    const result: JSONObject = await read(
      INCIDENT,
      event({ severityNumber: 2 }),
      {
        editCode: (code: string): string => {
          return code.replace(
            "const SEVERITY_BY_NAME = {};",
            "const SEVERITY_BY_NAME = { 2: 'Sev 9' };",
          );
        },
      },
    );

    expect(result["severity"]).toBe("Sev 9");
  });

  test("needs none of the project's severities: it names a place, and the step picks the severity", async () => {
    const result: JSONObject = await read(ALERT, event());

    expect(result["severity"]).toBe("most severe");
    expect(Object.keys(result)).not.toContain("severities");
  });
});

describe("read-event-1: which event Zabbix sent", () => {
  test.each([
    [ZabbixEventKind.Problem, "problem"],
    [ZabbixEventKind.Recovery, "recovery"],
    [ZabbixEventKind.Update, "update"],
  ])(
    "the media type's %s is read as %s",
    async (kind: ZabbixEventKind, read_: string) => {
      expect((await read(INCIDENT, event({ kind })))["kind"]).toBe(read_);
    },
  );

  test("the event the media type names wins over its status, whatever its case", async () => {
    expect(
      (await read(INCIDENT, { ...event(), event: "RECOVERY", status: "1" }))[
        "kind"
      ],
    ).toBe("recovery");
  });

  test("without an event, a status of 1 is a problem and 0 its recovery, as the guide's first media type sent them", async () => {
    expect((await read(INCIDENT, zabbixFirstMediaTypeBody()))["kind"]).toBe(
      "problem",
    );
    expect(
      (
        await read(
          INCIDENT,
          zabbixFirstMediaTypeBody({ kind: ZabbixEventKind.Recovery }),
        )
      )["kind"],
    ).toBe("recovery");
  });

  test("the source may be written in any case", async () => {
    expect(
      (await read(INCIDENT, { ...event(), source: "Zabbix" }))["kind"],
    ).toBe("problem");
  });

  test.each([
    [
      "no source",
      { ...zabbixPostedBody(), source: undefined },
      "The request did not come from the OneUptime media type in Zabbix, so it was ignored.",
    ],
    [
      "another source",
      { ...zabbixPostedBody(), source: "grafana" },
      "The request did not come from the OneUptime media type in Zabbix, so it was ignored.",
    ],
    [
      "no event ID",
      { ...zabbixPostedBody(), event_id: "" },
      "The Zabbix event named no event ID, so it was ignored.",
    ],
    [
      "an event ID that is not a number",
      { ...zabbixPostedBody(), event_id: "12a" },
      "The Zabbix event named no event ID, so it was ignored.",
    ],
    [
      "an event ID longer than Zabbix's",
      { ...zabbixPostedBody(), event_id: "1".repeat(21) },
      "The Zabbix event named no event ID, so it was ignored.",
    ],
    [
      "an event ID still a macro",
      { ...zabbixPostedBody(), event_id: "{EVENT.ID}" },
      "The Zabbix event named no event ID, so it was ignored.",
    ],
    [
      "an unknown event and status",
      { ...zabbixPostedBody(), event: "maintenance", status: "2" },
      `Zabbix event ${EVENT_ID} is not a problem, a recovery or an update, so it was ignored.`,
    ],
  ])(
    "%s is ignored, and says why",
    async (_name: string, payload: JSONObject, reason: string) => {
      expect(await read(INCIDENT, payload)).toEqual({
        proceed: false,
        reason: reason,
      });
    },
  );

  test.each([
    ["a body that is not JSON", "event_id=12345&status=1"],
    ["an empty body", ""],
    [
      "a reference that never resolved",
      "{{local.components.webhook-1.returnValues.request-body}}",
    ],
  ])("%s is ignored", async (_name: string, payload: string) => {
    expect((await read(INCIDENT, payload))["proceed"]).toBe(false);
  });
});

describe("read-event-1: a new problem's title and description", () => {
  test("the title is the problem's name and its host", async () => {
    expect((await read(INCIDENT, event()))["title"]).toBe(
      "Zabbix: High CPU utilization on web-1",
    );
  });

  test("a problem with no name is named by its event ID, and one with no host says none", async () => {
    const result: JSONObject = await read(
      INCIDENT,
      event({ name: "", host: "" }),
    );

    expect(result["title"]).toBe(`Zabbix: Problem ${EVENT_ID}`);
    expect(String(result["description"])).toContain("- Host: not named");
  });

  test.each(KINDS)(
    "the $noun's description links the problem, then lists its host, severity, start, operational data and tags",
    async (kind: ZabbixKindFixture) => {
      expect((await read(kind, event()))["description"]).toBe(
        [
          `${kind.Created} from Zabbix ${PROBLEM_LINK}.`,
          "",
          "- Host: web-1",
          "- Severity in Zabbix: High",
          "- Started: 2026.10.18 10:15:00",
          "- Operational data: CPU utilization: 95.2 %",
          "- Tags: service: checkout, team: ops",
        ].join("\n"),
      );
    },
  );

  test("what a problem does not have is left out: no operational data, no tags, no start", async () => {
    const result: JSONObject = await read(INCIDENT, {
      ...event({ opdata: "", tags: [] }),
      date: "",
      time: "",
    });

    expect(result["description"]).toBe(
      [
        `Declared from Zabbix ${PROBLEM_LINK}.`,
        "",
        "- Host: web-1",
        "- Severity in Zabbix: High",
      ].join("\n"),
    );
  });

  test("a tag without a value is named alone, one without a name is left out, and at most 50 are listed", async () => {
    const many: Array<{ tag: string; value: string }> = Array.from(
      { length: 60 },
      (_value: unknown, index: number) => {
        return { tag: `t${index}`, value: "" };
      },
    );
    const result: JSONObject = await read(
      INCIDENT,
      event({
        tags: [
          { tag: "", value: "orphan" },
          { tag: "env", value: "" },
          ...many,
        ],
      }),
    );
    const tagLine: string = String(result["description"])
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- Tags: ");
      }) as string;

    expect(tagLine.startsWith("- Tags: env, t0, t1")).toBe(true);
    expect(tagLine).not.toContain("orphan");
    expect(tagLine.split(", ")).toHaveLength(50);
  });

  test("tags sent as text, as Zabbix's own macro value, are not read as a list", async () => {
    const result: JSONObject = await read(INCIDENT, {
      ...event(),
      tags: '[{"tag":"service","value":"checkout"}]',
    });

    expect(String(result["description"])).not.toContain("- Tags:");
  });

  test("the title fits the record's 500 characters, and the description its 20,000", async () => {
    const result: JSONObject = await read(
      INCIDENT,
      event({
        name: "n".repeat(600),
        host: "h".repeat(100),
        opdata: "o".repeat(30000),
      }),
    );

    expect(String(result["title"]).length).toBe(500);
    expect(String(result["title"]).endsWith("…")).toBe(true);
    expect(String(result["description"]).length).toBeLessThanOrEqual(20000);
  });

  test("double braces Zabbix's text holds are broken up, so no later step reads them as a reference", async () => {
    const result: JSONObject = await read(
      INCIDENT,
      event({
        name: "{{local.variables.zabbixApiToken}}",
        host: "{{global.variables.secret}}",
      }),
    );

    for (const key of ["title", "description"]) {
      expect(String(result[key])).not.toContain("{" + "{");
      expect(String(result[key])).not.toContain("}" + "}");
    }

    expect(result["title"]).toBe(
      "Zabbix: { {local.variables.zabbixApiToken} } on { {global.variables.secret} }",
    );
  });

  test("control characters are dropped and runs of space read as one", async () => {
    expect(
      (
        await read(
          INCIDENT,
          event({ name: "High\u0000 CPU\t\n  load", host: "web-1\u0007" }),
        )
      )["title"],
    ).toBe("Zabbix: High CPU load on web-1");
  });
});

describe("read-event-1: the link to the problem in Zabbix", () => {
  async function firstLine(
    zabbixUrl: string,
    payload: JSONObject = event(),
  ): Promise<string> {
    return String(
      (await read(INCIDENT, payload, { zabbixUrl: zabbixUrl }))["description"],
    ).split("\n")[0] as string;
  }

  test.each([
    [ZABBIX_URL, ZABBIX_URL],
    [`${ZABBIX_URL}/`, ZABBIX_URL],
    ["HTTPS://Zabbix.Example.com", "https://Zabbix.Example.com"],
    ["https://example.com/zabbix/", "https://example.com/zabbix"],
    ["https://zabbix.example.com:8443", "https://zabbix.example.com:8443"],
    ["  https://example.com/zabbix  ", "https://example.com/zabbix"],
  ])(
    "a Zabbix URL of %j links the problem's page at %s",
    async (setting: string, site: string) => {
      expect(await firstLine(setting)).toBe(
        `Declared from Zabbix [problem ${EVENT_ID}](${site}/tr_events.php?triggerid=${TRIGGER_ID}&eventid=${EVENT_ID}).`,
      );
    },
  );

  test.each([
    "https://zabbix.example.com/zabbix.php?action=problem.view",
    "javascript:alert(1)",
    "",
    "{{local.variables.zabbixUrl}}",
  ])(
    "a Zabbix URL of %j names the problem without a link",
    async (setting: string) => {
      expect(await firstLine(setting)).toBe(
        `Declared from Zabbix problem ${EVENT_ID}.`,
      );
    },
  );

  test.each([
    ["no trigger ID", ""],
    ["a trigger ID that is not a number", "1) [x](https://evil.example"],
    ["a trigger ID still a macro", "{TRIGGER.ID}"],
  ])(
    "an event with %s names the problem without a link",
    async (_name: string, triggerId: string) => {
      expect(
        await firstLine(ZABBIX_URL, { ...event(), trigger_id: triggerId }),
      ).toBe(`Declared from Zabbix problem ${EVENT_ID}.`);
    },
  );

  test("whatever the request says, the link goes to the site the workflow names", async () => {
    const line: string = await firstLine(ZABBIX_URL, {
      ...event(),
      zabbix_url: "https://evil.example",
      url: "https://evil.example",
    });

    expect(line).toBe(`Declared from Zabbix ${PROBLEM_LINK}.`);
  });
});

describe("read-event-1: an update made in Zabbix", () => {
  test("is a note saying who did what, then what they wrote, and acknowledges when it acknowledged, saying who did", async () => {
    expect(
      await read(INCIDENT, event({ kind: ZabbixEventKind.Update })),
    ).toEqual({
      proceed: true,
      kind: "update",
      whatHappened: "acknowledge",
      eventId: EVENT_ID,
      title: "",
      description: "",
      severity: "",
      severityNumber: -1,
      zabbixSeverity: "",
      note: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix ${PROBLEM_LINK}: acknowledged and commented.\n\nLooking into it: the checkout pods are being restarted.`,
      reason: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) acknowledged ${PROBLEM_LINK}.`,
    });
  });

  test("an acknowledgment by nobody Zabbix names is Someone's, and without a trigger ID the problem is named without a link", async () => {
    expect(
      (
        await read(INCIDENT, {
          ...event({ kind: ZabbixEventKind.Update, updateUser: "" }),
          trigger_id: "",
        })
      )["reason"],
    ).toBe(
      `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Someone acknowledged problem ${EVENT_ID}.`,
    );
  });

  test("the name in the reason has its braces broken up, so no later step reads it as a reference", async () => {
    const reason: string = String(
      (
        await read(
          INCIDENT,
          event({
            kind: ZabbixEventKind.Update,
            updateUser: "**{{local.variables.zabbixApiToken}}**",
          }),
        )
      )["reason"],
    );

    expect(reason).not.toContain("{" + "{");
    expect(reason).toContain("{ {local.variables.zabbixApiToken} }");
  });

  test.each([
    ["acknowledged", "acknowledged"],
    [
      "acknowledged, commented and changed severity from Warning to High",
      "acknowledged",
    ],
    ["commented and acknowledged", "acknowledged"],
    ["unacknowledged", ""],
    ["unacknowledged and commented", ""],
    ["commented", ""],
    ["closed", ""],
    ["changed severity from Average to High", ""],
    ["suppressed", ""],
    ["ranked as cause", ""],
  ])(
    "%j acknowledges the record: %j",
    async (action: string, target: string) => {
      const result: JSONObject = await read(
        INCIDENT,
        event({ kind: ZabbixEventKind.Update, updateAction: action }),
      );

      expect(result["whatHappened"]).toBe(
        target === "acknowledged" ? "acknowledge" : "note",
      );
      // A reason only for a move: a note alone has none.
      expect(result["reason"] !== "").toBe(target === "acknowledged");
    },
  );

  test("an update with no message says what was done, and stops there", async () => {
    expect(
      (
        await read(
          INCIDENT,
          event({
            kind: ZabbixEventKind.Update,
            updateAction: "closed",
            updateMessage: "",
          }),
        )
      )["note"],
    ).toBe(
      `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix ${PROBLEM_LINK}: closed.`,
    );
  });

  test("an update by nobody Zabbix names is Someone's", async () => {
    expect(
      String(
        (
          await read(
            INCIDENT,
            event({ kind: ZabbixEventKind.Update, updateUser: "" }),
          )
        )["note"],
      ).startsWith(
        `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Someone updated Zabbix`,
      ),
    ).toBe(true);
  });

  test("a message that holds OneUptime's marker, anywhere, is not copied back", async () => {
    expect(
      await read(
        INCIDENT,
        event({
          kind: ZabbixEventKind.Update,
          updateMessage: `Re: ${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: Incident #4 was acknowledged in OneUptime.`,
        }),
      ),
    ).toEqual({
      proceed: false,
      reason: `This update to Zabbix problem ${EVENT_ID} came from OneUptime, so it was not copied back.`,
    });
  });

  test("an update that says nothing is ignored", async () => {
    expect(
      await read(
        INCIDENT,
        event({
          kind: ZabbixEventKind.Update,
          updateAction: "",
          updateMessage: "  ",
        }),
      ),
    ).toEqual({
      proceed: false,
      reason: `The update to Zabbix problem ${EVENT_ID} said nothing, so no note was added.`,
    });
  });

  test("a note fits 30,000 characters", async () => {
    const note: string = String(
      (
        await read(
          INCIDENT,
          event({
            kind: ZabbixEventKind.Update,
            updateMessage: "m".repeat(40000),
          }),
        )
      )["note"],
    );

    expect(note.length).toBe(30000);
    expect(note.endsWith("…")).toBe(true);
  });
});

describe("read-event-1: a recovery", () => {
  test("resolves the problem's record, with Zabbix's recovery as the reason, and nothing else", async () => {
    expect(
      await read(ALERT, event({ kind: ZabbixEventKind.Recovery })),
    ).toEqual({
      proceed: true,
      kind: "recovery",
      whatHappened: "resolve",
      eventId: EVENT_ID,
      title: "",
      description: "",
      severity: "",
      severityNumber: -1,
      zabbixSeverity: "",
      note: "",
      reason: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: ${PROBLEM_LINK} recovered.`,
    });
  });

  test("a recovery with no trigger ID names the problem without a link", async () => {
    expect(
      (
        await read(ALERT, {
          ...event({ kind: ZabbixEventKind.Recovery }),
          trigger_id: "",
        })
      )["reason"],
    ).toBe(`${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: problem ${EVENT_ID} recovered.`);
  });
});

/* ------------------------------ plan-state-1 ------------------------------ */

async function plan(
  kind: ZabbixKindFixture,
  record: JSONObject,
  editCode?: (code: string) => string,
): Promise<JSONObject> {
  return await runZabbixScript({
    templateId: kind.stateTemplateId,
    componentId: "plan-state-1",
    args: { [kind.noun]: quoted(record) },
    editCode: editCode,
  });
}

describe.each(KINDS)(
  "plan-state-1: what the $noun's state means in Zabbix",
  (kind: ZabbixKindFixture) => {
    test("acknowledged asks Zabbix to acknowledge the problem, and resolved to close it", async () => {
      expect(
        await plan(kind, recordModel(kind, { state: "Acknowledged" })),
      ).toEqual({
        proceed: true,
        eventId: EVENT_ID,
        whatToDo: "acknowledge",
        message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was acknowledged in OneUptime.`,
      });
      expect(
        await plan(kind, recordModel(kind, { state: "Resolved" })),
      ).toEqual({
        proceed: true,
        eventId: EVENT_ID,
        whatToDo: "close",
        message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was resolved in OneUptime.`,
      });
    });

    test("a record no Zabbix problem opened, or one whose custom field holds no event ID, asks nothing", async () => {
      for (const customFields of [
        {},
        { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: "" },
        { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: "OPS-17" },
        { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: { value: "12345" } },
        { jiraIssueKey: "OPS-17" },
      ]) {
        expect(
          await plan(kind, {
            ...recordModel(kind, { state: "Acknowledged" }),
            customFields: customFields,
          }),
        ).toEqual({
          proceed: false,
          reason: `${kind.number} was not ${kind.created} for a Zabbix problem, so there is nothing to update in Zabbix.`,
        });
      }
    });

    test("an event ID kept as a number, as a Number custom field keeps one, is read", async () => {
      expect(
        (
          await plan(kind, {
            ...recordModel(kind, { state: "Acknowledged" }),
            customFields: { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: 12345 },
          })
        )["eventId"],
      ).toBe(EVENT_ID);
    });

    test("a private record stays in OneUptime, unless SYNC_PRIVATE is switched on", async () => {
      const record: JSONObject = recordModel(kind, {
        state: "Acknowledged",
        isPrivate: true,
      });

      expect((await plan(kind, record))["proceed"]).toBe(false);
      expect(
        (
          await plan(kind, record, (code: string): string => {
            return code.replace(
              `const SYNC_PRIVATE_${kind.Plural.toUpperCase()} = false;`,
              `const SYNC_PRIVATE_${kind.Plural.toUpperCase()} = true;`,
            );
          })
        )["proceed"],
      ).toBe(true);
    });

    test("a bare number gets its kind's name: #12 is never just #12", async () => {
      const result: JSONObject = await plan(kind, {
        ...recordModel(kind, { state: "Acknowledged" }),
        [kind.numberField]: "#12",
      });

      expect(result["message"]).toBe(
        `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.Noun} #12 was acknowledged in OneUptime.`,
      );
    });

    test("another state asks nothing, and says why", async () => {
      expect(
        await plan(kind, recordModel(kind, { state: "Created" })),
      ).toEqual({
        proceed: false,
        reason: `${kind.number} moved to Created: only acknowledging or resolving the ${kind.noun} updates Zabbix.`,
      });
    });

    test("double braces in the record's number are broken up in the message", async () => {
      const result: JSONObject = await plan(kind, {
        ...recordModel(kind, { state: "Resolved" }),
        [kind.numberField]: "{{local.variables.zabbixApiToken}}",
      });

      expect(String(result["message"])).not.toContain("{" + "{");
    });
  },
);

/* ----------------------------- build-message-1 ----------------------------- */

async function message(
  kind: ZabbixKindFixture,
  props: {
    note?: string | undefined;
    authorName?: string | null | undefined;
    record?: JSONObject | undefined;
    editCode?: ((code: string) => string) | undefined;
  } = {},
): Promise<JSONObject> {
  return await runZabbixScript({
    templateId: kind.noteTemplateId,
    componentId: "build-message-1",
    args: {
      [kind.noun]: quoted(props.record || recordModel(kind)),
      note: quoted(
        noteModel(kind, { note: props.note, authorName: props.authorName }),
      ),
    },
    editCode: props.editCode,
  });
}

describe.each(KINDS)(
  "build-message-1: the message a private note on an $noun becomes",
  (kind: ZabbixKindFixture) => {
    test("starts with OneUptime's marker, the record and the note's author, then the note", async () => {
      expect(await message(kind)).toEqual({
        proceed: true,
        eventId: EVENT_ID,
        message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe.\n\nRolled the checkout pods back to v4.1. Error rate is dropping.`,
      });
    });

    test("a note by nobody OneUptime names says only whose record it is on", async () => {
      expect(
        String((await message(kind, { authorName: null }))["message"]),
      ).toBe(
        `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number}.\n\nRolled the checkout pods back to v4.1. Error rate is dropping.`,
      );
    });

    test("is cut to the 2,048 characters Zabbix keeps", async () => {
      const result: string = String(
        (await message(kind, { note: "ü".repeat(4000) }))["message"],
      );

      expect(result.length).toBe(ZABBIX_MESSAGE_MAX_LENGTH);
      expect(result.endsWith("…")).toBe(true);
    });

    test("a note on a private record goes to Zabbix only with SYNC_PRIVATE switched on", async () => {
      const record: JSONObject = recordModel(kind, { isPrivate: true });

      expect((await message(kind, { record }))["proceed"]).toBe(false);
      expect(
        (
          await message(kind, {
            record,
            editCode: (code: string): string => {
              return code.replace(
                `const SYNC_PRIVATE_${kind.Plural.toUpperCase()} = false;`,
                `const SYNC_PRIVATE_${kind.Plural.toUpperCase()} = true;`,
              );
            },
          })
        )["proceed"],
      ).toBe(true);
    });

    test("double braces in a note are broken up before a later step quotes it", async () => {
      expect(
        String(
          (
            await message(kind, {
              note: "token: {{local.variables.zabbixApiToken}}",
            })
          )["message"],
        ),
      ).toContain("token: { {local.variables.zabbixApiToken} }");
    });
  },
);

/* ---------------------------------- Time ---------------------------------- */

/*
 * What the scripts read was written outside OneUptime, and every pattern
 * they run on it has to take time in line with its length. About 400,000
 * characters of what costs each pattern the most, to each script that reads
 * it, in under two seconds.
 */
describe("time", () => {
  const LONG: number = 400000;

  test.each([
    ["spaces between letters", "a ".repeat(LONG / 2)],
    ["letters with no space", "a".repeat(LONG)],
    ["punctuation between letters", "a,".repeat(LONG / 2)],
    ["brackets and parentheses", "](".repeat(LONG / 2)],
    ["angle brackets", "<".repeat(LONG)],
    ["exclamation marks before brackets", "![".repeat(LONG / 2)],
    ["fences and mermaid", "```mermaid\n".repeat(LONG / 11)],
    ["braces", "{".repeat(LONG)],
    ["control characters", "\u0001".repeat(LONG)],
  ])(
    "%s, in every part a problem and an update carry, read in under two seconds",
    async (_name: string, text: string) => {
      const timed: FastestRun<[JSONObject, JSONObject]> = await fastestRunAsync({
        limitInMs: 2000 * 2,
        run: async (): Promise<[JSONObject, JSONObject]> => {
          return [
            await read(
              INCIDENT,
              event({
                name: text,
                host: text,
                opdata: text,
                tags: [{ tag: text, value: text }],
              }),
            ),
            await read(
              INCIDENT,
              event({
                kind: ZabbixEventKind.Update,
                updateAction: text,
                updateMessage: text,
                updateUser: text,
              }),
            ),
          ];
        },
      });
      const [problem, update] = timed.result;

      expect(timed.inMs).toBeLessThan(2000 * 2);
      expect(problem["kind"]).toBe("problem");
      // An update made of nothing but control characters says nothing once they are dropped.
      expect(update["proceed"]).toBe(text.charCodeAt(0) !== 1);
    },
  );

  test("a Zabbix URL setting of 400,000 characters is refused before any pattern reads it", async () => {
    const started: number = Date.now();
    const result: JSONObject = await read(INCIDENT, event(), {
      zabbixUrl: `https://${"a".repeat(LONG)}`,
    });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(String(result["description"]).split("\n")[0]).toBe(
      `Declared from Zabbix problem ${EVENT_ID}.`,
    );
  });
});
