import WidgetBuilder from "../../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import { JSONObject } from "../../../../../Types/JSON";
import {
  AIChatCitationTarget,
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSeries,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";

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

  test("resourceCard() maps its heading/subheading/fields", () => {
    const fields: Array<{ label: string; value: string }> = [
      { label: "State", value: "Investigating" },
    ];

    const widget: AIChatWidget = WidgetBuilder.resourceCard({
      title: "Incident",
      resourceType: "Incident",
      heading: "API is down",
      subheading: "SEV1",
      fields,
    });

    expect(widget.type).toBe(AIChatWidgetType.ResourceCard);
    const data: JSONObject = widget.data as JSONObject;
    expect(data["resourceType"]).toBe("Incident");
    expect(data["heading"]).toBe("API is down");
    expect(data["subheading"]).toBe("SEV1");
    expect(data["fields"]).toBe(fields);
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
