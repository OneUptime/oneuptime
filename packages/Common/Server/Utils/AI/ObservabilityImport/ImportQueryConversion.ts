import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ImportNote,
  ImportQueryLanguage,
} from "../../../../Types/ObservabilityImport/ObservabilityImport";
import PromptText from "../../../../Utils/AI/PromptText";
import { findPromQLImportProblem } from "../../../../Utils/ObservabilityImport/PromQLImportQuery";
import { PROMQL_FUNCTIONS } from "../../../../Utils/PromQL/PromQLFunctions";
import AIService, {
  AI_IMPORT_QUERY_CONVERSION_FEATURE,
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import { LLMMessage } from "../../LLM/LLMService";

/*
 * ONE QUERY OF AN IMPORT, CONVERTED BY ONEUPTIME AI (issue #7697).
 *
 * The import's preview converts what its rules know (Utils/
 * ObservabilityImport) and lists the rest with why. For a query no rule
 * converts - a Datadog formula of functions PromQL spells differently, a
 * PromQL query OneUptime's engine does not read as written - the person
 * may ask OneUptime AI. Only then, and only this is sent: the query as the
 * file holds it, its language, and the names of the dashboard's variables
 * it may name. Nothing is read from the project, so nothing the person may
 * not read can reach the model; the file is the person's own.
 *
 * The answer is checked here exactly as the preview checks a query - the
 * engine's own parser, with Grafana's macros and the variables filled, and
 * for a monitor an instant vector - so the preview never receives PromQL
 * it would refuse. A draft that does not pass is sent back once with what
 * was wrong; one that still does not is refused with the reason. Nothing
 * is created by this: the preview shows the query, marked as OneUptime
 * AI's, and the person chooses to use it before anything is created.
 *
 * One request (two at most), started by a person and answered while they
 * wait: one attempt per call, metered and billed like any other request,
 * inside the project's daily AI limits, and refused while AI is off for
 * the project (AIService.assertProjectAIEnabled, then executeWithLogging).
 */

// The longest query sent: past any real one, short of a page of text.
export const IMPORT_QUERY_MAX_LENGTH: number = 4000;

// The most variable names sent, each held to a name's length.
const MAX_VARIABLE_NAMES: number = 50;
const MAX_VARIABLE_NAME_LENGTH: number = 100;

const MAX_OUTPUT_TOKENS: number = 1200;

// One answer, and one more told what was wrong with it.
export const IMPORT_QUERY_MAX_ATTEMPTS: number = 2;

const MAX_EXPLANATION_LENGTH: number = 400;

export interface ImportQueryConversionResult {
  promQL: string;
  explanation: string;
}

export const IMPORT_QUERY_SYSTEM_PROMPT: string = `You convert one query into PromQL that OneUptime runs over a project's own metrics. Answer with one JSON object and nothing else: {"promql": "<the PromQL>", "explanation": "<one short sentence on what it reads>"}. If it cannot be written in PromQL, answer {"promql": "", "explanation": "<why, in one sentence>"}.

How the project's metrics are named:
- Metrics sent with Prometheus remote write keep their Prometheus names and labels (http_requests_total{job="api", instance="10.0.0.1:9100"}).
- OpenTelemetry metrics answer to their Prometheus names: dots and dashes become underscores (http.server.request.duration is http_server_request_duration); histograms are _bucket (with le), _count and _sum.
- Datadog Agent metrics keep their names with each dot an underscore (system.cpu.user is system_cpu_user). Each Datadog tag "key:value" is the label key="value", a dot in the key an underscore (kube_namespace:prod is kube_namespace="prod"). Tags without a key are in the label datadog_tags, joined by commas.
- Datadog's space aggregation (avg:, sum:, min:, max:) is the PromQL aggregation, its "by {tags}" a "by (labels)". Datadog first reduces each series' points in an interval: an average for a gauge (avg_over_time(m[$__interval])), a sum with .as_count() (sum_over_time(m[$__interval])).

What you may write:
- PromQL functions: ${Array.from(PROMQL_FUNCTIONS.keys()).sort().join(", ")}; the aggregations sum, avg, min, max, count, group, stddev, stdvar, topk, bottomk, quantile, count_values; offset and subqueries.
- Grafana's $__interval, $__rate_interval and $__range, which the dashboard fills in.
- A dashboard variable only as {{name}} inside a label matcher's quotes, as host="{{host}}", and only the variables listed.
- When the query ends in a comparison with a number (> 0.9), keep it.

Write one PromQL expression that returns numbers per series, never a range vector. Do not invent metric names: use the ones the query names.`;

const INSTRUCTION: string =
  "Convert this query. Answer with the JSON object only.";

/*
 * The JSON in a model's answer: what a code fence holds when it wrote one
 * (it was told not to), else the whole answer.
 */
export const readAnswerJson: (answer: string) => JSONObject | null = (
  answer: string,
): JSONObject | null => {
  let text: string = (answer || "").trim();
  const fence: number = text.indexOf("```");

  if (fence !== -1) {
    const lineEnd: number = text.indexOf("\n", fence);
    const close: number =
      lineEnd === -1 ? -1 : text.indexOf("```", lineEnd + 1);
    text =
      lineEnd === -1
        ? text
        : (close === -1
            ? text.slice(lineEnd + 1)
            : text.slice(lineEnd + 1, close)
          ).trim();
  }

  const start: number = text.indexOf("{");
  const end: number = text.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  } catch {
    return null;
  }
};

export const buildImportQueryMessages: (data: {
  language: ImportQueryLanguage;
  query: string;
  variableNames: Array<string>;
  isForMonitor: boolean;
}) => Array<LLMMessage> = (data: {
  language: ImportQueryLanguage;
  query: string;
  variableNames: Array<string>;
  isForMonitor: boolean;
}): Array<LLMMessage> => {
  const variables: Array<string> = data.variableNames
    .slice(0, MAX_VARIABLE_NAMES)
    .map((name: string): string => {
      return PromptText.field(name, { maxLength: MAX_VARIABLE_NAME_LENGTH });
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  return [
    { role: "system", content: IMPORT_QUERY_SYSTEM_PROMPT },
    {
      role: "user",
      content: `${INSTRUCTION}\n\n${JSON.stringify({
        language:
          data.language === ImportQueryLanguage.Datadog
            ? "Datadog metric query"
            : "PromQL",
        query: PromptText.field(data.query, {
          maxLength: IMPORT_QUERY_MAX_LENGTH,
        }),
        dashboardVariables: variables,
        usedFor: data.isForMonitor
          ? "an alert rule, evaluated every minute"
          : "a dashboard chart",
      })}`,
    },
  ];
};

/*
 * Whether a draft is PromQL the preview would take, and what is wrong
 * when it is not (the reason's English, for the model).
 */
export const checkImportQueryDraft: (promQL: string) => string | null = (
  promQL: string,
): string | null => {
  const problem: ImportNote | null = findPromQLImportProblem({ promQL });

  if (!problem) {
    return null;
  }

  return problem.text.replace(
    /\{\{(\w+)\}\}/g,
    (_match: string, name: string): string => {
      return problem.values?.[name] ?? "";
    },
  );
};

export interface ImportQueryConversionRequest {
  language: ImportQueryLanguage;
  query: string;
  variableNames: Array<string>;
}

/*
 * What the preview sent: the query's language, the query and the
 * dashboard's variable names, each read as its type, nothing else kept.
 */
export const readImportQueryConversionRequest: (
  body: unknown,
) => ImportQueryConversionRequest = (
  body: unknown,
): ImportQueryConversionRequest => {
  const object: JSONObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};
  const language: unknown = object["language"];

  if (
    language !== ImportQueryLanguage.PromQL &&
    language !== ImportQueryLanguage.Datadog
  ) {
    throw new BadDataException(
      "Say which language the query is in: PromQL or Datadog.",
    );
  }

  const names: unknown = object["variableNames"];

  return {
    language,
    query:
      typeof object["query"] === "string" ? (object["query"] as string) : "",
    variableNames: Array.isArray(names)
      ? names
          .filter((name: unknown): boolean => {
            return typeof name === "string";
          })
          .map((name: unknown): string => {
            return name as string;
          })
      : [],
  };
};

export default class ImportQueryConversion {
  public static async convert(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    language: ImportQueryLanguage;
    query: string;
    variableNames: Array<string>;
    isForMonitor: boolean;
  }): Promise<ImportQueryConversionResult> {
    const query: string = (data.query || "").trim();

    if (!query) {
      throw new BadDataException("Name the query OneUptime AI should convert.");
    }

    if (query.length > IMPORT_QUERY_MAX_LENGTH) {
      throw new BadDataException(
        `This query is longer than ${IMPORT_QUERY_MAX_LENGTH} characters, more than OneUptime AI converts at once. Shorten it, or convert it by hand.`,
      );
    }

    /*
     * Project AI kill switch, before any token is spent: executeWithLogging
     * meters and bills the call, and refuses it there too.
     */
    await AIService.assertProjectAIEnabled(data.projectId);

    const messages: Array<LLMMessage> = buildImportQueryMessages({
      language: data.language,
      query,
      variableNames: data.variableNames,
      isForMonitor: data.isForMonitor,
    });
    let lastError: string = "";

    for (
      let attempt: number = 1;
      attempt <= IMPORT_QUERY_MAX_ATTEMPTS;
      attempt++
    ) {
      const request: AILogRequest = {
        projectId: data.projectId,
        feature: AI_IMPORT_QUERY_CONVERSION_FEATURE,
        messages,
        maxTokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        // The person waits on the preview: one attempt, within the proxy's budget.
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
        // The query may name the person's systems: no previews kept.
        storeContentPreviews: false,
      };

      if (data.userId) {
        request.userId = data.userId;
      }

      const response: AILogResponse =
        await AIService.executeWithLogging(request);
      const answer: JSONObject | null = readAnswerJson(response.content || "");
      const promQL: string =
        typeof answer?.["promql"] === "string"
          ? (answer["promql"] as string).trim()
          : "";
      const explanation: string = PromptText.field(
        typeof answer?.["explanation"] === "string"
          ? (answer["explanation"] as string)
          : "",
        { maxLength: MAX_EXPLANATION_LENGTH },
      ).trim();

      if (answer && !promQL) {
        const why: string = explanation
          ? ` ${explanation.replace(/[.\s]+$/, "")}.`
          : "";

        throw new BadDataException(
          `OneUptime AI could not convert this query.${why} Convert it by hand after the import, or leave it out.`,
        );
      }

      const problem: string | null = answer
        ? checkImportQueryDraft(promQL)
        : "the answer was not the JSON object asked for";

      if (!problem) {
        return { promQL, explanation };
      }

      lastError = problem;

      // Once more, told what was wrong; the answer is the model's own.
      messages.push({ role: "assistant", content: response.content || "" });
      messages.push({
        role: "user",
        content: `That cannot be used: ${problem}. Answer with the corrected JSON object only.`,
      });
    }

    throw new BadDataException(
      `OneUptime AI could not write PromQL OneUptime runs for this query (${lastError}). Convert it by hand after the import, or leave it out.`,
    );
  }
}
