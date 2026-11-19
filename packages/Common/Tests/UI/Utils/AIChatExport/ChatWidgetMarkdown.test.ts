import { describe, expect, test } from "@jest/globals";
import {
  AIChatResourceCardOrigin,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import {
  citationsToMarkdown,
  toolActionsToMarkdown,
  widgetToMarkdown,
  widgetsToMarkdown,
} from "../../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";

/*
 * The chat caps how much of a widget it shows, and says so. An export that
 * quietly dropped the overflow — or quietly included it — would misrepresent
 * the answer either way, so the caps and their captions are pinned here.
 */

function rows(count: number): Array<JSONObject> {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return { name: `row-${index}` };
  });
}

describe("ChatWidgetMarkdown", () => {
  /*
   * A card in an exported conversation says each fact once, as the card in
   * the dialog does - a card saved before its facts were cut too.
   */
  describe("a resource card", () => {
    test("is its heading, its subheading and the facts they do not already say", () => {
      const markdown: string = widgetToMarkdown({
        id: "W1",
        type: AIChatWidgetType.ResourceCard,
        title: "Alert created",
        data: {
          resourceType: "Alert",
          heading: "ALT-12 · High memory usage on test01",
          subheading: "Severity: High",
          fields: [
            { label: "Number", value: "ALT-12" },
            { label: "Severity", value: "High" },
            { label: "State", value: "Created" },
          ],
        },
      });

      expect(markdown).toContain("_ALERT_");
      expect(markdown).toContain("**ALT-12 · High memory usage on test01**");
      expect(markdown).toContain("Severity: High");
      expect(markdown).toContain("- **State:** Created");
      expect(markdown).not.toContain("**Number:**");
      expect(markdown).not.toContain("**Severity:**");
    });

    test("with nothing left to say under them, it has no list at all", () => {
      const markdown: string = widgetToMarkdown({
        id: "W1",
        type: AIChatWidgetType.ResourceCard,
        title: "Incident created",
        data: {
          resourceType: "Incident",
          heading: "#42 · Payment API down",
          fields: [{ label: "Number", value: "#42" }],
        },
      });

      expect(markdown).toContain("**#42 · Payment API down**");
      expect(markdown).not.toContain("- **");
    });
  });

  /*
   * Issue #7395: a read's card was written under "#### Monitor
   * payments-api", and then "_MONITOR_" and "**payments-api**" again. The
   * chat draws no title over a read's card - its kind and its name are its
   * title - and the PDF no longer prints one (PR #7322). Its name is its
   * heading now, its kind beside its line.
   */
  describe("a read's card (issue #7395)", () => {
    const monitorCard: (
      data?: Partial<AIChatWidget["data"]> | undefined,
    ) => AIChatWidget = (
      data?: Partial<AIChatWidget["data"]> | undefined,
    ): AIChatWidget => {
      return {
        id: "W1",
        type: AIChatWidgetType.ResourceCard,
        title: "Monitor payments-api",
        data: {
          resourceType: "Monitor",
          heading: "payments-api",
          subheading: "Degraded",
          fields: [{ label: "Monitor type", value: "API" }],
          origin: AIChatResourceCardOrigin.Read,
          statusColor: "#f59e0b",
          ...(data || {}),
        },
      };
    };

    const count: (text: string, part: string) => number = (
      text: string,
      part: string,
    ): number => {
      return text.split(part).length - 1;
    };

    test("its name is its heading, its kind beside its line, then its facts", () => {
      expect(widgetToMarkdown(monitorCard())).toBe(
        [
          "#### payments-api",
          "",
          "_MONITOR_ · Degraded",
          "",
          "- **Monitor type:** API",
        ].join("\n"),
      );
    });

    test("its kind and its name appear once each, never its title", () => {
      const markdown: string = widgetToMarkdown(monitorCard());

      expect(count(markdown, "payments-api")).toBe(1);
      expect(count(markdown.toLowerCase(), "monitor")).toBe(2);
      // "MONITOR" once, and "Monitor type" - a fact's label, not the kind.
      expect(count(markdown, "MONITOR")).toBe(1);
      expect(markdown).not.toContain("Monitor payments-api");
      expect(markdown).not.toContain("**payments-api**");
      // One heading: the card's own.
      expect(markdown.match(/^#### /gm)).toHaveLength(1);
    });

    test("a card with no line: its kind alone under its name", () => {
      expect(widgetToMarkdown(monitorCard({ subheading: undefined }))).toBe(
        [
          "#### payments-api",
          "",
          "_MONITOR_",
          "",
          "- **Monitor type:** API",
        ].join("\n"),
      );
    });

    test("a card with nothing but its name: the heading alone", () => {
      expect(
        widgetToMarkdown(
          monitorCard({
            resourceType: undefined,
            subheading: undefined,
            fields: [],
          }),
        ),
      ).toBe("#### payments-api");
    });

    test("a fact its line already says is left out, as the card leaves it out", () => {
      const markdown: string = widgetToMarkdown(
        monitorCard({
          fields: [
            { label: "Status", value: "Degraded" },
            { label: "Monitor type", value: "API" },
          ],
        }),
      );

      expect(markdown).not.toContain("**Status:**");
      expect(markdown).toContain("- **Monitor type:** API");
    });

    test("its name and its line are text, never Markdown: a heading of their own, a link or an image", () => {
      const markdown: string = widgetToMarkdown(
        monitorCard({
          heading:
            "pay_ments [docs](https://example.com) ![x](https://example.com/t.png)",
          subheading: "Degraded *now*\n# Not a heading",
        }),
      );
      const [heading, , kindAndLine]: Array<string> = markdown.split("\n");

      // An "_" inside a word never starts emphasis, so it stays as typed.
      expect(heading).toBe(
        "#### pay_ments \\[docs\\](https://example.com) !\\[x\\](https://example.com/t.png)",
      );
      expect(kindAndLine!.startsWith("_MONITOR_ · Degraded \\*now\\*")).toBe(
        true,
      );
      // The line stays one line: nothing in it starts a heading.
      expect(markdown.match(/^#/gm)).toHaveLength(1);
    });

    test("a write's card keeps its title, which says what was done", () => {
      const markdown: string = widgetToMarkdown({
        id: "W2",
        type: AIChatWidgetType.ResourceCard,
        title: "Alert created",
        data: {
          resourceType: "Alert",
          heading: "ALT-12 · High memory usage on test01",
          subheading: "Severity: High",
          fields: [{ label: "State", value: "Created" }],
          origin: AIChatResourceCardOrigin.Write,
        },
      });

      expect(markdown).toBe(
        [
          "#### Alert created",
          "",
          "_ALERT_",
          "",
          "**ALT-12 · High memory usage on test01**",
          "Severity: High",
          "",
          "- **State:** Created",
        ].join("\n"),
      );
    });

    test("a card saved before cards said which keeps its title, as it always read", () => {
      const markdown: string = widgetToMarkdown(
        monitorCard({ origin: undefined }),
      );

      expect(markdown.startsWith("#### Monitor payments-api\n")).toBe(true);
      expect(markdown).toContain("_MONITOR_");
      expect(markdown).toContain("**payments-api**");
    });

    test("a read's card with no name keeps its title rather than an empty heading", () => {
      const markdown: string = widgetToMarkdown(
        monitorCard({ heading: "   " }),
      );

      expect(markdown.startsWith("#### Monitor payments-api\n")).toBe(true);
      expect(markdown).not.toMatch(/^#### \s*$/m);
    });

    test("several read cards: one heading each, by name, in their order", () => {
      const markdown: string = widgetsToMarkdown([
        monitorCard(),
        monitorCard({
          heading: "checkout-web",
          subheading: "Operational",
        }),
        {
          id: "W3",
          type: AIChatWidgetType.ResourceCard,
          title: "Team Platform",
          data: {
            resourceType: "Team",
            heading: "Platform",
            fields: [{ label: "Members", value: "4" }],
            origin: AIChatResourceCardOrigin.Read,
          },
        },
      ]);

      expect(markdown.match(/^#### .*$/gm)).toEqual([
        "#### payments-api",
        "#### checkout-web",
        "#### Platform",
      ]);
      expect(markdown).not.toContain("Team Platform");
      expect(markdown).toContain("_TEAM_");
      expect(markdown).toContain("_MONITOR_ · Operational");
    });
  });

  describe("widgetToMarkdown", () => {
    test("renders the title and description", () => {
      const markdown: string = widgetToMarkdown({
        id: "W1",
        type: AIChatWidgetType.StatCards,
        title: "Summary",
        description: "Last hour",
        data: { stats: [{ label: "Errors", value: 3 }] },
      });

      expect(markdown).toContain("#### Summary");
      expect(markdown).toContain("_Last hour_");
      expect(markdown).toContain("| Errors | 3 |");
    });

    test("caps table rows at 25 and says how many were shown", () => {
      const widget: AIChatWidget = {
        id: "W1",
        type: AIChatWidgetType.Table,
        title: "Rows",
        data: {
          columns: [{ key: "name", title: "Name" }],
          rows: rows(40),
        },
      };

      const markdown: string = widgetToMarkdown(widget);

      expect(markdown).toContain("row-24");
      expect(markdown).not.toContain("row-25");
      expect(markdown).toContain("_Showing 25 of 40 rows._");
    });

    test("caps entity lists at 12", () => {
      const widget: AIChatWidget = {
        id: "W1",
        type: AIChatWidgetType.IncidentList,
        title: "Incidents",
        data: {
          items: Array.from({ length: 20 }, (_u: unknown, i: number) => {
            return { title: `incident-${i}` };
          }),
        },
      };

      const markdown: string = widgetToMarkdown(widget);

      expect(markdown).toContain("incident-11");
      expect(markdown).not.toContain("incident-12");
      expect(markdown).toContain("_Showing 12 of 20._");
    });

    test("escapes a pipe so it cannot break the table", () => {
      const markdown: string = widgetToMarkdown({
        id: "W1",
        type: AIChatWidgetType.Table,
        title: "Rows",
        data: {
          columns: [{ key: "name", title: "Name" }],
          rows: [{ name: "a|b" }],
        },
      });

      expect(markdown).toContain("a\\|b");
    });

    test("empty widgets say so rather than rendering an empty table", () => {
      expect(
        widgetToMarkdown({
          id: "W1",
          type: AIChatWidgetType.Table,
          title: "Rows",
          data: { columns: [], rows: [] },
        }),
      ).toContain("_No rows._");

      expect(
        widgetToMarkdown({
          id: "W2",
          type: AIChatWidgetType.TimeSeriesChart,
          title: "Chart",
          data: { series: [] },
        }),
      ).toContain("_No data points in this range._");

      expect(
        widgetToMarkdown({
          id: "W3",
          type: AIChatWidgetType.IncidentList,
          title: "Incidents",
          data: { items: [] },
        }),
      ).toContain("_Nothing here._");
    });
  });

  describe("toolActionsToMarkdown", () => {
    test("leads with the status so a denied action cannot read as a done one", () => {
      const markdown: string = toolActionsToMarkdown([
        {
          id: "t1",
          toolName: "restart",
          title: "Restart payment-svc",
          arguments: { service: "payment-svc" },
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Denied,
        },
      ]);

      expect(markdown).toContain("- **Denied** — Restart payment-svc");
      expect(markdown).toContain("service: payment-svc");
    });

    test("is empty when there are no actions", () => {
      expect(toolActionsToMarkdown([])).toBe("");
    });

    test("a title, line or outcome with Markdown in it - the files a commit names - reads as written", () => {
      const markdown: string = toolActionsToMarkdown([
        {
          id: "t2",
          toolName: "commit_code_to_branch",
          title: "Commit 3 files to fix/__login__",
          description:
            "These 3 files changed on fix/login after Ask AI read them, and Ask AI's versions undo those changes: src/__init__.py, pages/[slug].tsx, docs/*.md.",
          arguments: {},
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Skipped,
          resultSummary: "Not committed: *a* file changed.",
        },
      ]);

      expect(markdown).toContain(
        "- **Skipped** — Commit 3 files to fix/\\_\\_login\\_\\_",
      );
      expect(markdown).toContain(
        "src/\\_\\_init\\_\\_.py, pages/\\[slug\\].tsx, docs/\\*.md.",
      );
      expect(markdown).toContain("  - _Not committed: \\*a\\* file changed._");
      expect(markdown).not.toContain("__init__");
    });

    test("an ordinary title and line are written exactly as they were", () => {
      expect(
        toolActionsToMarkdown([
          {
            id: "t3",
            toolName: "create_incident",
            title: "Create incident: Checkout down",
            description: 'Severity: High. Linked to host "test01".',
            arguments: {},
            isMutation: true,
            requiresApproval: true,
            status: AIChatToolActionStatus.Executed,
          },
        ]),
      ).toBe(
        [
          "#### Actions",
          "",
          "- **Executed** — Create incident: Checkout down",
          '  - Severity: High. Linked to host "test01".',
        ].join("\n"),
      );
    });
  });

  describe("citationsToMarkdown", () => {
    test("spells out a zero row count as evidence of absence", () => {
      const markdown: string = citationsToMarkdown([
        {
          id: "C1",
          toolName: "logs.query",
          label: "Logs for payment-svc",
          queryArguments: { service: "payment-svc" },
          rowCount: 0,
        },
      ]);

      expect(markdown).toContain("checked, found nothing");
      expect(markdown).toContain('{"service":"payment-svc"}');
    });

    test("pluralizes a real row count", () => {
      expect(
        citationsToMarkdown([
          {
            id: "C1",
            toolName: "t",
            label: "l",
            queryArguments: {},
            rowCount: 1,
          },
        ]),
      ).toContain("1 row");

      expect(
        citationsToMarkdown([
          {
            id: "C2",
            toolName: "t",
            label: "l",
            queryArguments: {},
            rowCount: 5,
          },
        ]),
      ).toContain("5 rows");
    });
  });
});
