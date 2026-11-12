import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import {
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "../../../Types/Dashboard/DashboardLanguage";
import { DataCheckAlertCondition } from "../../../Types/DataObservability/DataCheckType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import AIService, {
  AI_DATA_CHECK_DRAFT_FEATURE,
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../Services/AIService";
import DataAssetService from "../../Services/DataAssetService";
import DataStoreService from "../../Services/DataStoreService";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import { LLMMessage } from "../LLM/LLMService";
import {
  checkCustomSql,
  DATAVERSE_NO_WITH_MESSAGE,
  quoteIdentifier,
  STARTS_WITH_WITH,
  tableReference,
} from "./DataCheckSql";
import { getCollectorEngineOfKind } from "./DataObservabilityEngines";
import { checkMongoPipeline } from "./MongoDbChecks";

/*
 * A RULE IN A SENTENCE, AS A CHECK.
 *
 * "Orders never have a negative total" is a rule a team knows and would
 * rather not write SQL for. The model is given the table - its engine, its
 * name as a query writes it, its columns and their types - and the
 * sentence, and asked for one read-only query that counts the rows that
 * break the rule, with when to alert: above 0, for a rule that must never
 * be broken. Its answer is read strictly (readCheckSuggestion): JSON only,
 * the query held to everything a Custom SQL check is (checkCustomSql), and
 * nothing saved - the person reviews it, as any check, before adding it.
 * A MongoDB collection has no SQL: its check is an aggregation pipeline,
 * held to everything a MongoDB custom check is (checkMongoPipeline).
 */

const MAX_SENTENCE_LENGTH: number = 1_000;
// One answer, and one more told what was wrong with it.
const MAX_ATTEMPTS: number = 2;
const MAX_OUTPUT_TOKENS: number = 1_000;
const MAX_COLUMNS_SHOWN: number = 200;
const MAX_NAME_LENGTH: number = 100;
const MAX_EXPLANATION_LENGTH: number = 500;

export interface DataCheckSuggestion {
  name: string;
  customSql: string;
  alertCondition: DataCheckAlertCondition;
  alertThreshold: number;
  explanation: string;
}

/*
 * THE READER'S LANGUAGE (#7220).
 *
 * The check's name and what it counts are read on the Dashboard, and kept
 * as the check's name and description, so they are written in the
 * language the person who asked reads OneUptime in: one more line in the
 * system message, naming that language from the Dashboard's own list.
 * Only those two change language. The query or pipeline, the table and
 * column names in it, the JSON keys, "Above" or "Below" and an error's
 * why are asked for exactly as before - the why stays English, as the
 * server's message around it is.
 *
 * English, no language, or anything that is not a code the Dashboard is
 * read in adds nothing: the prompt is exactly what it always was, and what
 * was sent is never written into it. This draft reads no AI context
 * (AiContextWiring's LEAVES_OUT_AI_CONTEXT), so a reply language a
 * project's notes ask for (#6580) never meets this line: the reader's
 * language is the only one the model is told.
 */
export function getCheckFromSentenceLanguageLine(data: {
  language?: string | undefined;
  engine: DatabaseEngine;
}): string | null {
  if (data.language === DEFAULT_READER_LANGUAGE) {
    return null;
  }

  // Only a code the Dashboard is read in, exactly as it lists it, names a language.
  const language: DashboardLanguage | undefined =
    SUPPORTED_DASHBOARD_LANGUAGES.find(
      (dashboardLanguage: DashboardLanguage): boolean => {
        return dashboardLanguage.code === data.language;
      },
    );

  if (!language) {
    return null;
  }

  const query: string =
    data.engine === "mongodb"
      ? "the pipeline, with the fields as listed"
      : "the SQL, with the table and column names as listed";

  return [
    `Write the name and the explanation in this language: ${language.englishName}, ${language.nativeName}.`,
    "It is the language the person who asked reads OneUptime in; the example below is in English only to show the shape.",
    `Keep everything else exactly as asked: ${query}; the JSON keys; "Above" or "Below"; and the why of an error, in English.`,
  ].join(" ");
}

// MongoDB's prompt: a collection's fields, and an aggregation pipeline for an answer.
function buildPipelinePrompt(data: {
  sentence: string;
  schemaName: string;
  tableName: string;
  columns: Array<DataAssetColumn>;
  languageLine: string | null;
}): { system: string; user: string } {
  const fields: string = data.columns
    .slice(0, MAX_COLUMNS_SHOWN)
    .map((column: DataAssetColumn): string => {
      return `- ${column.name} ${column.dataType}`;
    })
    .join("\n");

  return {
    system: [
      "You turn a rule about a MongoDB collection, written in a sentence, into one data quality check.",
      "Write ONE read-only aggregation pipeline, as a JSON array of stages, that ends in one document with a number named value: how many documents break the rule (or, when the rule is about a total or an average, that number itself).",
      "Rules:",
      "- It runs on the collection given: never $out, $merge, $function, $accumulator, $where or $lookup into another database.",
      "- Read only the fields listed. A field may be missing or null in any document.",
      '- End with {"$count": "value"}, or a $group or $project that names its number value.',
      'Answer with JSON only, no prose and no code fence: {"name": "a short name for the check", "pipeline": [the stages], "alertCondition": "Above" or "Below", "alertThreshold": a number, "explanation": "one sentence on what the pipeline counts"}.',
      ...(data.languageLine ? [data.languageLine] : []),
      'For a rule that must never be broken, count the documents that break it and alert Above 0. Example: "orders never have a negative total" becomes {"name": "Orders with a negative total", "pipeline": [{"$match": {"total": {"$lt": 0}}}, {"$count": "value"}], "alertCondition": "Above", "alertThreshold": 0, "explanation": "Counts orders whose total is below zero."}',
      'If the sentence cannot be checked with the fields given, answer {"error": "why"}.',
    ].join("\n"),
    user: `Collection: ${data.tableName} (MongoDB, database ${data.schemaName})\nFields:\n${fields || "- (none known)"}\n\nRule: ${data.sentence}`,
  };
}

export function buildCheckFromSentencePrompt(data: {
  sentence: string;
  engine: DatabaseEngine;
  schemaName: string;
  tableName: string;
  columns: Array<DataAssetColumn>;
  // The language the person reads OneUptime in: the name and explanation are asked for in it.
  language?: string | undefined;
}): { system: string; user: string } {
  const sentence: string = data.sentence.trim().slice(0, MAX_SENTENCE_LENGTH);

  if (!sentence) {
    throw new BadDataException("Say the rule the check should hold to.");
  }

  const languageLine: string | null = getCheckFromSentenceLanguageLine({
    language: data.language,
    engine: data.engine,
  });

  if (data.engine === "mongodb") {
    return buildPipelinePrompt({
      sentence,
      schemaName: data.schemaName,
      tableName: data.tableName,
      columns: data.columns,
      languageLine,
    });
  }

  const table: string = tableReference(
    data.engine,
    data.schemaName,
    data.tableName,
  );
  const columns: string = data.columns
    .slice(0, MAX_COLUMNS_SHOWN)
    .map((column: DataAssetColumn): string => {
      return `- ${quoteIdentifier(data.engine, column.name)} ${column.dataType}${column.isNullable ? "" : " NOT NULL"}`;
    })
    .join("\n");

  return {
    system: [
      "You turn a rule about a database table, written in a sentence, into one data quality check.",
      "Write ONE read-only SQL query that returns a single number named value: how many rows break the rule (or, when the rule is about a total or an average, that number itself).",
      "Rules:",
      "- Start with SELECT or WITH. One statement only: no semicolons, no comments, never INSERT, UPDATE, DELETE, MERGE, DDL or a function that writes.",
      `- Read only the table given, written exactly as ${table}, and only the columns listed, quoted as listed.`,
      data.engine === "dataverse"
        ? "- Write SQL for Microsoft Dataverse's TDS endpoint: SQL Server's T-SQL, read-only, with no WITH (common table expressions), no window functions (OVER) and no table hints. Start with SELECT."
        : `- Write SQL for ${data.engine}.`,
      "- Alias the number AS value.",
      'Answer with JSON only, no prose and no code fence: {"name": "a short name for the check", "sql": "the query", "alertCondition": "Above" or "Below", "alertThreshold": a number, "explanation": "one sentence on what the query counts"}.',
      ...(languageLine ? [languageLine] : []),
      'For a rule that must never be broken, count the rows that break it and alert Above 0. Example: "orders never have a negative total" becomes {"name": "Orders with a negative total", "sql": "SELECT COUNT(*) AS value FROM \\"public\\".\\"orders\\" WHERE \\"total\\" < 0", "alertCondition": "Above", "alertThreshold": 0, "explanation": "Counts orders whose total is below zero."}',
      'If the sentence cannot be checked with the columns given, answer {"error": "why"}.',
    ].join("\n"),
    user: `Table: ${table} (${data.engine})\nColumns:\n${columns || "- (none known)"}\n\nRule: ${sentence}`,
  };
}

function readJson(text: string): JSONObject {
  const trimmed: string = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start: number = trimmed.indexOf("{");
  const end: number = trimmed.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new BadDataException(
      "The AI's answer was not a check. Say the rule another way, or write the check yourself.",
    );
  }

  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JSONObject;
    }
  } catch {
    // Read as no check below.
  }

  throw new BadDataException(
    "The AI's answer was not a check. Say the rule another way, or write the check yourself.",
  );
}

// A pipeline answer, as a MongoDB custom check holds it: JSON text, read-only, naming its value.
function readPipelineAnswer(answer: JSONObject): string {
  const pipeline: unknown = answer["pipeline"];
  const text: string =
    typeof pipeline === "string" ? pipeline : JSON.stringify(pipeline ?? "");
  const stages: Array<JSONObject> = checkMongoPipeline(text);
  const namesItsValue: boolean = JSON.stringify(stages).includes('"value"');

  if (!namesItsValue) {
    throw new BadDataException(
      "The AI's pipeline does not name its number value. Say the rule another way, or write the check yourself.",
    );
  }

  return JSON.stringify(stages);
}

/*
 * The model's answer, as a check to review: refused unless it is one a
 * Custom SQL check may be - for MongoDB, a custom pipeline.
 */
export function readCheckSuggestion(
  text: string,
  engine?: DatabaseEngine | undefined,
  sentence?: string | undefined,
): DataCheckSuggestion {
  const answer: JSONObject = readJson(text);

  if (typeof answer["error"] === "string" && answer["error"].trim()) {
    throw new BadDataException(
      `The rule could not be made a check: ${answer["error"].trim().slice(0, MAX_EXPLANATION_LENGTH)}`,
    );
  }

  let sql: string;

  if (engine === "mongodb") {
    sql = readPipelineAnswer(answer);
  } else {
    sql = checkCustomSql(
      typeof answer["sql"] === "string" ? answer["sql"] : "",
    );

    if (engine === "dataverse" && STARTS_WITH_WITH.test(sql)) {
      throw new BadDataException(DATAVERSE_NO_WITH_MESSAGE);
    }

    const namesItsValue: RegExp = /\bAS\s+["`[]?value["`\]]?/i;

    if (!namesItsValue.test(sql)) {
      throw new BadDataException(
        "The AI's query does not name its number value. Say the rule another way, or write the check yourself.",
      );
    }
  }

  const condition: DataCheckAlertCondition =
    answer["alertCondition"] === DataCheckAlertCondition.Below
      ? DataCheckAlertCondition.Below
      : DataCheckAlertCondition.Above;
  const threshold: number = Number(answer["alertThreshold"]);

  /*
   * An answer that names no check is named by the rule as the person wrote
   * it - in their own language - and only a call with no rule falls back
   * to English words.
   */
  const ruleAsWritten: string = (sentence || "")
    .slice(0, MAX_SENTENCE_LENGTH)
    .replace(/\s+/g, " ")
    .trim();

  return {
    name:
      (typeof answer["name"] === "string" ? answer["name"].trim() : "").slice(
        0,
        MAX_NAME_LENGTH,
      ) ||
      ruleAsWritten.slice(0, MAX_NAME_LENGTH) ||
      "Rule from a sentence",
    customSql: sql,
    alertCondition: condition,
    alertThreshold: Number.isFinite(threshold) ? threshold : 0,
    explanation: (typeof answer["explanation"] === "string"
      ? answer["explanation"].trim()
      : ""
    ).slice(0, MAX_EXPLANATION_LENGTH),
  };
}

export default class DataCheckFromSentence {
  /*
   * A check of this table from the rule, for the person to review: the
   * model is asked once, and once more told why its answer could not be a
   * check, before saying it could not write one.
   */
  public static async draft(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    dataAssetId: ObjectID;
    sentence: string;
    // The language the person reads OneUptime in (#7220); none, or one OneUptime is not read in, is English.
    language?: string | undefined;
  }): Promise<DataCheckSuggestion> {
    // The project's AI switch, before any token is spent.
    await AIService.assertProjectAIEnabled(data.projectId);

    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { projectId: data.projectId, _id: data.dataAssetId },
      select: {
        schemaName: true,
        name: true,
        columns: true,
        dataStoreId: true,
      },
      props: { isRoot: true },
    });

    if (!asset?.name || !asset.dataStoreId) {
      throw new BadDataException("The table was not found.");
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { projectId: data.projectId, _id: asset.dataStoreId },
      select: { kind: true },
      props: { isRoot: true },
    });
    const engine: DatabaseEngine | null = getCollectorEngineOfKind(store?.kind);

    if (!engine) {
      throw new BadDataException(
        "Data Observability does not run checks on this table's database.",
      );
    }

    const prompt: { system: string; user: string } =
      buildCheckFromSentencePrompt({
        sentence: data.sentence,
        engine,
        schemaName: asset.schemaName || "",
        tableName: asset.name,
        columns: readDataAssetColumns(asset.columns),
        language: data.language,
      });
    const messages: Array<LLMMessage> = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ];
    let lastError: string = "";

    for (let attempt: number = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const request: AILogRequest = {
        projectId: data.projectId,
        feature: AI_DATA_CHECK_DRAFT_FEATURE,
        messages,
        maxTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        // The person waits on the page: one attempt, within the proxy's budget.
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
        // The rule and the table's columns may name the business: no previews kept.
        storeContentPreviews: false,
      };

      if (data.userId) {
        request.userId = data.userId;
      }

      const response: AILogResponse =
        await AIService.executeWithLogging(request);
      const content: string = response.content || "";

      try {
        return readCheckSuggestion(content, engine, data.sentence);
      } catch (error) {
        lastError =
          error instanceof Error && error.message
            ? error.message
            : String(error);

        // A rule that cannot be checked with these columns is the answer, not a mistake.
        if (lastError.includes("could not be made a check")) {
          throw error;
        }

        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content: `That cannot be a check: ${lastError} Answer again with the JSON only.`,
        });
      }
    }

    throw new BadDataException(
      `OneUptime AI could not write a check OneUptime can run for that rule (${lastError}) Say it another way, or write the check yourself.`,
    );
  }
}
