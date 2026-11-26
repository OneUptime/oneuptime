import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../../Models/DatabaseModels/SecurityTelemetrySource";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../Server/Services/SecurityTelemetrySourceService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import UpdateByID from "../../../../Server/Types/Database/UpdateByID";
import {
  describeHashInstead,
  findScrubRulesHidingAddressesFor,
  switchScrubRuleToHash,
} from "../../../../Server/Utils/SecurityEvent/ScrubRuleHashInstead";
import ScrubbedClientAddresses from "../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { ScrubRulesHidingAddressesAnswer } from "../../../../Types/Telemetry/ScrubRuleAddresses";
import TraceScrubField from "../../../../Types/Trace/TraceScrubField";

/*
 * THE SCRUB RULES THAT HIDE ADDRESSES FROM SECURITY EVENTS, AND HASH
 * INSTEAD (#10396).
 *
 * Every enabled IP Address rule that redacts or masks, where Security
 * Events reads the addresses, is named to whoever may read it - each kind
 * of record only where a scan reads it - and Hash Instead switches one to
 * Hash as the person who pressed it, bringing a description Scrub It wrote
 * in line. A Hash rule is never named; another pattern type is never
 * switched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001039b0",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000001039b1");
const RULE_ID: string = "0192f1a0-0000-7000-8000-0000001039b2";
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001039b3";
const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

function logRule(data: {
  id?: string;
  name: string;
  patternType?: string;
  scrubAction?: string;
  fieldsToScrub?: string;
  description?: string;
  serviceId?: string;
}): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule(
    new ObjectID(data.id || ObjectID.generate().toString()),
  );

  rule.name = data.name;
  rule.patternType = data.patternType || LogScrubPatternType.IPAddress;
  rule.scrubAction = data.scrubAction || LogScrubAction.Redact;
  rule.fieldsToScrub = data.fieldsToScrub || LogScrubField.Both;

  if (data.description) {
    rule.description = data.description;
  }

  if (data.serviceId) {
    rule.serviceId = new ObjectID(data.serviceId);
  }

  return rule;
}

const SCRUB_IT_DESCRIPTION: string =
  'Made by Data Security ("Scrub it") from a finding of IP address in attributes.client.address (Logs). It redacts every ip address in log attribute values from now on. It applies to the logs of checkout only: other services\' logs are not changed. What is stored already stays until its retention ends.';

describe("a description Scrub It wrote, once the rule hashes", () => {
  test("says it hashes, and why, for logs and for spans", () => {
    const logs: string | null = describeHashInstead(
      SCRUB_IT_DESCRIPTION,
      "log",
    );

    expect(logs).toContain(
      "It hashes every ip address in log attribute values from now on, rather than redacting it: people see a token instead of the address, and Security Events, which reads these logs, still sees the address behind it, so it can say which one to block.",
    );
    expect(logs).toContain("It applies to the logs of checkout only");
    expect(logs!.length).toBeLessThanOrEqual(500);
    expect(
      describeHashInstead(
        SCRUB_IT_DESCRIPTION.split("redacts").join("masks"),
        "trace",
      ),
    ).toContain("which reads these spans");
  });

  test("leaves a description a person wrote, or one that says something else, as it is", () => {
    expect(describeHashInstead("Hide client IPs.", "log")).toBeNull();
    expect(describeHashInstead(undefined, "log")).toBeNull();
    expect(
      describeHashInstead(
        'Made by Data Security ("Scrub it") from a finding of Email address in body (Logs). It redacts every email address in log bodies from now on.',
        "log",
      ),
    ).toBeNull();
  });
});

describe("the rules that hide addresses from Security Events", () => {
  let logRules: Array<LogScrubRule>;
  let traceRules: Array<TraceScrubRule>;
  let logSource: SecurityLogSource | null;
  let traceSource: SecurityTelemetrySource | null;

  beforeEach(() => {
    ScrubbedClientAddresses.clearCache();
    logRules = [];
    traceRules = [];
    logSource = null;
    traceSource = null;

    jest.spyOn(LogScrubRuleService, "findBy").mockImplementation((async (
      findBy: FindBy<LogScrubRule>,
    ) => {
      // Read as the person asking, never as OneUptime.
      expect(findBy.props).toBe(PROPS);
      return logRules;
    }) as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockImplementation((async (
      findBy: FindBy<TraceScrubRule>,
    ) => {
      expect(findBy.props).toBe(PROPS);
      return traceRules;
    }) as never);
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockImplementation((async () => {
        return logSource;
      }) as never);
    jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockImplementation((async () => {
        return traceSource;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function answer(): Promise<ScrubRulesHidingAddressesAnswer> {
    return await findScrubRulesHidingAddressesFor({
      projectId: PROJECT_ID,
      props: PROPS,
    });
  }

  test("none while Security Events reads none of the project's telemetry", async () => {
    logRules = [logRule({ name: "Scrub IP addresses" })];

    expect(await answer()).toEqual({
      isChecked: true,
      signalsRead: [],
      rules: [],
    });
  });

  test("every Redact or Mask IP Address rule of the logs Your logs reads, a Hash rule never", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    logRules = [
      logRule({ id: RULE_ID, name: "Scrub IP addresses" }),
      logRule({
        name: "Mask checkout's IPs",
        scrubAction: LogScrubAction.Mask,
        serviceId: CHECKOUT,
      }),
      logRule({ name: "Hash IPs", scrubAction: LogScrubAction.Hash }),
      logRule({ name: "Emails", patternType: LogScrubPatternType.Email }),
    ];

    const read: ScrubRulesHidingAddressesAnswer = await answer();

    expect(read.isChecked).toBe(true);
    // Your logs follows a line into its request's span: it reads traces too.
    expect(read.signalsRead).toEqual(["log", "trace"]);
    expect(read.rules).toEqual([
      {
        signal: "log",
        ruleId: RULE_ID,
        ruleName: "Scrub IP addresses",
        scrubAction: LogScrubAction.Redact,
      },
      {
        signal: "log",
        ruleId: logRules[1]!.id!.toString().toLowerCase(),
        ruleName: "Mask checkout's IPs",
        scrubAction: LogScrubAction.Mask,
        serviceId: CHECKOUT,
      },
    ]);
  });

  test("a trace rule only where it reaches the span's attributes", async () => {
    traceSource = new SecurityTelemetrySource(ObjectID.generate());
    traceSource.kind = SecurityTelemetrySourceKind.Traces;

    const attributes: TraceScrubRule = new TraceScrubRule(ObjectID.generate());
    attributes.name = "Span IPs";
    attributes.patternType = LogScrubPatternType.IPAddress;
    attributes.scrubAction = LogScrubAction.Redact;
    attributes.fieldsToScrub = TraceScrubField.Attributes;

    const events: TraceScrubRule = new TraceScrubRule(ObjectID.generate());
    events.name = "Event IPs";
    events.patternType = LogScrubPatternType.IPAddress;
    events.scrubAction = LogScrubAction.Redact;
    events.fieldsToScrub = TraceScrubField.Events;

    traceRules = [attributes, events];

    const read: ScrubRulesHidingAddressesAnswer = await answer();

    expect(read.signalsRead).toEqual(["trace"]);
    expect(
      read.rules.map((rule: { ruleName: string }): string => {
        return rule.ruleName;
      }),
    ).toEqual(["Span IPs"]);
  });

  test("a kind of rule the person may not read says nothing to them", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    logRules = [logRule({ name: "Scrub IP addresses" })];
    jest
      .spyOn(TraceScrubRuleService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException("No trace scrub rules for you") as never,
      );

    const read: ScrubRulesHidingAddressesAnswer = await answer();

    expect(read.isChecked).toBe(true);
    expect(read.rules).toHaveLength(1);
    expect(read.rules[0]!.signal).toBe("log");
  });

  test("sources that cannot be read name no rule", async () => {
    logRules = [logRule({ name: "Scrub IP addresses" })];
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockRejectedValue(new Error("Postgres is away") as never);

    const read: ScrubRulesHidingAddressesAnswer = await answer();

    expect(read.isChecked).toBe(false);
    expect(read.rules).toEqual([]);
  });
});

describe("Hash Instead", () => {
  let saved: LogScrubRule | null;
  let update: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    saved = logRule({
      id: RULE_ID,
      name: "Data Security: IP address in log attributes of checkout",
      description: SCRUB_IT_DESCRIPTION,
      fieldsToScrub: LogScrubField.Attributes,
      serviceId: CHECKOUT,
    });

    jest
      .spyOn(LogScrubRuleService, "findOneBy")
      .mockImplementation((async () => {
        return saved;
      }) as never);
    update = jest
      .spyOn(LogScrubRuleService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("switches the rule to Hash as the person who pressed it, and says so in its description", async () => {
    const switched: Awaited<ReturnType<typeof switchScrubRuleToHash>> =
      await switchScrubRuleToHash({
        projectId: PROJECT_ID,
        signal: "log",
        ruleId: new ObjectID(RULE_ID),
        props: PROPS,
      });

    expect(switched).toEqual({
      signal: "log",
      ruleId: RULE_ID,
      ruleName: "Data Security: IP address in log attributes of checkout",
      scrubAction: LogScrubAction.Hash,
      serviceId: CHECKOUT,
    });
    expect(update).toHaveBeenCalledTimes(1);

    const call: UpdateByID<LogScrubRule> = update.mock
      .calls[0]![0] as UpdateByID<LogScrubRule>;

    expect(call.props).toBe(PROPS);
    expect(call.id.toString()).toBe(RULE_ID);
    expect(call.data).toEqual({
      scrubAction: LogScrubAction.Hash,
      description: describeHashInstead(SCRUB_IT_DESCRIPTION, "log"),
    });
  });

  test("keeps a person's own description", async () => {
    saved!.description = "Hide client IPs.";

    await switchScrubRuleToHash({
      projectId: PROJECT_ID,
      signal: "log",
      ruleId: new ObjectID(RULE_ID),
      props: PROPS,
    });

    expect((update.mock.calls[0]![0] as UpdateByID<LogScrubRule>).data).toEqual(
      { scrubAction: LogScrubAction.Hash },
    );
  });

  test("a rule that already hashes stays as it is", async () => {
    saved!.scrubAction = LogScrubAction.Hash;

    await switchScrubRuleToHash({
      projectId: PROJECT_ID,
      signal: "log",
      ruleId: new ObjectID(RULE_ID),
      props: PROPS,
    });

    expect(update).not.toHaveBeenCalled();
  });

  test("refuses a rule of another pattern type, or one not found", async () => {
    saved!.patternType = LogScrubPatternType.Email;

    await expect(
      switchScrubRuleToHash({
        projectId: PROJECT_ID,
        signal: "log",
        ruleId: new ObjectID(RULE_ID),
        props: PROPS,
      }),
    ).rejects.toThrow(BadDataException);

    saved = null;

    await expect(
      switchScrubRuleToHash({
        projectId: PROJECT_ID,
        signal: "log",
        ruleId: new ObjectID(RULE_ID),
        props: PROPS,
      }),
    ).rejects.toThrow("Scrub rule not found.");
    expect(update).not.toHaveBeenCalled();
  });

  test("a person who may not edit the rule is refused by the rule's own permission", async () => {
    update.mockRejectedValue(
      new NotAuthorizedException("You may not edit scrub rules.") as never,
    );

    await expect(
      switchScrubRuleToHash({
        projectId: PROJECT_ID,
        signal: "log",
        ruleId: new ObjectID(RULE_ID),
        props: PROPS,
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a trace rule is read and switched through the trace scrub rules", async () => {
    const traceRule: TraceScrubRule = new TraceScrubRule(new ObjectID(RULE_ID));
    traceRule.name = "Span IPs";
    traceRule.patternType = LogScrubPatternType.IPAddress;
    traceRule.scrubAction = LogScrubAction.Mask;

    jest
      .spyOn(TraceScrubRuleService, "findOneBy")
      .mockResolvedValue(traceRule as never);
    const traceUpdate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TraceScrubRuleService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await switchScrubRuleToHash({
      projectId: PROJECT_ID,
      signal: "trace",
      ruleId: new ObjectID(RULE_ID),
      props: PROPS,
    });

    expect(
      (traceUpdate.mock.calls[0]![0] as UpdateByID<TraceScrubRule>).data,
    ).toEqual({ scrubAction: LogScrubAction.Hash });
    expect(update).not.toHaveBeenCalled();
  });
});
