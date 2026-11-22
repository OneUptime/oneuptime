import { describe, expect, test } from "@jest/globals";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import { ScrubRegExp } from "../../../Types/Telemetry/ScrubRule";
import {
  SecurityEventsFieldNeed,
  SecurityEventsTelemetrySource,
  TelemetryFieldPart,
  TelemetryFieldSignal,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import TraceScrubField from "../../../Types/Trace/TraceScrubField";
import {
  CompiledScrubRuleReading,
  compileScrubRuleReading,
  compileScrubRuleValuePattern,
  doesScrubRuleTakeFrom,
  findSecurityEventsLosses,
  getScrubRuleParts,
  isKeyHiddenBySensitiveKeysRule,
  ScrubRuleReading,
} from "../../../Utils/Telemetry/ScrubRuleFieldReads";
import { TelemetryFieldReference } from "../../../Utils/Telemetry/TelemetryFieldReferences";

/*
 * WHETHER A SCRUB RULE TAKES AWAY WHAT A SAVED QUERY READS (#10433).
 *
 * A rule takes away what a monitor, a dashboard, a saved view, a recording
 * rule or an SLO reads when it reaches the same records and part of them,
 * and hides what is read there: a value the filter looks for, found by the
 * very pattern ingest runs; or the values of an attribute known to hold
 * what it hides, which a group-by or a search reads. And what it takes
 * from Security Events, which reads the records itself.
 */

const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010433a";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000010433b";

function rule(data: Partial<ScrubRuleReading> = {}): CompiledScrubRuleReading {
  return compileScrubRuleReading(
    {
      signal: "log",
      patternType: LogScrubPatternType.Email,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Both,
      ...data,
    },
    { keys: new Set<string>() },
  );
}

function ref(
  data: Partial<TelemetryFieldReference> = {},
): TelemetryFieldReference {
  return {
    signal: "log",
    serviceIds: null,
    part: TelemetryFieldPart.Attributes,
    use: TelemetryFieldUse.Filter,
    ...data,
  };
}

describe("the parts a rule scrubs, as ingest runs it", () => {
  test("log rules", () => {
    expect(
      getScrubRuleParts({
        signal: "log",
        patternType: "email",
        fieldsToScrub: LogScrubField.Body,
      }),
    ).toEqual(new Set([TelemetryFieldPart.Body]));
    expect(
      getScrubRuleParts({
        signal: "log",
        patternType: "email",
        fieldsToScrub: undefined,
      }),
    ).toEqual(new Set([TelemetryFieldPart.Body, TelemetryFieldPart.Attributes]));
    // A sensitive-keys rule reads attributes, whatever its fields say.
    expect(
      getScrubRuleParts({
        signal: "log",
        patternType: LogScrubPatternType.SensitiveKeys,
        fieldsToScrub: LogScrubField.Body,
      }),
    ).toEqual(new Set([TelemetryFieldPart.Attributes]));
  });

  test("trace rules: All reaches every text a span stores", () => {
    expect(
      getScrubRuleParts({
        signal: "trace",
        patternType: "email",
        fieldsToScrub: TraceScrubField.All,
      }),
    ).toEqual(
      new Set([
        TelemetryFieldPart.SpanName,
        TelemetryFieldPart.StatusMessage,
        TelemetryFieldPart.Attributes,
        TelemetryFieldPart.Events,
      ]),
    );
    expect(
      getScrubRuleParts({
        signal: "trace",
        patternType: "email",
        fieldsToScrub: TraceScrubField.Events,
      }),
    ).toEqual(new Set([TelemetryFieldPart.Events]));
    expect(
      getScrubRuleParts({
        signal: "trace",
        patternType: LogScrubPatternType.SensitiveKeys,
        fieldsToScrub: TraceScrubField.Name,
      }),
    ).toEqual(new Set([TelemetryFieldPart.Attributes, TelemetryFieldPart.Events]));
  });
});

describe("what a rule's pattern finds, as ingest compiles it", () => {
  test("built-in patterns, an IP address, a custom regex; none for keys or a pattern that cannot run", () => {
    const find: (patternType: string, text: string, custom?: string) => boolean =
      (patternType: string, text: string, custom?: string): boolean => {
        const regex: ScrubRegExp | null = compileScrubRuleValuePattern({
          patternType,
          customRegex: custom,
        });

        return Boolean(regex && regex.matchRanges(text).length > 0);
      };

    expect(find(LogScrubPatternType.Email, "user alice@example.com")).toBe(true);
    expect(find(LogScrubPatternType.CreditCard, "4111 1111 1111 1111")).toBe(
      true,
    );
    expect(find(LogScrubPatternType.SSN, "123-45-6789")).toBe(true);
    expect(find(LogScrubPatternType.PhoneNumber, "+1 555-123-4567")).toBe(true);
    expect(find(LogScrubPatternType.IPAddress, "from 203.0.113.7")).toBe(true);
    // A private address is no one's personal data: the IP Address rule keeps it.
    expect(find(LogScrubPatternType.IPAddress, "10.0.0.12")).toBe(false);
    expect(find(LogScrubPatternType.Custom, "id ACME-42", "ACME-\\d+")).toBe(
      true,
    );
    expect(
      compileScrubRuleValuePattern({ patternType: LogScrubPatternType.Custom }),
    ).toBeNull();
    expect(
      compileScrubRuleValuePattern({
        patternType: LogScrubPatternType.SensitiveKeys,
      }),
    ).toBeNull();
    expect(compileScrubRuleValuePattern({ patternType: "constructor" })).toBe(
      null,
    );
  });

  test("a sensitive-keys rule hides a secret key's value, never the record's own session id", () => {
    expect(isKeyHiddenBySensitiveKeysRule("http.request.header.authorization")).toBe(
      true,
    );
    expect(isKeyHiddenBySensitiveKeysRule("db.password")).toBe(true);
    expect(isKeyHiddenBySensitiveKeysRule("session.id")).toBe(false);
    expect(isKeyHiddenBySensitiveKeysRule("user.email")).toBe(false);
    expect(isKeyHiddenBySensitiveKeysRule(" ")).toBe(false);
  });
});

describe("whether a rule takes away what a query reads", () => {
  test("a filter on a value the rule hides never matches again", () => {
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({ key: "user.email", values: ["alice@example.com"] }),
      ),
    ).toBe(true);
    // Found wherever it is in the value: a body search for it too.
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({
          part: TelemetryFieldPart.Body,
          use: TelemetryFieldUse.Search,
          values: ["login failed for alice@example.com"],
        }),
      ),
    ).toBe(true);
  });

  test("an exact filter whose value the rule keeps still matches what it matched", () => {
    expect(
      doesScrubRuleTakeFrom(rule(), ref({ key: "user.email", values: ["none"] })),
    ).toBe(false);
    expect(
      doesScrubRuleTakeFrom(
        rule({ patternType: LogScrubPatternType.IPAddress }),
        ref({ key: "client.address", values: ["10.0.0.12"] }),
      ),
    ).toBe(false);
    // A body search that names no hidden value still finds its lines.
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({
          part: TelemetryFieldPart.Body,
          use: TelemetryFieldUse.Search,
          values: ["login failed"],
        }),
      ),
    ).toBe(false);
  });

  test("a group-by of an attribute that holds what the rule hides reads what the rule left", () => {
    // The issue's example: an IP Address rule and a group-by of client.address.
    expect(
      doesScrubRuleTakeFrom(
        rule({ patternType: LogScrubPatternType.IPAddress }),
        ref({ key: "client.address", use: TelemetryFieldUse.GroupBy }),
      ),
    ).toBe(true);
    // Its name says it: customer_email holds email addresses.
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({ key: "customer_email", use: TelemetryFieldUse.GroupBy }),
      ),
    ).toBe(true);
    // Nothing says what tenant holds.
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({ key: "tenant", use: TelemetryFieldUse.GroupBy }),
      ),
    ).toBe(false);
  });

  test("where Data Security found the type, or the finding was seen, the attribute holds it", () => {
    const withEvidence: CompiledScrubRuleReading = compileScrubRuleReading(
      {
        signal: "log",
        patternType: LogScrubPatternType.Custom,
        customRegex: "ACME-\\d+",
        fieldsToScrub: LogScrubField.Attributes,
      },
      { keys: new Set(["Account.Ref"]) },
    );

    expect(
      doesScrubRuleTakeFrom(
        withEvidence,
        ref({ key: "account.ref", use: TelemetryFieldUse.GroupBy }),
      ),
    ).toBe(true);
    expect(
      doesScrubRuleTakeFrom(
        withEvidence,
        ref({ key: "account.ref", use: TelemetryFieldUse.Value }),
      ),
    ).toBe(true);
    // A dashboard variable picks its value when it is read.
    expect(
      doesScrubRuleTakeFrom(withEvidence, ref({ key: "account.ref" })),
    ).toBe(true);
    expect(
      doesScrubRuleTakeFrom(
        withEvidence,
        ref({ key: "other.ref", use: TelemetryFieldUse.GroupBy }),
      ),
    ).toBe(false);
  });

  test("a search for part of a value of such an attribute misses the values the rule hid", () => {
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({
          key: "user.email",
          use: TelemetryFieldUse.Search,
          values: ["@example.com"],
        }),
      ),
    ).toBe(true);
    expect(
      doesScrubRuleTakeFrom(
        rule(),
        ref({ key: "user.email", values: ["*@example.com"] }),
      ),
    ).toBe(true);
  });

  test("another signal, another part, another service: nothing taken", () => {
    const email: TelemetryFieldReference = ref({
      key: "user.email",
      values: ["alice@example.com"],
    });

    expect(doesScrubRuleTakeFrom(rule(), { ...email, signal: "trace" })).toBe(
      false,
    );
    expect(
      doesScrubRuleTakeFrom(rule({ fieldsToScrub: LogScrubField.Body }), email),
    ).toBe(false);
    expect(
      doesScrubRuleTakeFrom(rule({ serviceId: CHECKOUT }), {
        ...email,
        serviceIds: [PAYMENTS],
      }),
    ).toBe(false);
    expect(
      doesScrubRuleTakeFrom(rule({ serviceId: new ObjectID(CHECKOUT) }), {
        ...email,
        serviceIds: [PAYMENTS, CHECKOUT],
      }),
    ).toBe(true);
    // A reader of every service reads the rule's service too.
    expect(doesScrubRuleTakeFrom(rule({ serviceId: CHECKOUT }), email)).toBe(
      true,
    );
  });

  test("a sensitive-keys rule takes every reading of a key it hides, and only those", () => {
    const keys: CompiledScrubRuleReading = rule({
      patternType: LogScrubPatternType.SensitiveKeys,
    });

    expect(
      doesScrubRuleTakeFrom(
        keys,
        ref({ key: "http.request.header.cookie", use: TelemetryFieldUse.GroupBy }),
      ),
    ).toBe(true);
    expect(
      doesScrubRuleTakeFrom(keys, ref({ key: "api_key", values: ["x"] })),
    ).toBe(true);
    expect(
      doesScrubRuleTakeFrom(keys, ref({ key: "session.id", values: ["s"] })),
    ).toBe(false);
    expect(
      doesScrubRuleTakeFrom(
        keys,
        ref({ key: "user.email", values: ["alice@example.com"] }),
      ),
    ).toBe(false);
    expect(
      doesScrubRuleTakeFrom(
        keys,
        ref({
          part: TelemetryFieldPart.Body,
          use: TelemetryFieldUse.Search,
          values: ["password=x"],
        }),
      ),
    ).toBe(false);
  });

  test("a custom pattern that cannot run hides nothing, so takes nothing", () => {
    expect(
      doesScrubRuleTakeFrom(
        rule({ patternType: LogScrubPatternType.Custom, customRegex: "(" }),
        ref({ key: "x", values: ["((("] }),
      ),
    ).toBe(false);
  });

  test("a trace rule of span names takes a span name search for what it hides", () => {
    expect(
      doesScrubRuleTakeFrom(
        rule({ signal: "trace", fieldsToScrub: TraceScrubField.Name }),
        ref({
          signal: "trace",
          part: TelemetryFieldPart.SpanName,
          use: TelemetryFieldUse.Search,
          values: ["GET /users/alice@example.com"],
        }),
      ),
    ).toBe(true);
  });
});

describe("what a rule takes from Security Events", () => {
  function losses(
    data: Partial<ScrubRuleReading>,
    sources: Array<SecurityEventsTelemetrySource>,
  ): Array<SecurityEventsFieldNeed> {
    return findSecurityEventsLosses(rule(data), sources);
  }

  const LOGS: SecurityEventsTelemetrySource =
    SecurityEventsTelemetrySource.Logs;
  const TRACES: SecurityEventsTelemetrySource =
    SecurityEventsTelemetrySource.Traces;

  test("an IP Address rule that redacts or masks hides the address to block", () => {
    expect(losses({ patternType: LogScrubPatternType.IPAddress }, [LOGS])).toEqual(
      [SecurityEventsFieldNeed.ClientAddresses],
    );
    expect(
      losses(
        {
          signal: "trace",
          patternType: LogScrubPatternType.IPAddress,
          scrubAction: LogScrubAction.Mask,
          fieldsToScrub: TraceScrubField.Attributes,
        },
        [TRACES],
      ),
    ).toEqual([SecurityEventsFieldNeed.ClientAddresses]);
  });

  test("one that hashes leaves the address to Security Events' vault", () => {
    expect(
      losses(
        {
          patternType: LogScrubPatternType.IPAddress,
          scrubAction: LogScrubAction.Hash,
        },
        [LOGS],
      ),
    ).toEqual([]);
    // A custom pattern's tokens are no address the vault keeps.
    expect(
      losses(
        {
          patternType: LogScrubPatternType.Custom,
          customRegex: "\\d+\\.\\d+\\.\\d+\\.\\d+",
          scrubAction: LogScrubAction.Hash,
        },
        [LOGS],
      ),
    ).toEqual([SecurityEventsFieldNeed.ClientAddresses]);
  });

  test("an email rule that redacts or masks makes every user one; one that hashes keeps them apart", () => {
    expect(losses({}, [LOGS])).toEqual([SecurityEventsFieldNeed.UserNames]);
    expect(losses({ scrubAction: LogScrubAction.Mask }, [LOGS])).toEqual([
      SecurityEventsFieldNeed.UserNames,
    ]);
    expect(losses({ scrubAction: LogScrubAction.Hash }, [LOGS])).toEqual([]);
  });

  test("a rule that hides nothing Security Events names an attack by takes nothing", () => {
    expect(losses({ patternType: LogScrubPatternType.CreditCard }, [LOGS])).toEqual(
      [],
    );
    expect(
      losses({ patternType: LogScrubPatternType.SensitiveKeys }, [LOGS, TRACES]),
    ).toEqual([]);
  });

  test("no scan reads the records: nothing taken", () => {
    expect(losses({ patternType: LogScrubPatternType.IPAddress }, [])).toEqual(
      [],
    );
  });

  test("where it reads: a span's attributes, not its name; Your logs follows a line into its span for the address only", () => {
    const traceRule: (fields: string) => Partial<ScrubRuleReading> = (
      fields: string,
    ): Partial<ScrubRuleReading> => {
      return {
        signal: "trace" as TelemetryFieldSignal,
        fieldsToScrub: fields,
      };
    };

    expect(
      losses(
        {
          ...traceRule(TraceScrubField.Name),
          patternType: LogScrubPatternType.IPAddress,
        },
        [TRACES],
      ),
    ).toEqual([]);
    expect(
      losses(
        {
          ...traceRule(TraceScrubField.All),
          patternType: LogScrubPatternType.IPAddress,
        },
        [LOGS],
      ),
    ).toEqual([SecurityEventsFieldNeed.ClientAddresses]);
    expect(losses(traceRule(TraceScrubField.All), [LOGS])).toEqual([]);
    expect(losses(traceRule(TraceScrubField.All), [TRACES])).toEqual([
      SecurityEventsFieldNeed.UserNames,
    ]);
  });
});
