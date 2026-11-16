import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  countProjectsReached,
  getProjectsReachedPath,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/ResolvedRecordRetentionLimitsApi";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { ResolvedRecordKind } from "../../../Types/Retention/ResolvedRecordRetention";
import { RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE } from "../../../Types/Retention/ResolvedRecordRetentionAnswers";
import API from "../../../UI/Utils/API/API";

/*
 * HOW MANY PROJECTS A NEW LIMIT REACHES, ASKED OF THE SERVER (issue #6941):
 * the Admin Dashboard's side of GET /global-config/resolved-record-
 * retention/projects-reached (GlobalConfigAPI). What is pinned: the path is
 * the one the server registers, the limit goes as its kind and its days,
 * and the answer is a count only when the server gave one - a refusal, a
 * failure or an answer with no count is null, never 0, so the question
 * never says nothing more is deleted when nobody counted.
 */

interface GetCall {
  url: URL;
  params?: Record<string, string> | undefined;
  headers?: unknown;
}

let getSpy: ReturnType<typeof jest.spyOn>;

function answerWith(
  response: HTTPResponse<JSONObject> | HTTPErrorResponse | Error,
): void {
  getSpy = jest.spyOn(API, "get").mockImplementation((async () => {
    if (response instanceof Error) {
      throw response;
    }

    return response;
  }) as never);
}

function lastCall(): GetCall {
  const calls: Array<Array<unknown>> = getSpy.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as GetCall;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route", () => {
  test("is GlobalConfig's CRUD path and the route's name, as the server registers it", () => {
    expect(getProjectsReachedPath()).toBe(
      `/global-config/${RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE}`,
    );
    expect(getProjectsReachedPath()).toBe(
      "/global-config/resolved-record-retention/projects-reached",
    );

    const server: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "API",
        "GlobalConfigAPI.ts",
      ),
      "utf8",
    );

    expect(server).toContain(
      "`${new this.entityType().getCrudApiPath()?.toString()}/${RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE}`",
    );
    // Read by kind and maximumInDays, the names the page sends.
    expect(server).toContain('req.query["kind"]');
    expect(server).toContain('req.query["maximumInDays"]');
  });

  test("is asked with the limit's kind and days, by GET", async () => {
    answerWith(new HTTPResponse<JSONObject>(200, { count: 4 }, {}));

    await countProjectsReached({
      kind: ResolvedRecordKind.Incident,
      maximumInDays: 365,
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(lastCall().url.toString()).toMatch(
      /\/global-config\/resolved-record-retention\/projects-reached$/,
    );
    expect(lastCall().params).toEqual({
      kind: "Incident",
      maximumInDays: "365",
    });

    await countProjectsReached({
      kind: ResolvedRecordKind.Alert,
      maximumInDays: 30,
    });

    expect(lastCall().params).toEqual({ kind: "Alert", maximumInDays: "30" });
  });
});

describe("the answer", () => {
  test.each([0, 1, 12, 4512])(
    "a count of %p is that count",
    async (count: number) => {
      answerWith(new HTTPResponse<JSONObject>(200, { count }, {}));

      expect(
        await countProjectsReached({
          kind: ResolvedRecordKind.Incident,
          maximumInDays: 90,
        }),
      ).toBe(count);
    },
  );

  test.each([
    ["no count", {}],
    ["a count that is text", { count: "12" }],
    ["a negative count", { count: -3 }],
    ["a count that is no number", { count: null }],
  ])("%s is no count", async (_what: string, body: JSONObject) => {
    answerWith(new HTTPResponse<JSONObject>(200, body, {}));

    expect(
      await countProjectsReached({
        kind: ResolvedRecordKind.Incident,
        maximumInDays: 90,
      }),
    ).toBeNull();
  });

  test("a refusal is no count", async () => {
    answerWith(
      new HTTPErrorResponse(
        400,
        { message: "Say which maximum to count projects for." },
        {},
      ),
    );

    expect(
      await countProjectsReached({
        kind: ResolvedRecordKind.Alert,
        maximumInDays: 90,
      }),
    ).toBeNull();
  });

  test("a request that fails is no count, and nothing is thrown", async () => {
    answerWith(new Error("Failed to fetch"));

    await expect(
      countProjectsReached({
        kind: ResolvedRecordKind.Incident,
        maximumInDays: 90,
      }),
    ).resolves.toBeNull();
  });
});
