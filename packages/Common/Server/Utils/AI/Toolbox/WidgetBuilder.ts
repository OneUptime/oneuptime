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
import { getFactsNotInHeading } from "../../../../Types/AI/ResourceCardFacts";
import {
  AIActionCardWords,
  describeAIActionCardWords,
} from "../../../../Types/AI/AIActionWords";

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

  /*
   * The card a write leaves under the answer. A fact its heading or its
   * subheading already says ("#42" in "#42 · Payment API down", "High" in
   * "Severity: High") is left out of its fields: each fact once, for every
   * write tool at once (Types/AI/ResourceCardFacts).
   */
  public static resourceCard(params: {
    title: string;
    resourceType: string;
    heading: string;
    subheading?: string | undefined;
    fields: Array<{ label: string; value: string }>;
    link?: AIChatCitationTarget | undefined;
    // The same card as words the Dashboard says in the reader's language.
    words?: AIActionCardWords | undefined;
  }): AIChatWidget {
    return {
      id: "",
      type: AIChatWidgetType.ResourceCard,
      title: params.title,
      data: {
        resourceType: params.resourceType,
        heading: params.heading,
        subheading: params.subheading,
        fields: getFactsNotInHeading({
          heading: params.heading,
          subheading: params.subheading,
          fields: params.fields,
        }),
        ...(params.words ? { words: params.words } : {}),
        link: params.link,
      },
    };
  }

  /*
   * The card an action leaves under the answer once it ran - what it made
   * or changed - from its words (Types/AI/AIActionWords): the kind of
   * record, the line about what happened to it and its facts, which the
   * Dashboard says in the reader's language. The heading is data in every
   * language: the record by its number and title, a policy by its name.
   * The English the card stores beside its words - what the exports print,
   * and what a Dashboard that cannot read the words draws - is the same
   * words in English, so the two never say different things. Every card a
   * write tool leaves is one of these (ResourceCardWordsGuard).
   */
  public static actionCard(params: {
    title: string;
    heading: string;
    words: AIActionCardWords;
    link?: AIChatCitationTarget | undefined;
  }): AIChatWidget {
    const english: {
      kind: string;
      line?: string | undefined;
      facts: Array<{ label: string; value: string }>;
    } = describeAIActionCardWords(params.words);

    return this.resourceCard({
      title: params.title,
      resourceType: english.kind,
      heading: params.heading,
      subheading: english.line,
      fields: english.facts,
      link: params.link,
      words: params.words,
    });
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
