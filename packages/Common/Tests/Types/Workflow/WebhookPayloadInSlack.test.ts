/*
 * WHAT IS POSTED TO A WEBHOOK, SHOWN IN SLACK AS IT WAS SENT.
 *
 * The webhook-to-slack template ("Post anything you send to a webhook into
 * Slack") posts the body of every request its webhook receives into a Slack
 * channel, inside a code block: its script (format-payload-1) writes the
 * body out, and the Slack step puts what it returns between two fences of
 * three backticks. Whoever has the webhook's address chooses that body.
 *
 * Slack reads "&", "<" and ">" everywhere in a message, a code block too
 * (Slack's "Formatting message text": they "must be converted to HTML
 * entities if they're not going to be used for their parsing purpose"), and
 * a code block can hold a link. So "<!channel>" in a body reached the
 * channel as a mention, "<https://...|words>" as a link whose words hide
 * where it goes, and "&lt;" showed as "<". The script turned three backticks
 * into three quotes, so a body with a fence in it did not read as it was
 * sent, and a body that started or ended with a backtick ran into a fence.
 *
 * The script now writes "&", "<" and ">" as Slack's own apps write them
 * (SlackUtil.escapeSlackText), and puts an invisible word joiner (U+2060)
 * between two backticks side by side and between a backtick and either
 * fence. These tests:
 *
 *   - run the template's own script in the workflow sandbox (isolated-vm),
 *     and the script it replaced beside it;
 *   - hold it to the script it replaced on payloads with none of those
 *     characters - real webhook bodies, and generated ones - which it
 *     writes exactly as before, cut at the same place;
 *   - hold its escaping to SlackUtil.escapeSlackText on generated payloads;
 *   - read every message as Slack reads a code block - from a fence to the
 *     next - and check that the payload stays inside its block, that the
 *     block reads exactly as the payload was sent, and that no "<" or "&"
 *     in the message starts anything Slack acts on: no mention, link or
 *     date;
 *   - check that a long payload still fits the one Slack section it always
 *     did, and that the cut never splits a character or an entity;
 *   - run the whole template - the webhook, the script, the substitution
 *     and the real Slack step - and read the blocks it posts;
 *   - and guard every template: no message a template sends to people
 *     quotes what a webhook or an email sent the workflow, or another
 *     system answered it, except through a script these tests check.
 */

import VMRunner from "../../../Server/Utils/VM/VMRunner";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { scriptOf } from "./JiraTemplateFixtures";
import {
  SimulatedReply,
  SimulatedRequest,
  SimulationTrace,
  runTemplate,
} from "./WorkflowTemplateSimulator";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(120000);

const TEMPLATE_ID: string = "webhook-to-slack";
const STEP: string = "format-payload-1";
const SLACK_STEP: string = "slack-1";
const SLACK_WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/XXXX";

const J: string = WORD_JOINER;
const BACKTICK: string = "`";
const FENCE: string = "```";
const TRUNCATED_NOTE: string = "\n… payload truncated";
// How long the script lets a payload be, as it writes it.
const MAX_LENGTH: number = 2800;
// What the Slack step writes before the payload's code block.
const HEADER: string = ":inbox_tray: *Webhook received*\n*Payload:*\n";

const WORD_JOINER_RUN: RegExp = new RegExp(WORD_JOINER, "g");
const TWO_BACKTICKS: RegExp = /``/;
// A mention, a channel, a date or a link, as Slack reads one: right after a "<".
const SLACK_SEQUENCE: RegExp = /<[!@#A-Za-z]/;
// An "&" that is not one of the three entities Slack reads.
const STRAY_AMPERSAND: RegExp = /&(?!amp;|lt;|gt;)/;
const LONE_SURROGATE: RegExp =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/*
 * The script the template carried before this change, exactly as it was:
 * the oracle for payloads it already wrote as they were sent.
 */
const SCRIPT_BEFORE: string = [
  "const payload = typeof args === 'string' ? args : JSON.stringify(args || {}, null, 2);",
  "const safePayload = payload.replace(/```/g, \"'''\");",
  "const maxLength = 2800;",
  "",
  "return safePayload.length > maxLength",
  "  ? `${safePayload.slice(0, maxLength)}\\n… payload truncated`",
  "  : safePayload;",
].join("\n");

/* ------------------------------ Running it ------------------------------ */

async function runScript(code: string, args: JSONValue): Promise<string> {
  const result: ReturnResult = await VMRunner.runCodeInSandbox({
    code: code,
    options: { args: args as JSONObject, timeout: 5000 },
  });

  if (result.scriptError) {
    throw result.scriptError;
  }

  if (typeof result.returnValue !== "string") {
    throw new Error(
      `The script returned ${JSON.stringify(result.returnValue)}`,
    );
  }

  return result.returnValue;
}

/*
 * The script on many payloads at once, in one sandbox run: its code is the
 * body of a function, called on each payload in turn.
 */
async function runScriptOnEach(
  code: string,
  payloads: Array<JSONValue>,
): Promise<Array<string>> {
  const harness: string = [
    "const write = (args) => {",
    code,
    "};",
    "return (Array.isArray(args.payloads) ? args.payloads : []).map((payload) => write(payload));",
  ].join("\n");
  const result: ReturnResult = await VMRunner.runCodeInSandbox({
    code: harness,
    options: { args: { payloads: payloads }, timeout: 60000 },
  });

  if (result.scriptError) {
    throw result.scriptError;
  }

  return result.returnValue as Array<string>;
}

function templateScript(): string {
  return scriptOf(TEMPLATE_ID, STEP);
}

// The Slack step's text, as the template writes it, with the script's answer put in.
function messageWith(written: string): string {
  const spec: { nodes: Array<JSONObject> } | null = getTemplateGraphSpec(
    TEMPLATE_ID,
  ) as unknown as { nodes: Array<JSONObject> } | null;
  const slack: JSONObject | undefined = spec?.nodes.find(
    (node: JSONObject): boolean => {
      return node["componentId"] === SLACK_STEP;
    },
  );
  const text: string = String((slack?.["args"] as JSONObject)["text"]);
  const reference: string = `{{local.components.${STEP}.returnValues.returnValue}}`;

  if (text.split(reference).length !== 2) {
    throw new Error(`The Slack step does not quote ${reference} once.`);
  }

  return text.split(reference).join(written);
}

/* ------------------------- Reading it as Slack does ------------------------- */

// Text as Slack shows it: the three entities it reads, and nothing else.
function shownBySlack(text: string): string {
  return text
    .split("&lt;")
    .join("<")
    .split("&gt;")
    .join(">")
    .split("&amp;")
    .join("&");
}

interface SlackReading {
  // The text before the first fence, in each code block, and between them.
  pieces: Array<string>;
  // What the one code block holds, when there is exactly one.
  block: string | null;
}

/*
 * A message as Slack's mrkdwn reads its code blocks: a fence opens one and
 * the next fence closes it, whatever is between them.
 */
function readAsSlack(message: string): SlackReading {
  const pieces: Array<string> = message.split(FENCE);

  return {
    pieces: pieces,
    block:
      pieces.length === 3 && pieces[2] === "" && !pieces[1]!.startsWith("`")
        ? pieces[1]!
        : null,
  };
}

/*
 * What the payload reads as in Slack: the code block's text as Slack shows
 * it, with the joiners the script put between backticks taken out. For a
 * payload with no joiner of its own.
 */
function payloadAsRead(written: string): string {
  return shownBySlack(written.replace(WORD_JOINER_RUN, ""));
}

/*
 * Generated texts can be empty: an empty payload is its own case ("a payload
 * that is text"), as no request body arrives as one.
 */
function nonEmpty(text: string): boolean {
  return text.length > 0;
}

// What JSON.stringify writes for the payload: what the script starts from.
function asSent(payload: JSONValue): string {
  return typeof payload === "string"
    ? payload
    : JSON.stringify(payload || {}, null, 2);
}

/* --------------------------------- Payloads --------------------------------- */

/*
 * Bodies real services POST to a webhook, trimmed: none holds "&", "<", ">"
 * or a backtick, so each is written exactly as before.
 */
const ORDINARY_PAYLOADS: Array<[string, JSONValue]> = [
  [
    "a Prometheus Alertmanager notification",
    {
      receiver: "oneuptime",
      status: "firing",
      alerts: [
        {
          status: "firing",
          labels: {
            alertname: "HighErrorRate",
            severity: "critical",
            instance: "api-7f9c:9090",
          },
          annotations: {
            summary: "Error rate above 5% for 10 minutes",
            runbook_url: "https://runbooks.example.com/high-error-rate",
          },
          startsAt: "2026-10-11T09:40:00.000Z",
          endsAt: "0001-01-01T00:00:00Z",
          fingerprint: "c4a1d2b3e4f5a6b7",
        },
      ],
      groupLabels: { alertname: "HighErrorRate" },
      externalURL: "http://alertmanager.example.com:9093",
      version: "4",
    },
  ],
  [
    "a GitHub push event",
    {
      ref: "refs/heads/main",
      before: "6113728f27ae82c7b1a177c8d03f9e96e0adf246",
      after: "0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c",
      repository: { full_name: "acme/checkout", private: true },
      pusher: { name: "jane-doe", email: "jane@contoso.com" },
      head_commit: {
        message: "Fix the retry loop in the payment client\n\nCloses #42",
        author: { name: "Jane Doe", email: "jane@contoso.com" },
      },
    },
  ],
  [
    "an Elastic watch with an @timestamp",
    {
      "@timestamp": "2026-10-11T09:40:02.118Z",
      "@version": "1",
      host: { name: "web-01" },
      message: "disk usage at 93% on /var/lib/postgresql",
      tags: ["prod", "disk"],
    },
  ],
  [
    "a Dataverse row with OData annotations",
    {
      "@odata.context":
        "https://acme.crm.dynamics.com/api/data/v9.2/$metadata#incidents/$entity",
      "@odata.etag": 'W/"4410925"',
      incidentid: "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Customers in the EU cannot complete checkout",
    },
  ],
  [
    "other scripts, emoji and escapes JSON writes",
    {
      summary: "数据库连接失败 — 確認お願いします",
      status: "🔥 down",
      path: "C:\\Program Files\\Agent",
      quote: 'She said "retry"',
      tab: "a\tb",
    },
  ],
  ["an empty body", {}],
  ["a list", [1, "two", { three: 3 }, null, true]],
  [
    "a body longer than the message shows",
    {
      lines: Array.from({ length: 120 }, (_value: unknown, index: number) => {
        return `line ${index}: checkout latency p99 at ${(index * 7) % 997} ms`;
      }),
    },
  ],
];

/*
 * Bodies with what Slack acts on, and what each reads as now. Without the
 * fences and the joiners, each reads exactly as it was sent.
 */
const ACTING_PAYLOADS: Array<[string, JSONValue]> = [
  ["a channel mention", { text: "<!channel> deploy is broken" }],
  ["a here mention", { text: "<!here>" }],
  ["an everyone mention", { text: "<!everyone> read this" }],
  ["a user mention", { owner: "<@U0123ABC>" }],
  ["a channel link", { room: "<#C0123ABC>" }],
  ["a group mention", { team: "<!subteam^S0123ABC>" }],
  [
    "a date",
    { at: "<!date^1392734382^Posted {date_num} {time_secs}|Feb 18, 2014>" },
  ],
  [
    "a link whose words hide where it goes",
    { runbook: "<https://evil.example/login|Open the runbook>" },
  ],
  ["a mail link", { contact: "<mailto:ops@evil.example|the on-call team>" }],
  ["HTML", { body: '<img src=x onerror=alert(1)> <a href="x">y</a>' }],
  ["entities the sender wrote", { html: "&lt;b&gt;bold&lt;/b&gt; &amp;" }],
  [
    "a fence, and a mention after it",
    { text: "```\n<!channel> the block ended, so this is a message" },
  ],
  ["four backticks", { text: "````" }],
  ["a fence that opens a language", { text: "```js\nalert(1)\n```" }],
  ["comparisons and an arrow", { rule: "p99 < 200ms && errors > 1%, a -> b" }],
];

/* ------------------------------ The script itself ------------------------------ */

describe("the script", () => {
  test("is the template's format-payload step, and the Slack step quotes what it returns inside one code block", () => {
    expect(templateScript()).toContain("const MAX_LENGTH = 2800;");
    expect(messageWith("X")).toBe(`${HEADER}${FENCE}X${FENCE}`);
  });

  test("parses, and holds nothing the runtime would substitute", () => {
    const code: string = templateScript();

    expect(code).not.toContain("{{");
    expect(code).not.toContain("}}");
    expect(code).not.toContain("${");
    expect(code).not.toContain(BACKTICK);
    expect(code).not.toContain(WORD_JOINER);
    expect(() => {
      // eslint-disable-next-line no-new-func
      return new Function("args", code);
    }).not.toThrow();
  });

  test("escapes as SlackUtil.escapeSlackText does: '&', '<' and '>'", () => {
    expect(SlackUtil.escapeSlackText("a & b < c > d")).toBe(
      "a &amp; b &lt; c &gt; d",
    );
  });
});

/* ---------------------------- Exactly as before ---------------------------- */

describe("a payload with nothing in it Slack acts on", () => {
  let before: Array<string> = [];
  let now: Array<string> = [];
  const generated: Array<string> = generatedTexts(4000, 1201, [
    "a",
    "Z",
    "0",
    "9",
    " ",
    "\n",
    "\t",
    '"',
    "'",
    "{",
    "}",
    "[",
    "]",
    ":",
    ",",
    "@",
    "!",
    "#",
    "|",
    "*",
    "_",
    "~",
    "\\",
    "/",
    ".",
    "-",
    "é",
    "語",
    "😀",
  ]).filter(nonEmpty);
  const payloads: Array<JSONValue> = [
    ...ORDINARY_PAYLOADS.map((entry: [string, JSONValue]): JSONValue => {
      return entry[1];
    }),
    ...generated.map((text: string): JSONValue => {
      return { text: text };
    }),
    ...generated.slice(0, 500),
    // Long enough to be cut, with a character outside the BMP nowhere near the cut.
    { text: "x".repeat(5000) },
    "y".repeat(2800),
    "y".repeat(2801),
  ];

  beforeAll(async () => {
    before = await runScriptOnEach(SCRIPT_BEFORE, payloads);
    now = await runScriptOnEach(templateScript(), payloads);
  });

  test("is written exactly as before, and cut at the same place", () => {
    expect(now).toHaveLength(payloads.length);
    expect(
      payloads.filter((_payload: JSONValue, index: number): boolean => {
        return now[index] !== before[index];
      }),
    ).toEqual([]);
  });

  test("real webhook bodies are posted as JSON.stringify writes them", () => {
    ORDINARY_PAYLOADS.forEach(
      ([name, payload]: [string, JSONValue], index: number): void => {
        const sent: string = asSent(payload);
        const expected: string =
          sent.length > MAX_LENGTH
            ? sent.slice(0, MAX_LENGTH) + TRUNCATED_NOTE
            : sent;

        expect({ name, written: now[index] }).toEqual({
          name,
          written: expected,
        });
      },
    );
  });

  test("the generated payloads are many different ones", () => {
    expect(new Set(generated).size).toBeGreaterThan(3500);
  });
});

/* ------------------------------ Slack's escaping ------------------------------ */

describe("a payload with '&', '<' or '>' in it", () => {
  const generated: Array<string> = generatedTexts(6000, 4099, [
    "&",
    "<",
    ">",
    "!",
    "@",
    "#",
    "|",
    "^",
    "a",
    "U",
    "1",
    ";",
    "l",
    "t",
    "g",
    "m",
    "p",
    " ",
    "\n",
    ":",
    "/",
    "😀",
  ]).filter(nonEmpty);
  let written: Array<string> = [];

  beforeAll(async () => {
    written = await runScriptOnEach(templateScript(), generated);
  });

  test("is written exactly as SlackUtil.escapeSlackText writes it", () => {
    expect(
      generated.filter((payload: string, index: number): boolean => {
        return written[index] !== SlackUtil.escapeSlackText(payload);
      }),
    ).toEqual([]);
  });

  test("holds no '<' or '>' at all, and no '&' but the three entities Slack reads", () => {
    for (const text of written) {
      expect(text).not.toContain("<");
      expect(text).not.toContain(">");
      expect(text).not.toMatch(STRAY_AMPERSAND);
    }
  });

  test("reads in Slack exactly as it was sent", () => {
    expect(
      generated.filter((payload: string, index: number): boolean => {
        return shownBySlack(written[index]!) !== payload;
      }),
    ).toEqual([]);
  });

  test("the generated payloads are many different ones", () => {
    expect(new Set(generated).size).toBeGreaterThan(5000);
  });
});

/* ----------------------------- Inside its block ----------------------------- */

describe("a payload with backticks in it", () => {
  const generated: Array<string> = generatedTexts(6000, 7331, [
    "`",
    "`",
    "``",
    "```",
    "a",
    " ",
    "\n",
    "<",
    "&",
    "!",
    "j",
    "s",
  ]).filter(nonEmpty);
  let written: Array<string> = [];

  beforeAll(async () => {
    written = await runScriptOnEach(templateScript(), generated);
  });

  test("never puts two backticks side by side, nor a backtick next to a fence", () => {
    for (const text of written) {
      expect(text).not.toMatch(TWO_BACKTICKS);
      expect(text.startsWith(BACKTICK)).toBe(false);
      expect(text.endsWith(BACKTICK)).toBe(false);
    }
  });

  test("stays inside the message's one code block, which reads exactly as it was sent", () => {
    const misread: Array<string> = generated.filter(
      (payload: string, index: number): boolean => {
        const reading: SlackReading = readAsSlack(messageWith(written[index]!));

        return (
          reading.block === null || payloadAsRead(reading.block) !== payload
        );
      },
    );

    expect(misread).toEqual([]);
  });

  test("gets joiners and nothing else: a joiner between two backticks, and between a backtick and a fence", () => {
    expect(
      written.map((text: string): number => {
        return text.split(J).length - 1;
      }),
    ).toEqual(
      generated.map((payload: string): number => {
        const pairs: number = payload
          .split("")
          .filter((character: string, index: number): boolean => {
            return character === BACKTICK && payload.charAt(index + 1) === "`";
          }).length;

        return (
          pairs +
          (payload.startsWith(BACKTICK) ? 1 : 0) +
          (payload.endsWith(BACKTICK) ? 1 : 0)
        );
      }),
    );
  });

  test("the generated payloads are many different ones", () => {
    expect(new Set(generated).size).toBeGreaterThan(5000);
  });
});

/* -------------------------- What each one reads as -------------------------- */

describe("what Slack would act on", () => {
  let written: Array<string> = [];
  let before: Array<string> = [];

  beforeAll(async () => {
    const payloads: Array<JSONValue> = ACTING_PAYLOADS.map(
      (entry: [string, JSONValue]): JSONValue => {
        return entry[1];
      },
    );

    written = await runScriptOnEach(templateScript(), payloads);
    before = await runScriptOnEach(SCRIPT_BEFORE, payloads);
  });

  test.each(
    ACTING_PAYLOADS.map((entry: [string, JSONValue], index: number) => {
      return [entry[0], index] as [string, number];
    }),
  )(
    "%s stays inside the code block, reads exactly as it was sent, and starts nothing",
    (_name: string, index: number) => {
      const payload: JSONValue = ACTING_PAYLOADS[index]![1];
      const message: string = messageWith(written[index]!);
      const reading: SlackReading = readAsSlack(message);

      expect(reading.block).not.toBeNull();
      expect(payloadAsRead(reading.block!)).toBe(asSent(payload));
      expect(message).not.toMatch(SLACK_SEQUENCE);
      expect(message).not.toMatch(STRAY_AMPERSAND);
    },
  );

  test("as the script wrote them before, each was something Slack reads, or changed what it said", () => {
    // So the tests above are not passing on payloads that were safe anyway.
    ACTING_PAYLOADS.forEach(
      ([name, payload]: [string, JSONValue], index: number): void => {
        const message: string = messageWith(before[index]!);
        const reading: SlackReading = readAsSlack(message);

        expect({
          name,
          actsOrChanges:
            SLACK_SEQUENCE.test(message) ||
            STRAY_AMPERSAND.test(message) ||
            reading.block === null ||
            shownBySlack(reading.block) !== asSent(payload),
        }).toEqual({ name, actsOrChanges: true });
      },
    );
  });

  test("a mention reads as its characters, and Slack is never handed one", () => {
    expect(written[0]).toBe(
      JSON.stringify({ text: "&lt;!channel&gt; deploy is broken" }, null, 2),
    );
    expect(written[7]).toBe(
      JSON.stringify(
        { runbook: "&lt;https://evil.example/login|Open the runbook&gt;" },
        null,
        2,
      ),
    );
  });

  test("a fence in the payload is written as it was sent, its backticks joined, so it ends nothing", () => {
    expect(written[11]).toBe(
      JSON.stringify(
        {
          text: `\`${J}\`${J}\`\n&lt;!channel&gt; the block ended, so this is a message`,
        },
        null,
        2,
      ),
    );
    // It used to read as three quotes.
    expect(before[11]).toContain("'''");
  });
});

/* ------------------------------ Payloads as text ------------------------------ */

describe("a payload that is text", () => {
  /*
   * The webhook hands the script the body parsed from JSON, so text arrives
   * only from a workflow of the user's own. It is written for its code block
   * all the same.
   */
  const CASES: Array<[string, string, string]> = [
    ["a backtick at each end", "`code`", `${J}\`code\`${J}`],
    ["only backticks", "```", `${J}\`${J}\`${J}\`${J}`],
    ["one backtick", "`", `${J}\`${J}`],
    ["joiners of its own between backticks", `\`${J}\``, `${J}\`${J}\`${J}`],
    ["markup", "<b>&</b>", "&lt;b&gt;&amp;&lt;/b&gt;"],
    // The two fences would meet, so a joiner keeps them apart.
    ["nothing", "", J],
    [
      "plain words",
      "plain words, @here and #general",
      "plain words, @here and #general",
    ],
  ];
  let written: Array<string> = [];
  let before: Array<string> = [];

  beforeAll(async () => {
    const payloads: Array<string> = CASES.map(
      (entry: [string, string, string]): string => {
        return entry[1];
      },
    );

    written = await runScriptOnEach(templateScript(), payloads);
    before = await runScriptOnEach(SCRIPT_BEFORE, payloads);
  });

  test.each(
    CASES.map((entry: [string, string, string], index: number) => {
      return [entry[0], index] as [string, number];
    }),
  )("%s is written for its code block", (_name: string, index: number) => {
    const payload: string = CASES[index]![1];

    expect(written[index]).toBe(CASES[index]![2]);

    // The message's one code block holds exactly what the script wrote.
    expect(readAsSlack(messageWith(written[index]!)).block).toBe(
      written[index],
    );

    // Which reads as the payload, once the joiners the script added are out.
    if (!payload.includes(J)) {
      expect(payloadAsRead(written[index]!)).toBe(payload);
    }
  });

  test("text with neither backticks nor markup reads exactly as before", () => {
    const index: number = CASES.length - 1;

    expect(written[index]).toBe(before[index]);
  });
});

/* --------------------------------- Length --------------------------------- */

describe("a long payload", () => {
  test.each([
    ["markup", { html: "<b>&amp;</b>".repeat(800) }],
    ["ampersands", { text: "&".repeat(4000) }],
    ["backticks", { text: "`".repeat(4000) }],
    ["emoji", { text: "😀".repeat(3000) }],
    [
      "emoji after an odd number of characters",
      { text: `a${"😀".repeat(3000)}` },
    ],
    ["plain text", { text: "x".repeat(9000) }],
  ])(
    "of %s is cut to fit the one Slack section it always did, never inside a character or an entity",
    async (_name: string, payload: JSONValue) => {
      const written: string = await runScript(templateScript(), payload);
      const message: string = messageWith(written);
      const block: string = readAsSlack(message).block!;

      expect(written.endsWith(TRUNCATED_NOTE)).toBe(true);
      expect(written.length).toBeLessThanOrEqual(
        MAX_LENGTH + TRUNCATED_NOTE.length,
      );
      expect(message.length).toBeLessThanOrEqual(
        SlackUtil.SECTION_TEXT_MAX_LENGTH,
      );
      expect(SlackUtil.splitSectionText({ text: message })).toEqual([message]);
      expect(written).not.toMatch(LONE_SURROGATE);
      expect(written).not.toMatch(STRAY_AMPERSAND);
      expect(written).not.toMatch(TWO_BACKTICKS);

      // What it shows is the start of the payload, as it was sent.
      const shown: string = payloadAsRead(
        block.slice(0, block.length - TRUNCATED_NOTE.length),
      );

      expect(asSent(payload).startsWith(shown)).toBe(true);
      expect(shown.length).toBeGreaterThan(0);
    },
  );

  test("of exactly the limit is not cut, and one character more is", async () => {
    const atLimit: string = "a".repeat(MAX_LENGTH);

    expect(await runScript(templateScript(), atLimit)).toBe(atLimit);
    expect(await runScript(templateScript(), `${atLimit}b`)).toBe(
      atLimit + TRUNCATED_NOTE,
    );
  });

  test("is written in a moment, however long", async () => {
    const started: number = Date.now();

    await runScript(templateScript(), {
      text: "<`&>".repeat(250000),
    });

    expect(Date.now() - started).toBeLessThan(3000);
  });
});

/* --------------------------- The whole template --------------------------- */

const SLACK_OK: SimulatedReply = { status: 200, body: "ok" };

async function postedFor(payload: JSONValue): Promise<{
  trace: SimulationTrace;
  request: SimulatedRequest | undefined;
}> {
  const trace: SimulationTrace = await runTemplate({
    templateId: TEMPLATE_ID,
    trigger: {
      "request-headers": { "content-type": "application/json" },
      "request-params": {},
      "request-body": payload,
    },
    variables: { slackWebhookUrl: SLACK_WEBHOOK_URL },
    http: (): SimulatedReply => {
      return SLACK_OK;
    },
  });

  return { trace: trace, request: trace.requests[0] };
}

function postedText(request: SimulatedRequest | undefined): string {
  const blocks: Array<JSONObject> = ((request?.body as JSONObject)?.[
    "blocks"
  ] || []) as Array<JSONObject>;

  expect(blocks).toHaveLength(1);
  expect(blocks[0]!["type"]).toBe("section");

  return String((blocks[0]!["text"] as JSONObject)["text"]);
}

describe("the whole template, run as a workflow runs it", () => {
  test("posts an ordinary payload exactly as before: the JSON, in one code block", async () => {
    const payload: JSONValue = ORDINARY_PAYLOADS[0]![1];
    const { trace, request } = await postedFor(payload);

    expect(trace.executed).toEqual(["webhook-1", STEP, SLACK_STEP]);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(SLACK_WEBHOOK_URL);
    expect(postedText(request)).toBe(
      `${HEADER}${FENCE}${JSON.stringify(payload, null, 2)}${FENCE}`,
    );
  });

  test("posts a payload holding a fence and mentions as one code block that reads as it was sent", async () => {
    const payload: JSONValue = {
      text: "```\n<!channel> <@U0123ABC> <https://evil.example|Open the runbook>\n```",
      note: "Tom & Jerry",
    };
    const { request } = await postedFor(payload);
    const text: string = postedText(request);
    const reading: SlackReading = readAsSlack(text);

    expect(reading.pieces[0]).toBe(HEADER);
    expect(reading.block).not.toBeNull();
    expect(payloadAsRead(reading.block!)).toBe(asSent(payload));
    expect(text).not.toMatch(SLACK_SEQUENCE);
    expect(text).not.toMatch(STRAY_AMPERSAND);
  });

  test("posts a long payload in the one section it always did", async () => {
    const { request } = await postedFor({ html: "<p>&nbsp;</p>".repeat(2000) });
    const text: string = postedText(request);

    expect(text.length).toBeLessThanOrEqual(SlackUtil.SECTION_TEXT_MAX_LENGTH);
    expect(text.endsWith(`${TRUNCATED_NOTE}${FENCE}`)).toBe(true);
    expect(readAsSlack(text).block).not.toBeNull();
  });
});

/* ------------------------------- Every template ------------------------------- */

/*
 * Where text from outside OneUptime enters a workflow, by the step that
 * brings it and the outputs that hold it: what a webhook or an email sent
 * the workflow, and what another system answered an API step. An empty list
 * is every output of the step.
 */
const OUTSIDE_SOURCES: Record<string, Array<string>> = {
  [ComponentID.Webhook]: ["request-body", "request-headers", "request-params"],
  [ComponentID.IncomingEmail]: [],
  [ComponentID.ApiGet]: ["response-body", "response-headers"],
  [ComponentID.ApiPost]: ["response-body", "response-headers"],
  [ComponentID.ApiPut]: ["response-body", "response-headers"],
  [ComponentID.ApiPatch]: ["response-body", "response-headers"],
  [ComponentID.ApiDelete]: ["response-body", "response-headers"],
};

// The steps that send a message people read, and the settings that hold it.
const MESSAGE_STEPS: Record<string, Array<string>> = {
  [ComponentID.SlackSendMessageToChannel]: ["text"],
  [ComponentID.MicrosoftTeamsSendMessageToChannel]: ["text"],
  [ComponentID.DiscordSendMessageToChannel]: ["text"],
  [ComponentID.TelegramSendMessageToChat]: ["text"],
  [ComponentID.IRCSendMessageToChannel]: ["text"],
  [ComponentID.SendEmail]: ["subject", "email-body"],
};

/*
 * The scripts whose output a message may quote although it came from
 * outside: each writes it for that message, and these tests check it.
 */
const PLACING_SCRIPTS: Array<string> = [
  "webhook-to-slack format-payload-1 -> slack-1",
];

const STEP_OUTPUT_REFERENCE: RegExp =
  /\{\{local\.components\.([A-Za-z0-9-]+)\.returnValues\.([A-Za-z0-9_.-]+)\}\}/g;

interface GraphOf {
  id: string;
  nodes: Array<JSONObject>;
}

interface MessageQuote {
  templateId: string;
  // The step whose output the message quotes.
  step: string;
  message: string;
  // How the message has the outside text: straight from where it came in, or from a script.
  through: "source" | "script" | "step";
}

// Every reference to another step's output in a setting: the step, and the output's path.
function referencesIn(value: JSONValue | undefined): Array<[string, string]> {
  const text: string =
    typeof value === "string" ? value : JSON.stringify(value) || "";

  return Array.from(text.matchAll(STEP_OUTPUT_REFERENCE)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    },
  );
}

/*
 * Every message of these templates that quotes text from outside, and how:
 * a step carries outside text when one of its settings quotes some, from
 * where it came in or from another step that carries it.
 */
function quotesFromOutside(templates: Array<GraphOf>): Array<MessageQuote> {
  const quotes: Array<MessageQuote> = [];

  for (const template of templates) {
    const byId: Map<string, JSONObject> = new Map();

    for (const node of template.nodes) {
      byId.set(String(node["componentId"]), node);
    }

    const carriesOutside: Set<string> = new Set();
    const isOutside: (component: string, path: string) => boolean = (
      component: string,
      path: string,
    ): boolean => {
      const outputs: Array<string> | undefined =
        OUTSIDE_SOURCES[String(byId.get(component)?.["metadataId"])];

      if (outputs) {
        return (
          outputs.length === 0 ||
          outputs.some((output: string): boolean => {
            return path === output || path.startsWith(`${output}.`);
          })
        );
      }

      return carriesOutside.has(component);
    };

    // Until no step newly carries outside text: a chain of any length is followed.
    let changed: boolean = true;

    while (changed) {
      changed = false;

      for (const node of template.nodes) {
        const component: string = String(node["componentId"]);

        if (
          carriesOutside.has(component) ||
          OUTSIDE_SOURCES[String(node["metadataId"])]
        ) {
          continue;
        }

        const quotesOutside: boolean = Object.values(
          (node["args"] as JSONObject | undefined) || {},
        ).some((argument: JSONValue): boolean => {
          return referencesIn(argument).some(
            ([from, path]: [string, string]): boolean => {
              return isOutside(from, path);
            },
          );
        });

        if (quotesOutside) {
          carriesOutside.add(component);
          changed = true;
        }
      }
    }

    for (const node of template.nodes) {
      const settings: Array<string> =
        MESSAGE_STEPS[String(node["metadataId"])] || [];
      const args: JSONObject = (node["args"] as JSONObject | undefined) || {};

      for (const setting of settings) {
        for (const [from, path] of referencesIn(args[setting])) {
          if (!isOutside(from, path)) {
            continue;
          }

          const fromType: string = String(byId.get(from)?.["metadataId"]);

          quotes.push({
            templateId: template.id,
            step: from,
            message: String(node["componentId"]),
            through: OUTSIDE_SOURCES[fromType]
              ? "source"
              : fromType === ComponentID.JavaScriptCode
                ? "script"
                : "step",
          });
        }
      }
    }
  }

  return quotes;
}

// Every message of these templates that quotes text from outside other than through a listed script.
function unplacedQuotes(templates: Array<GraphOf>): Array<string> {
  return quotesFromOutside(templates)
    .filter((quote: MessageQuote): boolean => {
      return (
        quote.through !== "script" ||
        !PLACING_SCRIPTS.includes(
          `${quote.templateId} ${quote.step} -> ${quote.message}`,
        )
      );
    })
    .map((quote: MessageQuote): string => {
      return `${quote.templateId}: ${quote.message} quotes ${quote.step} (${quote.through})`;
    });
}

function everyTemplate(): Array<GraphOf> {
  return getWorkflowTemplates().map((template: { id: string }): GraphOf => {
    return {
      id: template.id,
      nodes:
        (
          getTemplateGraphSpec(template.id) as unknown as {
            nodes: Array<JSONObject>;
          } | null
        )?.nodes || [],
    };
  });
}

// A template of a few steps, for the checks of the walk itself.
function graph(
  id: string,
  ...nodes: Array<[string, string, JSONObject]>
): GraphOf {
  return {
    id: id,
    nodes: nodes.map(
      ([componentId, metadataId, args]: [string, string, JSONObject]) => {
        return { componentId, metadataId, args };
      },
    ),
  };
}

describe("every message a template sends", () => {
  test("quotes text from outside only through a script these tests check", () => {
    expect(unplacedQuotes(everyTemplate())).toEqual([]);
  });

  test("every script listed is still quoted by its message", () => {
    const quoted: Array<string> = quotesFromOutside(everyTemplate()).map(
      (quote: MessageQuote): string => {
        return `${quote.templateId} ${quote.step} -> ${quote.message}`;
      },
    );

    expect(
      PLACING_SCRIPTS.filter((entry: string): boolean => {
        return !quoted.includes(entry);
      }),
    ).toEqual([]);
  });

  test("finds a webhook's body quoted in a message, straight or through steps", () => {
    const body: string =
      "{{local.components.webhook-1.returnValues.request-body}}";

    expect(
      unplacedQuotes([
        // The body straight into a Slack message.
        graph(
          "straight",
          ["webhook-1", ComponentID.Webhook, {}],
          [
            "slack-1",
            ComponentID.SlackSendMessageToChannel,
            { text: "```" + body + "```" },
          ],
        ),
        // One field of it into a Teams message.
        graph(
          "one-field",
          ["webhook-1", ComponentID.Webhook, {}],
          [
            "teams-1",
            ComponentID.MicrosoftTeamsSendMessageToChannel,
            {
              text: "{{local.components.webhook-1.returnValues.request-body.alert.title}}",
            },
          ],
        ),
        // Through a script no test checks, and a JSON step after it, into an email.
        graph(
          "chained",
          ["webhook-1", ComponentID.Webhook, {}],
          ["script-1", ComponentID.JavaScriptCode, { arguments: body }],
          [
            "json-1",
            ComponentID.JsonToText,
            {
              json: "{{local.components.script-1.returnValues.returnValue}}",
            },
          ],
          [
            "email-1",
            ComponentID.SendEmail,
            {
              subject: "Webhook",
              "email-body":
                "{{local.components.json-1.returnValues.text}} {{local.components.script-1.returnValues.returnValue}}",
            },
          ],
        ),
        // Another system's answer into a Discord message.
        graph(
          "answer",
          ["api-1", ComponentID.ApiGet, { url: "https://example.com" }],
          [
            "discord-1",
            ComponentID.DiscordSendMessageToChannel,
            {
              text: "{{local.components.api-1.returnValues.response-body}}",
            },
          ],
        ),
      ]),
    ).toEqual([
      "straight: slack-1 quotes webhook-1 (source)",
      "one-field: teams-1 quotes webhook-1 (source)",
      "chained: email-1 quotes json-1 (step)",
      "chained: email-1 quotes script-1 (script)",
      "answer: discord-1 quotes api-1 (source)",
    ]);
  });

  test("leaves a message alone that quotes OneUptime's own records, or what did not come from outside", () => {
    expect(
      unplacedQuotes([
        graph(
          "own-record",
          ["incident-on-create-1", "incident-on-create", {}],
          [
            "slack-1",
            ComponentID.SlackSendMessageToChannel,
            {
              text: "{{local.components.incident-on-create-1.returnValues.model.title}}",
            },
          ],
        ),
        graph(
          "api-status",
          ["webhook-1", ComponentID.Webhook, {}],
          ["api-1", ComponentID.ApiPost, { url: "https://example.com" }],
          [
            "slack-1",
            ComponentID.SlackSendMessageToChannel,
            {
              text: "{{local.components.api-1.returnValues.error}} {{local.components.webhook-1.returnValues.request-received-at}}",
            },
          ],
        ),
      ]),
    ).toEqual([]);
  });
});
