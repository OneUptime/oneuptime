import { describe, expect, test } from "@jest/globals";
import {
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import {
  citationsToMarkdown,
  toolActionsToMarkdown,
  widgetToMarkdown,
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
