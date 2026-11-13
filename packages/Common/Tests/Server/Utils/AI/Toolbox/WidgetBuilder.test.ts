import WidgetBuilder from "../../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import { JSONObject } from "../../../../../Types/JSON";
import {
  AIChatCitationTarget,
  AIChatResourceCardOrigin,
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetData,
  AIChatWidgetSeries,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
  getAIChatResourceCardStatusColor,
  isAIChatReadResourceCard,
} from "../../../../../Types/AI/AIChatTypes";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_READ_CARD_FACTS,
  AI_READ_CARD_KINDS,
  AI_READ_CARD_LINES,
  AIActionCardWords,
  aiActionCardFact,
  aiActionSentence,
  aiActionTerm,
} from "../../../../../Types/AI/AIActionWords";
import { getMonitorCardWords } from "../../../../../Server/Utils/AI/Toolbox/ReadCardWords";

/*
 * WidgetBuilder is the factory the AI toolbox uses to attach inline widgets to
 * a tool result. The shapes it produces are a contract with the frontend
 * renderer, so this pins down the widget type, the data envelope, the defaults
 * (bars.stacked / bars.xIsTime), and the invariant that id/citationId are left
 * blank for ChatAgentRunner to mint.
 */

const link: AIChatCitationTarget = {
  // A minimal citation target; only its presence is asserted below.
} as AIChatCitationTarget;

describe("WidgetBuilder", () => {
  test("table() builds a Table widget carrying columns and rows", () => {
    const columns: Array<AIChatWidgetColumn> = [
      { key: "name", title: "Name" } as AIChatWidgetColumn,
    ];
    const rows: Array<JSONObject> = [{ name: "api" }, { name: "worker" }];

    const widget: AIChatWidget = WidgetBuilder.table({
      title: "Services",
      description: "All services",
      columns,
      rows,
      link,
    });

    expect(widget.type).toBe(AIChatWidgetType.Table);
    expect(widget.title).toBe("Services");
    expect(widget.description).toBe("All services");
    expect(widget.id).toBe("");
    expect((widget.data as JSONObject)["columns"]).toBe(columns);
    expect((widget.data as JSONObject)["rows"]).toBe(rows);
    expect((widget.data as JSONObject)["link"]).toBe(link);
  });

  test("timeSeries() hardcodes xIsTime to true", () => {
    const series: Array<AIChatWidgetSeries> = [
      { name: "cpu", points: [] } as unknown as AIChatWidgetSeries,
    ];

    const widget: AIChatWidget = WidgetBuilder.timeSeries({
      title: "CPU over time",
      series,
      unit: "%",
      valueLabel: "CPU",
    });

    expect(widget.type).toBe(AIChatWidgetType.TimeSeriesChart);
    const data: JSONObject = widget.data as JSONObject;
    expect(data["xIsTime"]).toBe(true);
    expect(data["unit"]).toBe("%");
    expect(data["valueLabel"]).toBe("CPU");
    expect(data["series"]).toBe(series);
  });

  test("bars() defaults stacked and xIsTime to false", () => {
    const series: Array<AIChatWidgetSeries> = [
      { name: "logs", points: [] } as unknown as AIChatWidgetSeries,
    ];

    const widget: AIChatWidget = WidgetBuilder.bars({
      title: "Log volume",
      series,
    });

    expect(widget.type).toBe(AIChatWidgetType.BarChart);
    const data: JSONObject = widget.data as JSONObject;
    expect(data["stacked"]).toBe(false);
    expect(data["xIsTime"]).toBe(false);
  });

  test("bars() honors explicit stacked and xIsTime flags", () => {
    const widget: AIChatWidget = WidgetBuilder.bars({
      title: "Log volume by severity",
      series: [],
      stacked: true,
      xIsTime: true,
    });

    const data: JSONObject = widget.data as JSONObject;
    expect(data["stacked"]).toBe(true);
    expect(data["xIsTime"]).toBe(true);
  });

  test("bars() keeps a `false` flag rather than replacing it with the default", () => {
    /*
     * Regression guard for the `?? false` nullish coalescing: an explicit
     * false must survive, and is indistinguishable from the default here —
     * the point is that passing false does not throw or flip to true.
     */
    const widget: AIChatWidget = WidgetBuilder.bars({
      title: "x",
      series: [],
      stacked: false,
      xIsTime: false,
    });
    const data: JSONObject = widget.data as JSONObject;
    expect(data["stacked"]).toBe(false);
    expect(data["xIsTime"]).toBe(false);
  });

  test("traceWaterfall() carries spans and total duration", () => {
    const spans: Array<AIChatWidgetSpan> = [
      { name: "GET /", durationMs: 12 } as unknown as AIChatWidgetSpan,
    ];

    const widget: AIChatWidget = WidgetBuilder.traceWaterfall({
      title: "Trace",
      spans,
      totalDurationMs: 120,
    });

    expect(widget.type).toBe(AIChatWidgetType.TraceWaterfall);
    const data: JSONObject = widget.data as JSONObject;
    expect(data["spans"]).toBe(spans);
    expect(data["totalDurationMs"]).toBe(120);
  });

  test("incidentList / alertList / exceptionList wrap items under the right type", () => {
    const items: Array<JSONObject> = [{ id: "1" }];

    const incident: AIChatWidget = WidgetBuilder.incidentList({
      title: "Open incidents",
      items,
    });
    expect(incident.type).toBe(AIChatWidgetType.IncidentList);
    expect((incident.data as JSONObject)["items"]).toBe(items);

    const alert: AIChatWidget = WidgetBuilder.alertList({
      title: "Open alerts",
      items,
    });
    expect(alert.type).toBe(AIChatWidgetType.AlertList);
    expect((alert.data as JSONObject)["items"]).toBe(items);

    const exception: AIChatWidget = WidgetBuilder.exceptionList({
      title: "Exceptions",
      items,
    });
    expect(exception.type).toBe(AIChatWidgetType.ExceptionList);
    expect((exception.data as JSONObject)["items"]).toBe(items);
  });

  /*
   * A read's card is built from its words, as a write's is (issue #7175):
   * the English it stores beside them - what the exports print - is the
   * same words in English, so the two never say different things.
   */
  test("resourceCard() stores its words, and the same words in English", () => {
    const words: AIActionCardWords = {
      kind: aiActionTerm(AI_READ_CARD_KINDS.team),
      line: [aiActionSentence(AI_READ_CARD_LINES.noMembers)],
      facts: [
        aiActionCardFact(AI_ACTION_CARD_FACTS.description, "Database people"),
        aiActionCardFact(AI_READ_CARD_FACTS.ownerTeams, "SRE"),
      ],
    };

    const widget: AIChatWidget = WidgetBuilder.resourceCard({
      title: "Team",
      heading: "DBA",
      words,
    });

    expect(widget.type).toBe(AIChatWidgetType.ResourceCard);
    const data: JSONObject = widget.data as JSONObject;
    expect(data["resourceType"]).toBe("Team");
    expect(data["heading"]).toBe("DBA");
    expect(data["subheading"]).toBe("No members");
    expect(data["fields"]).toEqual([
      { label: "Description", value: "Database people" },
      { label: "Owner teams", value: "SRE" },
    ]);
    // Every fact kept: the words as given.
    expect(widget.data.words).toBe(words);
  });

  /*
   * Every tool's card at once: a fact its heading or line already says is
   * not saved under them again (Types/AI/ResourceCardFacts) - in the
   * English and in the words both, so a reader in any language sees it
   * once.
   */
  test("resourceCard() leaves out the facts its heading and line already say, of both", () => {
    const widget: AIChatWidget = WidgetBuilder.resourceCard({
      title: "Monitor Checkout API",
      heading: "Checkout API",
      words: getMonitorCardWords({
        monitorType: "Website",
        statusName: "Offline",
        isMonitoringOff: false,
        isArchived: false,
      }),
    });

    // The status is the line under the name: not a fact again.
    expect(widget.data.subheading).toBe("Offline");
    expect((widget.data as JSONObject)["fields"]).toEqual([
      { label: "Type", value: "Website" },
    ]);
    expect(widget.data.words!.facts).toEqual([
      aiActionCardFact(AI_READ_CARD_FACTS.type, aiActionTerm("Website")),
    ]);
  });

  test("stats() builds StatCards", () => {
    const stats: Array<AIChatWidgetStat> = [
      { label: "Errors", value: "42" } as unknown as AIChatWidgetStat,
    ];

    const widget: AIChatWidget = WidgetBuilder.stats({
      title: "KPIs",
      stats,
    });

    expect(widget.type).toBe(AIChatWidgetType.StatCards);
    expect((widget.data as JSONObject)["stats"]).toBe(stats);
  });

  test("every builder leaves id blank for the runner to mint", () => {
    const widgets: Array<AIChatWidget> = [
      WidgetBuilder.table({ title: "t", columns: [], rows: [] }),
      WidgetBuilder.timeSeries({ title: "t", series: [] }),
      WidgetBuilder.bars({ title: "t", series: [] }),
      WidgetBuilder.incidentList({ title: "t", items: [] }),
      WidgetBuilder.stats({ title: "t", stats: [] }),
    ];

    for (const widget of widgets) {
      expect(widget.id).toBe("");
    }
  });
});

/*
 * WHICH KIND OF TOOL LEFT A CARD (issue #6968).
 *
 * A read's card and a write's were one card, drawn as a write's: green,
 * with a check. A monitor looked up while it was Offline - or whose
 * monitoring was off - had a green check beside it, as if something had
 * been done well. Each card now says which kind of tool left it, and the
 * Dashboard draws a read's plain; a card saved before cards said which is
 * drawn as a write's, as it was then. A read's card may carry its status's
 * own colour, which the card draws as a dot beside the line that names it.
 */
describe("which kind of tool left a card (#6968)", () => {
  const ALERT_WORDS: AIActionCardWords = {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.alert),
    line: [
      aiActionSentence(AI_ACTION_CARD_LINES.severity, { severity: "High" }),
    ],
    facts: [aiActionCardFact(AI_ACTION_CARD_FACTS.description, "Disk full.")],
  };

  // A monitor read by id, as query_monitors leaves it: its status the line.
  function monitorCard(params: {
    subheading?: string | undefined;
    statusColor?: string | undefined;
  }): AIChatWidget {
    return WidgetBuilder.resourceCard({
      title: "Monitor Checkout API",
      heading: "Checkout API",
      words: getMonitorCardWords({
        monitorType: "Website",
        statusName: params.subheading,
        isMonitoringOff: false,
        isArchived: false,
      }),
      statusColor: params.statusColor,
      link,
    });
  }

  test("resourceCard() leaves a read's card, with its words", () => {
    const widget: AIChatWidget = monitorCard({ subheading: "Offline" });

    expect(widget.type).toBe(AIChatWidgetType.ResourceCard);
    expect(widget.data.origin).toBe(AIChatResourceCardOrigin.Read);
    expect(widget.data.origin).toBe("Read");
    expect(isAIChatReadResourceCard(widget.data)).toBe(true);
    // In the reader's language since issue #7175.
    expect(widget.data.words).toEqual({
      kind: aiActionTerm(AI_READ_CARD_KINDS.monitor),
      line: ["Offline"],
      facts: [
        aiActionCardFact(AI_READ_CARD_FACTS.type, aiActionTerm("Website")),
      ],
    });
  });

  test("actionCard() leaves a write's card, with its words, and never a status colour", () => {
    const widget: AIChatWidget = WidgetBuilder.actionCard({
      title: "Alert created",
      heading: "ALT-12 · Disk on payments-db filling up",
      words: ALERT_WORDS,
      link,
    });

    expect(widget.type).toBe(AIChatWidgetType.ResourceCard);
    expect(widget.data.origin).toBe(AIChatResourceCardOrigin.Write);
    expect(widget.data.origin).toBe("Write");
    expect(isAIChatReadResourceCard(widget.data)).toBe(false);
    expect(widget.data.words).toBe(ALERT_WORDS);
    expect(Object.keys(widget.data)).not.toContain("statusColor");
  });

  test("the two cards are the same card otherwise: its kind, heading, line, facts and link", () => {
    const write: AIChatWidget = WidgetBuilder.actionCard({
      title: "Alert created",
      heading: "ALT-12 · Disk on payments-db filling up",
      words: ALERT_WORDS,
      link,
    });
    const read: AIChatWidget = WidgetBuilder.resourceCard({
      title: "Alert created",
      heading: write.data.heading!,
      words: ALERT_WORDS,
      link,
    });

    const withoutOrigin: (data: AIChatWidgetData) => AIChatWidgetData = (
      data: AIChatWidgetData,
    ): AIChatWidgetData => {
      const rest: AIChatWidgetData = { ...data };
      delete rest.origin;
      return rest;
    };

    expect(withoutOrigin(read.data)).toEqual(withoutOrigin(write.data));
    expect(read.title).toBe(write.title);
    expect(read.data.origin).not.toBe(write.data.origin);
  });

  test("a card saved before cards said which is a write's, as it was drawn then", () => {
    // As an older conversation stores one: no origin at all.
    const saved: AIChatWidgetData = {
      resourceType: "Alert",
      heading: "ALT-12 · High memory usage on test01",
      subheading: "Severity: High",
      fields: [{ label: "State", value: "Created" }],
    };

    expect(isAIChatReadResourceCard(saved)).toBe(false);
    expect(isAIChatReadResourceCard({})).toBe(false);
  });

  test("an origin the Dashboard does not know is drawn as a write's: only Read is drawn plain", () => {
    for (const origin of ["read", "READ", "Write", "", "Deleted", " Read"]) {
      expect(
        isAIChatReadResourceCard({
          origin: origin as AIChatResourceCardOrigin,
        }),
      ).toBe(false);
    }

    expect(
      isAIChatReadResourceCard({ origin: AIChatResourceCardOrigin.Read }),
    ).toBe(true);
  });

  test("a read's status colour is kept as it is", () => {
    for (const color of ["#fd625e", "#FD625E", "#ef4444", "#f00", "#6b7280"]) {
      expect(
        monitorCard({ subheading: "Offline", statusColor: color }).data
          .statusColor,
      ).toBe(color);
    }
  });

  test("anything but a colour is dropped: the card then draws no dot", () => {
    for (const value of [
      "red",
      "fd625e",
      "#fd625",
      "#fd625e0",
      "#fd625eff",
      "#ggg",
      "#fd625e; background-image: url(https://example.com/x.png)",
      "url(https://example.com/x.png)",
      "rgb(253, 98, 94)",
      "var(--ou-text)",
      " #fd625e",
      "#fd625e ",
      "#fd625e\n",
      "",
    ]) {
      const widget: AIChatWidget = monitorCard({
        subheading: "Offline",
        statusColor: value,
      });

      expect({ value, keys: Object.keys(widget.data) }).toEqual({
        value,
        keys: expect.not.arrayContaining(["statusColor"]),
      });
    }
  });

  test("no line, no colour: the dot belongs to the status the line names", () => {
    for (const subheading of [undefined, ""]) {
      expect(
        Object.keys(monitorCard({ subheading, statusColor: "#fd625e" }).data),
      ).not.toContain("statusColor");
    }
  });

  test("no colour asked for, none saved", () => {
    expect(
      Object.keys(monitorCard({ subheading: "Offline" }).data),
    ).not.toContain("statusColor");
  });

  test("a stored card's colour is read as untrusted: only #rgb or #rrggbb", () => {
    expect(getAIChatResourceCardStatusColor("#fd625e")).toBe("#fd625e");
    expect(getAIChatResourceCardStatusColor("#ABC")).toBe("#ABC");

    for (const value of [
      undefined,
      null,
      42,
      true,
      {},
      ["#fd625e"],
      { color: "#fd625e" },
      "#fd625e\n",
      "\n#fd625e",
      "#fd625e;",
      "javascript:alert(1)",
      "expression(alert(1))",
    ]) {
      expect(getAIChatResourceCardStatusColor(value)).toBeNull();
    }
  });
});
