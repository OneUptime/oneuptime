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
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONObject } from "Common/Types/JSON";
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
 * THE SCRUB RULES INGEST LOADS, AND WHOSE RECORDS EACH ONE SCRUBS (#10433).
 *
 * A rule may name the service it is for: ingest reads that with the rule,
 * and runs it on that service's records only - a log line, a span and the
 * exception copied from its event - while a rule that names none runs on
 * every record, as every rule did. A RUM application's session replays are
 * no service's: only the rules for every service and app run on them.
 * Only the database is replaced.
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

const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001043a1";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-0000001043a2";
const RUM_APP: string = "0192f1a0-0000-7000-8000-0000001043a3";
const EMAIL: string = "alice@example.com";

afterEach(() => {
  jest.restoreAllMocks();
  findByMock.mockClear();
});

function savedLogRule(serviceId?: string): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.id = ObjectID.generate();
  rule.projectId = ObjectID.generate();
  rule.name = serviceId ? "Emails of one service" : "Emails everywhere";
  rule.patternType = LogScrubPatternType.Email;
  rule.scrubAction = LogScrubAction.Redact;
  rule.fieldsToScrub = LogScrubField.Both;
  rule.sortOrder = 1;

  if (serviceId) {
    rule.serviceId = new ObjectID(serviceId);
  }

  return rule;
}

function savedTraceRule(serviceId?: string): TraceScrubRule {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.id = ObjectID.generate();
  rule.projectId = ObjectID.generate();
  rule.name = "Emails";
  rule.patternType = TraceScrubPatternType.Email;
  rule.scrubAction = TraceScrubAction.Redact;
  rule.fieldsToScrub = TraceScrubField.All;
  rule.sortOrder = 1;

  if (serviceId) {
    rule.serviceId = new ObjectID(serviceId);
  }

  return rule;
}

function selectOfQuery(): JSONObject {
  expect(findByMock.mock.calls).toHaveLength(1);

  return (findByMock.mock.calls[0]![0] as { select: JSONObject }).select;
}

function logRow(primaryEntityId: string): JSONObject {
  return {
    primaryEntityId,
    body: `sign-in by ${EMAIL}`,
    attributes: { "user.email": EMAIL },
  };
}

describe("loading a project's scrub rules", () => {
  test("log rules are read with the service each one is for", async () => {
    findByMock.mockResolvedValueOnce([savedLogRule(CHECKOUT)]);

    await LogScrubRuleService.loadScrubRules(ObjectID.generate());

    expect(selectOfQuery()).toEqual(
      expect.objectContaining({ serviceId: true, projectId: true }),
    );
  });

  test("trace rules are read with the service each one is for", async () => {
    findByMock.mockResolvedValueOnce([savedTraceRule(CHECKOUT)]);

    await TraceScrubRuleService.loadScrubRules(ObjectID.generate());

    expect(selectOfQuery()).toEqual(
      expect.objectContaining({ serviceId: true, projectId: true }),
    );
  });
});

describe("whose log lines a loaded rule scrubs", () => {
  test("a rule for one service scrubs that service's lines only; one for every service scrubs all", async () => {
    findByMock.mockResolvedValueOnce([savedLogRule(CHECKOUT)]);

    const forCheckout: Awaited<
      ReturnType<typeof LogScrubRuleService.loadScrubRules>
    > = await LogScrubRuleService.loadScrubRules(ObjectID.generate());

    expect(
      LogScrubRuleService.scrubLog(logRow(CHECKOUT), forCheckout)["body"],
    ).toBe("sign-in by [REDACTED]");
    expect(
      LogScrubRuleService.scrubLog(logRow(PAYMENTS), forCheckout)["body"],
    ).toBe(`sign-in by ${EMAIL}`);
    // A line stored under no service is no service's.
    expect(
      LogScrubRuleService.scrubLog(
        { body: `sign-in by ${EMAIL}`, attributes: {} },
        forCheckout,
      )["body"],
    ).toBe(`sign-in by ${EMAIL}`);

    findByMock.mockResolvedValueOnce([savedLogRule()]);

    const everywhere: Awaited<
      ReturnType<typeof LogScrubRuleService.loadScrubRules>
    > = await LogScrubRuleService.loadScrubRules(ObjectID.generate());

    for (const serviceId of [CHECKOUT, PAYMENTS]) {
      expect(
        LogScrubRuleService.scrubLog(logRow(serviceId), everywhere)["body"],
      ).toBe("sign-in by [REDACTED]");
    }
  });
});

describe("whose spans, and exceptions, a loaded rule scrubs", () => {
  test("a span of the rule's service, held as an ObjectID, is scrubbed; another service's is not", async () => {
    findByMock.mockResolvedValueOnce([savedTraceRule(CHECKOUT)]);

    const rules: Awaited<
      ReturnType<typeof TraceScrubRuleService.loadScrubRules>
    > = await TraceScrubRuleService.loadScrubRules(ObjectID.generate());

    const span: (primaryEntityId: ObjectID) => JSONObject = (
      primaryEntityId: ObjectID,
    ): JSONObject => {
      return TraceScrubRuleService.scrubSpan(
        {
          primaryEntityId,
          name: "POST /sign-in",
          statusMessage: `refused ${EMAIL}`,
          attributes: { "enduser.id": EMAIL },
          events: [],
          links: [],
        },
        rules,
      );
    };

    expect(span(new ObjectID(CHECKOUT))["statusMessage"]).toBe(
      "refused [REDACTED]",
    );
    expect(span(new ObjectID(PAYMENTS))["statusMessage"]).toBe(
      `refused ${EMAIL}`,
    );
  });

  test("an exception is scrubbed by its span's service's rules; named no service, by the rules of every service only", async () => {
    findByMock.mockResolvedValueOnce([
      savedTraceRule(CHECKOUT),
      savedTraceRule(),
    ]);

    const rules: Awaited<
      ReturnType<typeof TraceScrubRuleService.loadScrubRules>
    > = await TraceScrubRuleService.loadScrubRules(ObjectID.generate());
    const content: ExceptionContent = {
      message: `no account for ${EMAIL}`,
      stackTrace: "",
      attributes: {},
    };

    expect(
      TraceScrubRuleService.scrubExceptionContent(
        content,
        [rules[0]!],
        new ObjectID(CHECKOUT),
      ).message,
    ).toBe("no account for [REDACTED]");
    expect(
      TraceScrubRuleService.scrubExceptionContent(
        content,
        [rules[0]!],
        new ObjectID(PAYMENTS),
      ).message,
    ).toBe(`no account for ${EMAIL}`);
    expect(
      TraceScrubRuleService.scrubExceptionContent(content, [rules[0]!]).message,
    ).toBe(`no account for ${EMAIL}`);
    // The rule for every service runs whatever the service.
    expect(
      TraceScrubRuleService.scrubExceptionContent(
        content,
        rules,
        new ObjectID(PAYMENTS),
      ).message,
    ).toBe("no account for [REDACTED]");
  });
});

describe("a RUM application's session replays", () => {
  test("run the rules for every service and app, never one for a service", async () => {
    findByMock.mockResolvedValueOnce([
      savedLogRule(CHECKOUT),
      savedLogRule(),
    ]);

    const rules: Awaited<ReturnType<typeof SessionReplayScrubService.loadRules>> =
      await SessionReplayScrubService.loadRules(
        ObjectID.generate(),
        new ObjectID(RUM_APP),
      );

    expect(
      rules.map((compiled: { rule: LogScrubRule }) => {
        return compiled.rule.name;
      }),
    ).toEqual(["Emails everywhere"]);
  });
});
