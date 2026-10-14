import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OnCallPolicyRunMessageView, {
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";

/*
 * A RUN'S MESSAGE WHERE SOMEBODY PAGED FROM A CHAT.
 *
 * `/oneuptime page @nawaz The checkout API is throwing 500s` creates an
 * alert whose title is the message. Where the record's messages go, the
 * alert's own message is right above the run's, and says what it is about.
 * Where the page was asked from, nothing does - so there the run's message
 * says it, under its first line, as the person wrote it; and its
 * notification says it too. Everywhere else the message is as it was.
 */

const RUN_URL: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/execution-logs/run-1";
const RECORD_URL: string = "https://oneuptime.test/dashboard/p/alerts/al-12";
const RECORD: string = `**[Alert AL-12](${RECORD_URL})**`;
const TITLE: string = "The checkout API is throwing 500s";

function page(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "",
    policyUrl: "",
    directPage: { startedByPersonName: "Simon Lee" },
    runUrl: RUN_URL,
    recordLabel: "Alert AL-12",
    recordUrl: RECORD_URL,
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 0,
    escalateAfterInMinutes: 0,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [
      {
        name: "Nawaz Dhandala",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["push"],
        coveringFor: [],
      },
    ],
    notPaged: [],
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where the page was asked from: what it is about, under the first line", () => {
  test("paging", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(page(), { recordTitle: TITLE }),
    ).toBe(
      [
        `📟 **Simon Lee** is paging for ${RECORD}`,
        `“${TITLE}”`,
        "- **Nawaz Dhandala**: paged once · by push",
        `[See every step in OneUptime](${RUN_URL})`,
      ].join("\n\n"),
    );
  });

  test("acknowledged: still saying what it was about", () => {
    expect(
      OnCallPolicyRunMessageView.getMarkdown(
        page({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nawaz Dhandala",
        }),
        { recordTitle: TITLE },
      ).split("\n\n")[1],
    ).toBe(`“${TITLE}”`);
  });

  test("its notification says it too", () => {
    expect(
      OnCallPolicyRunMessageView.getPlainText(page(), { recordTitle: TITLE }),
    ).toBe(`Simon Lee is paging for Alert AL-12: ${TITLE}`);
    expect(
      OnCallPolicyRunMessageView.getPlainText(
        page({
          outcome: OnCallPolicyRunOutcome.Acknowledged,
          acknowledgedByName: "Nawaz Dhandala",
        }),
        { recordTitle: TITLE },
      ),
    ).toBe(`Nawaz Dhandala acknowledged Alert AL-12: ${TITLE}`);
  });

  test("a policy's run started for the page says it the same way", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      page({
        directPage: undefined,
        policyName: "DB Escalation",
        policyUrl: "https://oneuptime.test/dashboard/p/on-call-duty/policies/1",
        ruleCount: 2,
        currentRule: { order: 1 },
        nextRule: { order: 2 },
        escalateAfterInMinutes: 10,
      }),
      { recordTitle: TITLE },
    );

    expect(markdown.split("\n\n").slice(0, 3)).toEqual([
      `📟 **[DB Escalation](https://oneuptime.test/dashboard/p/on-call-duty/policies/1)** is paging for ${RECORD}`,
      `“${TITLE}”`,
      "**Escalation rule 1 of 2**: if nobody acknowledges within 10 minutes, escalation rule 2 is next.",
    ]);
  });

  test("the title is text, as the person wrote it: it cannot be a link, a mention or formatting", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(page(), {
      recordTitle: "[click](https://evil.example) **now** <!channel> _x_",
    });
    const line: string = markdown.split("\n\n")[1]!;

    expect(line).not.toContain("[click](https://evil.example)");
    expect(line).toContain("\\[click\\](https://evil.example)");
    expect(line).toContain("\\*\\*now\\*\\*");
    expect(line).not.toContain("<!channel>");
  });

  test("on one line, and cut where a chat line stops being read at a glance", () => {
    const title: string = `${"word ".repeat(100)}\n\nand more`;
    const shown: string = OnCallPolicyRunMessageView.getMarkdown(page(), {
      recordTitle: title,
    }).split("\n\n")[1]!;

    expect(shown.includes("\n")).toBe(false);
    // The quotes, and 300 characters at most between them.
    expect(shown.length).toBeLessThanOrEqual(302);
    expect(shown.endsWith("…”")).toBe(true);
    expect(
      OnCallPolicyRunMessageView.getPlainText(page(), { recordTitle: title })
        .length,
    ).toBeLessThanOrEqual("Simon Lee is paging for Alert AL-12: ".length + 300);
  });

  test("a record with no title, or one of spaces: no line for it", () => {
    for (const recordTitle of ["", "   ", undefined]) {
      expect(
        OnCallPolicyRunMessageView.getMarkdown(page(), {
          recordTitle: recordTitle,
        }),
      ).toBe(OnCallPolicyRunMessageView.getMarkdown(page()));
      expect(
        OnCallPolicyRunMessageView.getPlainText(page(), {
          recordTitle: recordTitle,
        }),
      ).toBe("Simon Lee is paging for Alert AL-12");
    }
  });
});

describe("everywhere else: the message as it was", () => {
  test("no title line, and the notification without it", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(page())).not.toContain(TITLE);
    expect(
      OnCallPolicyRunMessageView.getMarkdown(page()).split("\n\n")[1],
    ).toBe("- **Nawaz Dhandala**: paged once · by push");
    expect(OnCallPolicyRunMessageView.getPlainText(page())).toBe(
      "Simon Lee is paging for Alert AL-12",
    );
  });
});
