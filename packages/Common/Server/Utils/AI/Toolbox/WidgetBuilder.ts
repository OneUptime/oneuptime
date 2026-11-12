import { JSONObject } from "../../../../Types/JSON";
import {
  AIChatCitationTarget,
  AIChatResourceCardOrigin,
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSeries,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
  AIChatTestPageOffer,
  getAIChatResourceCardStatusColor,
} from "../../../../Types/AI/AIChatTypes";
import { getFactsNotInHeading } from "../../../../Types/AI/ResourceCardFacts";
import {
  AIActionCardFact,
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
   * The card a read leaves under the answer: a record as it is - a
   * monitor, an SLO, a team - drawn plain (issue #6968), with its status's
   * own colour beside the line that names it when it has one. Its kind, its
   * line and its facts are words of Types/AI/AIActionWords, which the
   * Dashboard says in the reader's language (issue #7175), as a write's
   * card's are: a monitor's name, a status name the project chose and a URL
   * are data in them. The English it stores beside them - what the exports
   * print, and what a Dashboard that cannot read the words draws - is the
   * same words in English (actionCard). A fact its heading or its line
   * already says ("Offline" under a monitor's name) is left out, of both:
   * each fact once, for every tool at once (Types/AI/ResourceCardFacts).
   */
  public static resourceCard(params: {
    title: string;
    heading: string;
    words: AIActionCardWords;
    link?: AIChatCitationTarget | undefined;
    // The status the line names, in its own colour ("#ef4444").
    statusColor?: string | undefined;
  }): AIChatWidget {
    return this.card({
      ...params,
      origin: AIChatResourceCardOrigin.Read,
    });
  }

  /*
   * Either card: what a read or a write left, which the Dashboard draws
   * plain or as done (issue #6968), from its words. The status colour is
   * kept only when it is one ("#rrggbb") and the card has a line to draw
   * it beside: the card draws it as is.
   */
  private static card(params: {
    title: string;
    heading: string;
    words: AIActionCardWords;
    link?: AIChatCitationTarget | undefined;
    statusColor?: string | undefined;
    origin: AIChatResourceCardOrigin;
    // The test page the card offers once its record exists (#6829).
    testPage?: AIChatTestPageOffer | undefined;
  }): AIChatWidget {
    const english: {
      kind: string;
      line?: string | undefined;
      facts: Array<{ label: string; value: string }>;
    } = describeAIActionCardWords(params.words);

    // Each fact once: a fact the heading or the line says is left out of both.
    const keptFacts: Array<number> = [];

    english.facts.forEach(
      (fact: { label: string; value: string }, index: number): void => {
        if (
          getFactsNotInHeading({
            heading: params.heading,
            subheading: english.line,
            fields: [fact],
          }).length > 0
        ) {
          keptFacts.push(index);
        }
      },
    );

    // The words as given when every fact is kept.
    const words: AIActionCardWords =
      params.words.facts && keptFacts.length < params.words.facts.length
        ? {
            ...params.words,
            facts: keptFacts.map((index: number): AIActionCardFact => {
              return params.words.facts![index]!;
            }),
          }
        : params.words;

    const statusColor: string | null = getAIChatResourceCardStatusColor(
      params.statusColor,
    );

    return {
      id: "",
      type: AIChatWidgetType.ResourceCard,
      title: params.title,
      data: {
        resourceType: english.kind,
        heading: params.heading,
        subheading: english.line,
        fields: keptFacts.map(
          (index: number): { label: string; value: string } => {
            return english.facts[index]!;
          },
        ),
        words,
        origin: params.origin,
        ...(statusColor && english.line ? { statusColor } : {}),
        link: params.link,
        ...(params.testPage ? { testPage: params.testPage } : {}),
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
   * write tool leaves is one of these (ResourceCardWordsGuard), drawn as
   * done (issue #6968).
   */
  public static actionCard(params: {
    title: string;
    heading: string;
    words: AIActionCardWords;
    link?: AIChatCitationTarget | undefined;
    /*
     * A setup action's card (#6829): the test page to offer once its
     * record exists - to yourself, or to the policy it made.
     */
    testPage?: AIChatTestPageOffer | undefined;
  }): AIChatWidget {
    return this.card({
      ...params,
      origin: AIChatResourceCardOrigin.Write,
      testPage: params.testPage,
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
