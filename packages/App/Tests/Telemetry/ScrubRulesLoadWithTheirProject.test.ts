jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});
jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config, nothing for a pure unit test to do.
      }
      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config, same.
      }
      public keepRowsOnDeleteByQuery(): void {
        // no-op: the rows a delete by query keeps, config too.
      }
      public findBy(...args: Array<unknown>): Promise<Array<unknown>> {
        return mockFindBy(...args);
      }
    },
  };
});
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import SessionReplayScrubService from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE SCRUB RULES INGEST LOADS HASH WITH THEIR OWN PROJECT'S KEY (#10394).
 *
 * A Hash rule's token is keyed per project, so the rules ingest loads for a
 * project carry that project's id - the column is read with the rule - and
 * the engines hash with it: logs, spans, exceptions and session replays
 * (which load the log rules). Only the database is replaced.
 * ---------------------------------------------------------------------------
 */

const mockFindBy: (...args: Array<unknown>) => Promise<Array<unknown>> =
  jest.fn((): Promise<Array<unknown>> => {
    return Promise.resolve([]);
  });

type MockLike = {
  mock: { calls: Array<Array<unknown>> };
  mockClear: () => void;
  mockResolvedValueOnce: (value: Array<unknown>) => unknown;
};

const findByMock: MockLike = mockFindBy as unknown as MockLike;

afterEach(() => {
  jest.restoreAllMocks();
  findByMock.mockClear();
});

// A saved rule as the database hands it back.
function savedLogRule(projectId: ObjectID, action: string): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.id = ObjectID.generate();
  rule.projectId = projectId;
  rule.name = "Scrub IP addresses";
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = LogScrubField.Both;
  rule.sortOrder = 1;

  return rule;
}

function savedTraceRule(projectId: ObjectID, action: string): TraceScrubRule {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.id = ObjectID.generate();
  rule.projectId = projectId;
  rule.name = "Scrub IP addresses";
  rule.patternType = TraceScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = TraceScrubField.All;
  rule.sortOrder = 1;

  return rule;
}

// The select of the one query a load made.
function selectOfQuery(): JSONObject {
  expect(findByMock.mock.calls).toHaveLength(1);

  return (findByMock.mock.calls[0]![0] as { select: JSONObject }).select;
}

describe("loading a project's scrub rules", () => {
  test("log rules are read with their project's id", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValueOnce([
      savedLogRule(projectId, LogScrubAction.Hash),
    ]);

    await LogScrubRuleService.loadScrubRules(projectId);

    expect(selectOfQuery()).toEqual(
      expect.objectContaining({ projectId: true, scrubAction: true }),
    );
  });

  test("trace rules are read with their project's id", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValueOnce([
      savedTraceRule(projectId, TraceScrubAction.Hash),
    ]);

    await TraceScrubRuleService.loadScrubRules(projectId);

    expect(selectOfQuery()).toEqual(
      expect.objectContaining({ projectId: true, scrubAction: true }),
    );
  });

  test("a log Hash rule loaded for a project hashes with that project's key", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValueOnce([
      savedLogRule(projectId, LogScrubAction.Hash),
    ]);

    const row: JSONObject = LogScrubRuleService.scrubLog(
      { body: "client 2001:4860:4860::8888", attributes: {} },
      await LogScrubRuleService.loadScrubRules(projectId),
    );

    expect(row["body"]).toBe(
      `client ${ScrubHashToken.ofIpAddress({
        projectId: projectId,
        address: "2001:4860:4860::8888",
      })}`,
    );
  });

  test("a trace Hash rule loaded for a project hashes spans and exceptions with that project's key", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValueOnce([
      savedTraceRule(projectId, TraceScrubAction.Hash),
    ]);

    const rules: Awaited<
      ReturnType<typeof TraceScrubRuleService.loadScrubRules>
    > = await TraceScrubRuleService.loadScrubRules(projectId);
    const token: string = ScrubHashToken.ofIpAddress({
      projectId: projectId,
      address: "8.8.8.8",
    });

    expect(
      TraceScrubRuleService.scrubSpan(
        {
          name: "GET",
          attributes: { "client.address": "8.8.8.8" },
          events: [],
          links: [],
        },
        rules,
      )["attributes"],
    ).toEqual({ "client.address": token });
    expect(
      TraceScrubRuleService.scrubExceptionContent(
        { message: "refused by 8.8.8.8", stackTrace: "", attributes: {} },
        rules,
      ).message,
    ).toBe(`refused by ${token}`);
  });

  test("a session replay hashes with its project's log rules, and two projects hash one address apart", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValueOnce([
      savedLogRule(projectId, LogScrubAction.Hash),
    ]);
    findByMock.mockResolvedValueOnce([
      savedLogRule(otherProjectId, LogScrubAction.Hash),
    ]);

    const events: Array<JSONValue> = [{ text: "from 203.0.113.7" }];
    const otherEvents: Array<JSONValue> = [{ text: "from 203.0.113.7" }];

    await SessionReplayScrubService.scrubEvents(
      events,
      await SessionReplayScrubService.loadRules(projectId),
    );
    await SessionReplayScrubService.scrubEvents(
      otherEvents,
      await SessionReplayScrubService.loadRules(otherProjectId),
    );

    expect((events[0] as JSONObject)["text"]).toBe(
      `from ${ScrubHashToken.ofIpAddress({
        projectId: projectId,
        address: "203.0.113.7",
      })}`,
    );
    expect((otherEvents[0] as JSONObject)["text"]).not.toBe(
      (events[0] as JSONObject)["text"],
    );
  });
});
