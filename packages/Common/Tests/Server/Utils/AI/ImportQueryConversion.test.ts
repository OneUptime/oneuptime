import AIService, {
  AI_IMPORT_QUERY_CONVERSION_FEATURE,
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import ImportQueryConversion, {
  IMPORT_QUERY_MAX_ATTEMPTS,
  IMPORT_QUERY_MAX_LENGTH,
  ImportQueryConversionResult,
  buildImportQueryMessages,
  checkImportQueryDraft,
  readAnswerJson,
  readImportQueryConversionRequest,
} from "../../../../Server/Utils/AI/ObservabilityImport/ImportQueryConversion";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { ImportQueryLanguage } from "../../../../Types/ObservabilityImport/ObservabilityImport";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * One query of an import, converted by OneUptime AI (issue #7697): only
 * the query, its language and the variables' names are sent; the answer is
 * checked as the preview checks a query, sent back once with what was
 * wrong, and refused with the reason when it still does not run. AI off for
 * the project refuses it before any token is spent.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

const answer: (content: string) => AILogResponse = (
  content: string,
): AILogResponse => {
  return { content } as unknown as AILogResponse;
};

const convert: (query?: string) => Promise<ImportQueryConversionResult> = (
  query?: string,
): Promise<ImportQueryConversionResult> => {
  return ImportQueryConversion.convert({
    projectId,
    userId,
    language: ImportQueryLanguage.Datadog,
    query: query ?? "cumsum(sum:app.errors{*}.as_count())",
    variableNames: ["host"],
    isForMonitor: false,
  });
};

describe("ImportQueryConversion", () => {
  let enabled: jest.SpiedFunction<typeof AIService.assertProjectAIEnabled>;
  let execute: jest.SpiedFunction<typeof AIService.executeWithLogging>;

  beforeEach(() => {
    enabled = jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockResolvedValue(undefined as never);
    execute = jest.spyOn(AIService, "executeWithLogging");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an answer that runs is handed back, after one metered request of the import's own feature", async () => {
    execute.mockResolvedValue(
      answer(
        '{"promql": "sum(sum_over_time(app_errors[1h]))", "explanation": "The errors over the past hour."}',
      ) as never,
    );

    expect(await convert()).toEqual({
      promQL: "sum(sum_over_time(app_errors[1h]))",
      explanation: "The errors over the past hour.",
    });
    expect(enabled).toHaveBeenCalledWith(projectId);
    expect(execute).toHaveBeenCalledTimes(1);

    const request: AILogRequest = execute.mock.calls[0]![0];

    expect(request.projectId).toBe(projectId);
    expect(request.userId).toBe(userId);
    expect(request.feature).toBe(AI_IMPORT_QUERY_CONVERSION_FEATURE);
    expect(request.temperature).toBe(0);
    expect(request.requestRetries).toBe(0);
    // The query may name the person's systems: no previews are kept.
    expect(request.storeContentPreviews).toBe(false);
  });

  test("AI off for the project refuses it before the model is asked", async () => {
    enabled.mockRejectedValue(new BadDataException("AI is off.") as never);

    await expect(convert()).rejects.toThrow("AI is off.");
    expect(execute).not.toHaveBeenCalled();
  });

  test("no query, or one longer than any real one, is refused before the model is asked", async () => {
    await expect(convert("  ")).rejects.toThrow(BadDataException);
    await expect(
      convert("x".repeat(IMPORT_QUERY_MAX_LENGTH + 1)),
    ).rejects.toThrow(BadDataException);
    expect(enabled).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("a draft that does not run is sent back once with what was wrong", async () => {
    execute
      .mockResolvedValueOnce(
        answer('{"promql": "sum(rate(x[5m]", "explanation": ""}') as never,
      )
      .mockResolvedValueOnce(
        answer(
          '```json\n{"promql": "sum(rate(x[5m]))", "explanation": "x per second."}\n```',
        ) as never,
      );

    expect((await convert()).promQL).toBe("sum(rate(x[5m]))");
    expect(execute).toHaveBeenCalledTimes(2);

    const retry: Array<LLMMessage> = execute.mock.calls[1]![0].messages;
    const last: LLMMessage | undefined = retry[retry.length - 1];

    expect(last?.role).toBe("user");
    expect(String(last?.content)).toMatch(/^That cannot be used: /);
  });

  test("a range vector is no answer: a widget draws numbers", async () => {
    execute.mockResolvedValue(
      answer('{"promql": "x[5m]", "explanation": ""}') as never,
    );

    await expect(convert()).rejects.toThrow(BadDataException);
    expect(execute).toHaveBeenCalledTimes(IMPORT_QUERY_MAX_ATTEMPTS);
  });

  test("an answer that is no JSON is sent back once, then refused", async () => {
    execute.mockResolvedValue(answer("I would use rate() here.") as never);

    await expect(convert()).rejects.toThrow(
      "the answer was not the JSON object asked for",
    );
    expect(execute).toHaveBeenCalledTimes(IMPORT_QUERY_MAX_ATTEMPTS);
  });

  test("the model saying it cannot is refused with its reason, at once", async () => {
    execute.mockResolvedValue(
      answer(
        '{"promql": "", "explanation": "Anomaly detection has no PromQL."}',
      ) as never,
    );

    await expect(convert()).rejects.toThrow(
      "OneUptime AI could not convert this query. Anomaly detection has no PromQL. Convert it by hand after the import, or leave it out.",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("what is sent, and read back", () => {
  test("only the query, its language, the variables' names and what it is for", () => {
    const messages: Array<LLMMessage> = buildImportQueryMessages({
      language: ImportQueryLanguage.PromQL,
      query: 'histogram_avg(rate(x{job="{{job}}"}[5m]))',
      variableNames: [
        "job",
        ...Array.from({ length: 80 }, (_: unknown, i: number) => {
          return `v${i}`;
        }),
      ],
      isForMonitor: true,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");

    const sent: Record<string, unknown> = JSON.parse(
      String(messages[1]?.content).slice(
        String(messages[1]?.content).indexOf("{"),
      ),
    ) as Record<string, unknown>;

    expect(Object.keys(sent).sort()).toEqual([
      "dashboardVariables",
      "language",
      "query",
      "usedFor",
    ]);
    expect(sent["language"]).toBe("PromQL");
    expect(sent["query"]).toBe('histogram_avg(rate(x{job="{{job}}"}[5m]))');
    expect((sent["dashboardVariables"] as Array<string>).length).toBe(50);
    expect(sent["usedFor"]).toBe("an alert rule, evaluated every minute");
  });

  test("the request body is read as its types, nothing else kept", () => {
    expect(
      readImportQueryConversionRequest({
        language: "Datadog",
        query: "avg:x{*}",
        variableNames: ["host", 7, null, "env"],
        projectId: "someone-else",
      }),
    ).toEqual({
      language: ImportQueryLanguage.Datadog,
      query: "avg:x{*}",
      variableNames: ["host", "env"],
    });

    expect(() => {
      readImportQueryConversionRequest({ language: "SQL", query: "x" });
    }).toThrow(BadDataException);
    expect(() => {
      readImportQueryConversionRequest(null);
    }).toThrow(BadDataException);
  });

  test("an answer's JSON, in a code fence or around words", () => {
    expect(readAnswerJson('Here: {"promql": "up"} done')).toEqual({
      promql: "up",
    });
    expect(readAnswerJson('```json\n{"promql": "up"}\n```')).toEqual({
      promql: "up",
    });
    expect(readAnswerJson("no json")).toBeNull();
    expect(readAnswerJson("[1, 2]")).toBeNull();
  });

  test("a draft is checked as the preview checks a query, with its reason in words", () => {
    expect(checkImportQueryDraft("sum(rate(x[$__rate_interval]))")).toBeNull();
    expect(checkImportQueryDraft('up{job="{{job}}"}')).toBeNull();
    expect(checkImportQueryDraft("sum(rate(x[5m]")).toMatch(
      /^OneUptime's PromQL does not read this query: /,
    );
  });
});
