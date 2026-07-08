import { JSONObject } from "../../../../Types/JSON";
import {
  AIChatCitationTarget,
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSeries,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";

/*
 * Builds the inline widgets a tool attaches to its result. Widgets are built
 * from the RAW rows a tool fetched (not the redacted LLM payload) and rendered
 * back to the same user who already has RBAC access to the data.
 *
 * `id` and `citationId` are left blank here — ChatAgentRunner mints them
 * (W1, W2, … and the matching C1, C2, …) after the tool executes so they line
 * up with the server-minted citations.
 */
export default class WidgetBuilder {
  public static table(params: {
    title: string;
    description?: string | undefined;
    columns: Array<AIChatWidgetColumn>;
    rows: Array<JSONObject>;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.Table,
      title: params.title,
      description: params.description,
      data: {
        columns: params.columns,
        rows: params.rows,
        link: params.link,
      },
    };
  }

  public static timeSeries(params: {
    title: string;
    description?: string | undefined;
    series: Array<AIChatWidgetSeries>;
    unit?: string | undefined;
    valueLabel?: string | undefined;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.TimeSeriesChart,
      title: params.title,
      description: params.description,
      data: {
        series: params.series,
        xIsTime: true,
        unit: params.unit,
        valueLabel: params.valueLabel,
        link: params.link,
      },
    };
  }

  public static bars(params: {
    title: string;
    description?: string | undefined;
    series: Array<AIChatWidgetSeries>;
    stacked?: boolean | undefined;
    xIsTime?: boolean | undefined;
    unit?: string | undefined;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.BarChart,
      title: params.title,
      description: params.description,
      data: {
        series: params.series,
        stacked: params.stacked ?? false,
        xIsTime: params.xIsTime ?? false,
        unit: params.unit,
        link: params.link,
      },
    };
  }

  public static traceWaterfall(params: {
    title: string;
    description?: string | undefined;
    spans: Array<AIChatWidgetSpan>;
    totalDurationMs: number;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.TraceWaterfall,
      title: params.title,
      description: params.description,
      data: {
        spans: params.spans,
        totalDurationMs: params.totalDurationMs,
        link: params.link,
      },
    };
  }

  public static incidentList(params: {
    title: string;
    description?: string | undefined;
    items: Array<JSONObject>;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.IncidentList,
      title: params.title,
      description: params.description,
      data: { items: params.items, link: params.link },
    };
  }

  public static alertList(params: {
    title: string;
    description?: string | undefined;
    items: Array<JSONObject>;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.AlertList,
      title: params.title,
      description: params.description,
      data: { items: params.items, link: params.link },
    };
  }

  public static exceptionList(params: {
    title: string;
    description?: string | undefined;
    items: Array<JSONObject>;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.ExceptionList,
      title: params.title,
      description: params.description,
      data: { items: params.items, link: params.link },
    };
  }

  public static resourceCard(params: {
    title: string;
    resourceType: string;
    heading: string;
    subheading?: string | undefined;
    fields: Array<{ label: string; value: string }>;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.ResourceCard,
      title: params.title,
      data: {
        resourceType: params.resourceType,
        heading: params.heading,
        subheading: params.subheading,
        fields: params.fields,
        link: params.link,
      },
    };
  }

  public static stats(params: {
    title: string;
    description?: string | undefined;
    stats: Array<AIChatWidgetStat>;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.StatCards,
      title: params.title,
      description: params.description,
      data: { stats: params.stats },
    };
  }
}
