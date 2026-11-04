import { afterEach, describe, expect, jest, test } from "@jest/globals";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import LogDropFilterService from "Common/Server/Services/LogDropFilterService";
import LogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import OpenStackLogDefaults, {
  OPENSTACK_DEFAULT_DROP_FILTERS,
  OPENSTACK_DEFAULT_SCRUB_RULES,
  OpenStackDefaultDropFilter,
  OpenStackDefaultScrubRule,
} from "Common/Server/Utils/OpenStack/OpenStackLogDefaults";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import ObjectID from "Common/Types/ObjectID";
import {
  ScrubRegExp,
  compileScrubRuleCustomRegex,
} from "Common/Types/Telemetry/ScrubRule";
import { JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_LOG_NOISE_HEALTH_CHECK,
  OpenStackLogAttribute,
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "Common/Utils/OpenStack/OpenStackLogs";
import {
  OpenStackEventAttribute,
  OpenStackEventImportance,
} from "Common/Utils/OpenStack/OpenStackNotifications";
import {
  compileFilter,
  evaluateCompiledFilter,
  CompiledFilter,
} from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";

/*
 * What a project's OpenStack logs cost and keep before anyone has set anything. These rows go
 * through the real evaluator and the real pattern compiler a project's own rules go through: a
 * filter that does not parse never matches, and a pattern the compiler refuses never scrubs, and
 * either would fail quietly.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

function filterNamed(fragment: string): OpenStackDefaultDropFilter {
  const filter: OpenStackDefaultDropFilter | undefined =
    OPENSTACK_DEFAULT_DROP_FILTERS.find(
      (candidate: OpenStackDefaultDropFilter): boolean => {
        return candidate.name.includes(fragment);
      },
    );

  expect(filter).toBeDefined();

  return filter as OpenStackDefaultDropFilter;
}

// As the ingest asks: the row it is about to write, its attributes at the top level.
function rowOf(body: string): JSONObject {
  const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
    attributes: {},
    body,
    severityNumber: 0,
  });

  return {
    severityText: "Information",
    body: stamp.body,
    attributes: stamp.attributes,
    ...stamp.attributes,
  } as JSONObject;
}

function drops(filter: OpenStackDefaultDropFilter, body: string): boolean {
  const compiled: CompiledFilter = compileFilter(filter.filterQuery, {
    emptyQueryMatches: false,
  });

  return evaluateCompiledFilter(rowOf(body), compiled);
}

describe("the drop filters", () => {
  test.each(
    OPENSTACK_DEFAULT_DROP_FILTERS.map(
      (filter: OpenStackDefaultDropFilter) => [filter.name, filter] as const,
    ),
  )("%s parses", (_name: string, filter: OpenStackDefaultDropFilter) => {
    expect(
      compileFilter(filter.filterQuery, { emptyQueryMatches: false }).kind,
    ).toBe("expr");
  });

  test("names each attribute as the ingest writes it", () => {
    expect(filterNamed("DEBUG").filterQuery).toBe(
      `${OpenStackLogAttribute.Level} = 'DEBUG'`,
    );
    expect(filterNamed("health").filterQuery).toBe(
      `${OpenStackLogAttribute.Noise} = '${OPENSTACK_LOG_NOISE_HEALTH_CHECK}'`,
    );
    expect(filterNamed("routine").filterQuery).toBe(
      `${OpenStackEventAttribute.Importance} = '${OpenStackEventImportance.Routine}'`,
    );
  });

  test("DEBUG lines go, and nothing else", () => {
    const filter: OpenStackDefaultDropFilter = filterNamed("DEBUG");

    expect(
      drops(
        filter,
        "2026-10-30 10:00:00.123 1234 DEBUG nova.compute.manager [-] Running periodic task",
      ),
    ).toBe(true);
    expect(
      drops(
        filter,
        "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Started",
      ),
    ).toBe(false);
    expect(
      drops(
        filter,
        "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [-] Failed",
      ),
    ).toBe(false);
  });

  test("a load balancer's checks go, and real requests stay", () => {
    const filter: OpenStackDefaultDropFilter = filterNamed("health");

    expect(
      drops(
        filter,
        '2026-10-30 10:00:00.123 1234 INFO nova.api [-] 192.0.2.1 "GET / HTTP/1.1" status: 200',
      ),
    ).toBe(true);
    expect(
      drops(
        filter,
        '2026-10-30 10:00:00.123 1234 INFO nova.api [-] 192.0.2.1 "GET /v2.1/servers HTTP/1.1" status: 200',
      ),
    ).toBe(false);
  });

  test("notifications that say nothing happened go, and those that say something stay", () => {
    const filter: OpenStackDefaultDropFilter = filterNamed("routine");
    const line: (type: string) => string = (type: string): string => {
      return `2026-10-30 10:00:00.123 1234 INFO oslo.messaging.notification.${type} [-] ${JSON.stringify(
        { event_type: type, priority: "INFO", payload: {} },
      )}`;
    };

    expect(drops(filter, line("metrics.update"))).toBe(true);
    expect(drops(filter, line("compute.instance.exists"))).toBe(true);
    expect(drops(filter, line("instance.create.end"))).toBe(false);
    expect(drops(filter, line("service.update"))).toBe(false);
  });

  test("a project's other logs are never touched", () => {
    const row: JSONObject = {
      severityText: "Debug",
      body: "DEBUG something",
      attributes: { "log.level": "DEBUG" },
    };

    for (const filter of OPENSTACK_DEFAULT_DROP_FILTERS) {
      expect(
        evaluateCompiledFilter(row, compileFilter(filter.filterQuery)),
      ).toBe(false);
    }
  });
});

describe("the scrub rules", () => {
  function scrubbed(rule: OpenStackDefaultScrubRule, text: string): string {
    const compiled: ScrubRegExp | null = compileScrubRuleCustomRegex(
      rule.customRegex,
    );

    expect(compiled).not.toBeNull();

    return (compiled as ScrubRegExp)[Symbol.replace](text, "[REDACTED]");
  }

  function ruleNamed(fragment: string): OpenStackDefaultScrubRule {
    const rule: OpenStackDefaultScrubRule | undefined =
      OPENSTACK_DEFAULT_SCRUB_RULES.find(
        (candidate: OpenStackDefaultScrubRule): boolean => {
          return candidate.name.includes(fragment);
        },
      );

    expect(rule).toBeDefined();

    return rule as OpenStackDefaultScrubRule;
  }

  test.each(
    OPENSTACK_DEFAULT_SCRUB_RULES.map(
      (rule: OpenStackDefaultScrubRule) => [rule.name, rule] as const,
    ),
  )("%s compiles, as a project's own pattern must", (_name, rule) => {
    expect(compileScrubRuleCustomRegex(rule.customRegex)).not.toBeNull();
  });

  test("a Fernet token goes wherever it stands", () => {
    const token: string = `gAAAAABp${"AbC123_-".repeat(10)}`;

    expect(scrubbed(ruleNamed("Fernet"), `validating ${token} now`)).toBe(
      "validating [REDACTED] now",
    );
    expect(scrubbed(ruleNamed("Fernet"), "gAAAA is how they start")).toBe(
      "gAAAA is how they start",
    );
  });

  test.each([
    ["X-Auth-Token: abcdef123456", "X-Auth-Token: [REDACTED]"],
    ["x-auth-token=abcdef123456", "x-auth-token=[REDACTED]"],
    ["X-Subject-Token: abcdef123456", "X-Subject-Token: [REDACTED]"],
    ["X-Service-Token: abcdef123456", "X-Service-Token: [REDACTED]"],
    ['"X-Auth-Token": "abcdef123456"', '"X-Auth-Token": "[REDACTED]"'],
  ])("the header %s", (text: string, expected: string) => {
    expect(scrubbed(ruleNamed("headers"), text)).toBe(expected);
  });

  test.each([
    ["rabbit://stackrabbit:hunter2@host:5672/", "rabbit://stackrabbit:[REDACTED]@host:5672/"],
    ["mysql+pymysql://root:hunter2@host/nova", "mysql+pymysql://root:[REDACTED]@host/nova"],
    ["postgresql://u:hunter2@host/keystone", "postgresql://u:[REDACTED]@host/keystone"],
  ])("the address %s", (text: string, expected: string) => {
    expect(scrubbed(ruleNamed("URLs"), text)).toBe(expected);
  });

  test("an ordinary address is left", () => {
    expect(
      scrubbed(ruleNamed("URLs"), "http://controller:5000/v3 is up"),
    ).toBe("http://controller:5000/v3 is up");
  });

  test.each([
    ['"password": "hunter2"', '"password": "[REDACTED]"'],
    ["'adminPass': 'hunter2'", "'adminPass': '[REDACTED]'"],
    ['"new_password":"hunter2"', '"new_password":"[REDACTED]"'],
  ])("the request's %s", (text: string, expected: string) => {
    expect(scrubbed(ruleNamed("requests"), text)).toBe(expected);
  });

  test("each is quick on a long line of what it looks for", () => {
    for (const rule of OPENSTACK_DEFAULT_SCRUB_RULES) {
      const compiled: ScrubRegExp | null = compileScrubRuleCustomRegex(
        rule.customRegex,
      );
      const startedAt: number = Date.now();

      for (const shape of [
        "gAAAA".repeat(20000),
        "X-Auth-Token: ".repeat(10000),
        "rabbit://user:".repeat(10000),
        '"password": "'.repeat(10000),
      ]) {
        compiled?.[Symbol.replace](shape, "[REDACTED]");
      }

      expect(Date.now() - startedAt).toBeLessThan(5000);
    }
  });
});

describe("adding them to a project", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockServices(data: {
    isFirstTime?: boolean;
    existingFilters?: Array<string>;
    existingRules?: Array<string>;
  }): { filters: Array<LogDropFilter>; rules: Array<LogScrubRule> } {
    const filters: Array<LogDropFilter> = [];
    const rules: Array<LogScrubRule> = [];

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation((async () => {
        return data.isFirstTime !== false;
      }) as never);
    jest.spyOn(LogDropFilterService, "findBy").mockImplementation((async () => {
      return (data.existingFilters || []).map((name: string): LogDropFilter => {
        const row: LogDropFilter = new LogDropFilter();
        row.name = name;
        return row;
      });
    }) as never);
    jest.spyOn(LogScrubRuleService, "findBy").mockImplementation((async () => {
      return (data.existingRules || []).map((name: string): LogScrubRule => {
        const row: LogScrubRule = new LogScrubRule();
        row.name = name;
        return row;
      });
    }) as never);
    jest.spyOn(LogDropFilterService, "create").mockImplementation((async (input: {
      data: LogDropFilter;
    }) => {
      filters.push(input.data);
      return input.data;
    }) as never);
    jest.spyOn(LogScrubRuleService, "create").mockImplementation((async (input: {
      data: LogScrubRule;
    }) => {
      rules.push(input.data);
      return input.data;
    }) as never);

    return { filters, rules };
  }

  test("the first time, every one, on, and seen on the settings page", async () => {
    const added: { filters: Array<LogDropFilter>; rules: Array<LogScrubRule> } =
      mockServices({});

    await OpenStackLogDefaults.ensureForProject(PROJECT_ID);

    expect(added.filters).toHaveLength(OPENSTACK_DEFAULT_DROP_FILTERS.length);
    expect(added.rules).toHaveLength(OPENSTACK_DEFAULT_SCRUB_RULES.length);
    expect(added.filters[0]?.isEnabled).toBe(true);
    expect(added.filters[0]?.action).toBe(LogDropFilterAction.Drop);
    expect(added.filters[0]?.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(added.rules[0]?.scrubAction).toBe(LogScrubAction.Redact);
    expect(added.rules[0]?.isEnabled).toBe(true);
  });

  test("after that, one read of the cache and nothing else", async () => {
    const added: { filters: Array<LogDropFilter>; rules: Array<LogScrubRule> } =
      mockServices({ isFirstTime: false });

    await OpenStackLogDefaults.ensureForProject(PROJECT_ID);

    expect(added.filters).toHaveLength(0);
    expect(added.rules).toHaveLength(0);
    expect(LogDropFilterService.findBy).not.toHaveBeenCalled();
  });

  test("one someone already has is left as they left it", async () => {
    const added: { filters: Array<LogDropFilter>; rules: Array<LogScrubRule> } =
      mockServices({
        existingFilters: [OPENSTACK_DEFAULT_DROP_FILTERS[0]!.name],
        existingRules: [OPENSTACK_DEFAULT_SCRUB_RULES[0]!.name],
      });

    await OpenStackLogDefaults.ensureForProject(PROJECT_ID);

    expect(added.filters).toHaveLength(
      OPENSTACK_DEFAULT_DROP_FILTERS.length - 1,
    );
    expect(added.rules).toHaveLength(OPENSTACK_DEFAULT_SCRUB_RULES.length - 1);
    expect(added.filters[0]?.sortOrder).toBe(1);
  });

  test("a database that cannot answer costs the logs nothing", async () => {
    mockServices({});
    jest.spyOn(LogDropFilterService, "findBy").mockImplementation((async () => {
      throw new Error("Postgres is down");
    }) as never);

    await expect(
      OpenStackLogDefaults.ensureForProject(PROJECT_ID),
    ).resolves.toBeUndefined();
  });
});
