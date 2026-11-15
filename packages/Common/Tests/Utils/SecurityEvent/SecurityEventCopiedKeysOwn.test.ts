import { afterEach, describe, expect, test } from "@jest/globals";
import { INHERITED_PROPERTY_NAMES } from "../../Helpers/InheritedNames";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  SECURITY_HUNT_MESSAGES,
  SecurityHuntFilters,
  readSecurityHuntFilters,
  securityHuntFiltersFromMap,
} from "../../../Types/SecurityEvent/SecurityHunt";
import { readOwnValue } from "../../../Utils/LookupTable";
import { parseKeyValuePairs } from "../../../Utils/Log/KeyValueParser";
import { readGoogleWorkspaceActivity } from "../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceNormalizer";
import { toUdmEvent } from "../../../Utils/SecurityEvent/Destinations/GoogleSecOpsUdmMapper";
import {
  SecurityEventRecord,
  readSecurityEventRecord,
} from "../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import {
  toEcsDocument,
  toSentinelRecord,
  toSplunkHecEvent,
} from "../../../Utils/SecurityEvent/Destinations/SiemEventMappers";
import CloudTrailLogParser from "../../../Utils/SecurityEvent/LogParsers/CloudTrailLogParser";
import KubernetesAuditLogParser from "../../../Utils/SecurityEvent/LogParsers/KubernetesAuditLogParser";
import { boundAttributes } from "../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import WindowsEventLogParser from "../../../Utils/SecurityEvent/LogParsers/WindowsEventLogParser";
import {
  SecurityEventSearchFilters,
  buildSecurityEventSearchQuery,
  parseSecurityEventSearch,
} from "../../../Utils/SecurityEvent/SecurityEventSearch";
import {
  buildSecurityHuntQuery,
  getSecurityHuntFiltersProblem,
} from "../../../Utils/SecurityEvent/SecurityHuntSearch";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { buildTelemetrySecurityEvent } from "../../../Utils/SecurityEvent/TelemetryScan/TelemetrySecurityEvent";
import { googleWorkspaceActivity } from "./Connectors/GoogleWorkspaceFixtures";
import { securityEventRecord } from "./Destinations/SecurityEventRecordFixtures";
import {
  auditEvent,
  cloudTrailRecord,
  logLine,
} from "./LogParsers/LogParserFixtures";
import {
  collectorOtlpBody,
  failedSignIn,
} from "./LogParsers/WindowsEventFixtures";

/*
 * ISSUES #8486 AND #8487: A SECURITY EVENT KEEPS EVERY KEY ITS SOURCE WROTE.
 *
 * A log's fields, a vendor's activity, a stored event's attributes and a
 * Sigma rule's names reach these as keys, and each path copied them onto a
 * new object with an assignment - which drops a key named "__proto__"
 * (every object inherits it as a setter) - or read one with a plain read,
 * which answers "constructor" or "toString" with what every object
 * inherits. Each now writes and reads the keys as the object's own
 * (Common/Utils/LookupTable), and CopiedKeysWrittenAsOwnGuard keeps a new
 * copy from going back to an assignment.
 *
 * Two refusals of "__proto__" are lifted with them (#8487): the security
 * log line's record attributes and the log pipeline's key=value parser,
 * whose every write is an own-key write now.
 *
 * Inputs are built with JSON.parse (or a computed key, which defines one),
 * so a "__proto__" key is the input's own, as a decoded body holds it, and
 * every test checks nothing was written onto Object.prototype.
 */

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();
const OBJECT_FUNCTION_KEYS: Array<string> =
  Object.getOwnPropertyNames(Object).sort();

afterEach(() => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
  expect(Object.getOwnPropertyNames(Object).sort()).toEqual(
    OBJECT_FUNCTION_KEYS,
  );
  expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
});

// One key, decoded: `{ "<name>": <value> }`, the key the object's own.
function decoded(name: string, value: unknown): JSONObject {
  return JSON.parse(
    `{${JSON.stringify(name)}:${JSON.stringify(value)}}`,
  ) as JSONObject;
}

// Every inherited name as its own key, each with its own text.
function everyName(prefix: string = "own"): JSONObject {
  return JSON.parse(
    `{${INHERITED_PROPERTY_NAMES.map((name: string): string => {
      return `${JSON.stringify(name)}:${JSON.stringify(`${prefix} ${name}`)}`;
    }).join(",")}}`,
  ) as JSONObject;
}

function expectOwn(map: unknown, name: string, value: unknown): void {
  expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
  expect({ name, value: readOwnValue(map as JSONObject, name) }).toEqual({
    name,
    value,
  });
}

describe("a telemetry signal's security event (buildTelemetrySecurityEvent)", () => {
  test("every key the signal names is the event's own attribute", () => {
    const event: NormalizedSecurityEvent = buildTelemetrySecurityEvent({
      kind: SecurityTelemetrySourceKind.NetworkFlows,
      signal: SecurityTelemetrySignal.PortScan,
      time: new Date("2026-10-27T10:00:00.000Z"),
      eventUid: "flow:port-scan:a:b:w",
      classUid: 4001,
      activityName: "Traffic",
      statusName: "",
      severity: OcsfSeverity.Medium,
      message: "Port scan",
      attributes: everyName(),
    });

    for (const name of INHERITED_PROPERTY_NAMES) {
      expectOwn(event.attributes, name, `own ${name}`);
    }
  });
});

describe("a stored security event, as the destinations read and send it", () => {
  function storedRecord(attributes: JSONObject): SecurityEventRecord {
    return readSecurityEventRecord({
      _id: "0192f1a0-0000-7000-8000-000000000101",
      time: "2026-10-19 10:00:00.000",
      eventUid: "evt-1",
      className: "Base Event",
      attributes,
    });
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s is read as the record's own",
    (name: string) => {
      const record: SecurityEventRecord = storedRecord(
        JSON.parse(
          `{${JSON.stringify(name)}:"x","team":"payments"}`,
        ) as JSONObject,
      );

      expectOwn(record.attributes, name, "x");
      expect(Object.keys(record.attributes)).toEqual([name, "team"]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s is in what Splunk, Sentinel and Elastic are sent",
    (name: string) => {
      const record: SecurityEventRecord = storedRecord(
        decoded(name, "the value"),
      );
      const attribute: string = `${JSON.stringify(name)}:"the value"`;

      expect(
        JSON.stringify(toSplunkHecEvent(record, { sourceType: "oneuptime" })),
      ).toContain(attribute);
      expect(JSON.stringify(toSentinelRecord(record))).toContain(attribute);
      // Elastic keeps a source's many attributes as one JSON text.
      expect(
        JSON.parse(
          (toEcsDocument(record)["oneuptime"] as JSONObject)[
            "attributes"
          ] as string,
        ),
      ).toEqual(decoded(name, "the value"));
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s is one of Google SecOps' additional fields, never taken as one of OneUptime's own",
    (name: string) => {
      const additional: JSONObject = toUdmEvent(
        securityEventRecord({
          attributes: decoded(name, "the value") as Record<string, string>,
        }),
      )["additional"] as JSONObject;

      expectOwn(additional, name, "the value");
      expect(additional["oneuptime_event_id"]).toBe(
        "0192f1a0-0000-7000-8000-000000000101",
      );
    },
  );
});

describe("a vendor's record, as the security log parsers keep it", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a Google Workspace activity's field named %s is one of the event's attributes",
    (name: string) => {
      const readings: ReturnType<typeof readGoogleWorkspaceActivity> =
        readGoogleWorkspaceActivity(
          googleWorkspaceActivity("login", "login_success", [], {
            [name]: "the activity's own",
          }),
        );

      expect(readings).toHaveLength(1);
      expectOwn(readings[0]!.attributes, name, "the activity's own");
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a CloudTrail record's field named %s is one of the event's attributes",
    (name: string) => {
      const events: Array<NormalizedSecurityEvent> = CloudTrailLogParser.parse(
        logLine(JSON.stringify(cloudTrailRecord({ [name]: "the record's" }))),
      );

      expect(events).toHaveLength(1);
      expectOwn(events[0]!.attributes, name, "the record's");
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a Kubernetes audit record's field named %s is one of the event's attributes",
    (name: string) => {
      const events: Array<NormalizedSecurityEvent> =
        KubernetesAuditLogParser.parse(
          logLine(
            JSON.stringify(
              auditEvent({
                verb: "create",
                requestURI:
                  "/api/v1/namespaces/default/pods/web-7d9/exec?command=sh",
                objectRef: {
                  resource: "pods",
                  namespace: "default",
                  name: "web-7d9",
                  subresource: "exec",
                  apiVersion: "v1",
                },
                responseStatus: { metadata: {}, code: 101 },
                [name]: "the record's",
              }),
            ),
          ),
        );

      expect(events.length).toBeGreaterThan(0);
      expectOwn(events[0]!.attributes, name, "the record's");
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a record's field named %s is kept by boundAttributes as the event's own (#8487)",
    (name: string) => {
      const bounded: JSONObject = boundAttributes(
        JSON.parse(
          `{"user.name":"alice",${JSON.stringify(name)}:"the record's",${JSON.stringify(`${name}.nested`)}:7}`,
        ) as JSONObject,
      );

      expectOwn(bounded, name, "the record's");
      expectOwn(bounded, `${name}.nested`, "7");
      expect(Object.keys(bounded)).toEqual([
        "user.name",
        name,
        `${name}.nested`,
      ]);
    },
  );

  test("an object handed to boundAttributes under __proto__ is kept as text, never a prototype", () => {
    const bounded: JSONObject = boundAttributes(
      JSON.parse('{"__proto__":{"polluted":"yes"}}') as JSONObject,
    );

    // It is handed what flattenPayload made, so an object here is only ever text.
    expect(Object.getPrototypeOf(bounded)).toBe(Object.prototype);
    expect((bounded as Record<string, unknown>)["polluted"]).toBeUndefined();
    expectOwn(bounded, "__proto__", "[object Object]");
  });

  test("a record's object under __proto__ is flattened into keys of the event's own, never a prototype", () => {
    const record: JSONObject = cloudTrailRecord({});

    Object.defineProperty(record, "__proto__", {
      value: { polluted: "yes", nested: { isAdmin: true } },
      enumerable: true,
      writable: true,
      configurable: true,
    });

    const events: Array<NormalizedSecurityEvent> = CloudTrailLogParser.parse(
      logLine(JSON.stringify(record)),
    );
    const attributes: JSONObject = events[0]!.attributes;

    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    expect(readOwnValue(attributes, "__proto__.polluted")).toBe("yes");
    expect(readOwnValue(attributes, "__proto__.nested.isAdmin")).toBe("true");
    expect((attributes as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test.each(
    INHERITED_PROPERTY_NAMES.filter((name: string): boolean => {
      return name !== "__proto__";
    }),
  )(
    "a Windows event's field named %s is one of the event's attributes, never taken as one the record already has",
    (name: string) => {
      const spec: ReturnType<typeof failedSignIn> = failedSignIn();
      spec.data = [...(spec.data || []), [name, "the event's own"]];

      const events: Array<NormalizedSecurityEvent> =
        WindowsEventLogParser.parse(
          logLine(collectorOtlpBody(spec), { "host.name": "win-01" }),
        );

      expect(events).toHaveLength(1);
      expectOwn(events[0]!.attributes, name, "the event's own");
    },
  );

  test("a Windows event's field named __proto__ is left out by the record reader, which refuses it, and touches nothing", () => {
    const spec: ReturnType<typeof failedSignIn> = failedSignIn();
    spec.data = [...(spec.data || []), ["__proto__", "polluted"]];

    const events: Array<NormalizedSecurityEvent> = WindowsEventLogParser.parse(
      logLine(collectorOtlpBody(spec), { "host.name": "win-01" }),
    );

    expect(events).toHaveLength(1);
    expect(Object.getPrototypeOf(events[0]!.attributes)).toBe(Object.prototype);
    expect(
      Object.getOwnPropertyDescriptor(events[0]!.attributes, "__proto__"),
    ).toBeUndefined();
  });
});

describe("a Sigma rule's names (SigmaRuleParser, SigmaRuleSetParser)", () => {
  const FAILED: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

  const SUCCEEDED: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

  test.each(INHERITED_PROPERTY_NAMES)(
    "a logsource field named %s is the rule's own",
    (name: string) => {
      const rule: ReturnType<typeof SigmaRuleParser.parse> =
        SigmaRuleParser.parse(`title: Logsource
logsource:
  product: windows
  ${JSON.stringify(name)}: the rule's
detection:
  selection:
    className: Authentication
  condition: selection`);

      expectOwn(rule.logsource, name, "the rule's");
      expectOwn(rule.logsource, "product", "windows");
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "an alias named %s says where each rule keeps the grouped value, and is checked like any other",
    (name: string) => {
      const definition: ReturnType<typeof SigmaRuleSetParser.parse> =
        SigmaRuleSetParser.parse(`title: Aliased
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [${JSON.stringify(name)}]
  timespan: 5m
  aliases:
    ${JSON.stringify(name)}:
      failed_sign_in: principalIp
      successful_sign_in: targetIp
---
${FAILED}
---
${SUCCEEDED}`);

      if (definition.kind !== "correlation") {
        throw new Error("expected a correlation");
      }

      expectOwn(definition.correlation.aliases, name, {
        failed_sign_in: "principalIp",
        successful_sign_in: "targetIp",
      });

      let refusal: string = "";

      try {
        SigmaRuleSetParser.parse(`title: Aliased
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [${JSON.stringify(name)}]
  timespan: 5m
  aliases:
    ${JSON.stringify(name)}:
      failed_sign_in: principalIp
---
${FAILED}
---
${SUCCEEDED}`);
      } catch (error) {
        expect(error).toBeInstanceOf(BadDataException);
        refusal = (error as Error).message;
      }

      // Assigned, an alias named __proto__ became the aliases' prototype and was never validated.
      expect(refusal).toBe(
        `Sigma correlation "Aliased": alias "${name}" does not say which field "successful_sign_in" keeps it in.`,
      );
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a rule named %s is a correlation's step, and an alias says which field it keeps the value in",
    (name: string) => {
      const definition: ReturnType<typeof SigmaRuleSetParser.parse> =
        SigmaRuleSetParser.parse(`title: Aliased
correlation:
  type: temporal
  rules: [${JSON.stringify(name)}, successful_sign_in]
  group-by: [address]
  timespan: 5m
  aliases:
    address:
      ${JSON.stringify(name)}: principalIp
      successful_sign_in: targetIp
---
title: Failed sign-in
name: ${JSON.stringify(name)}
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
${SUCCEEDED}`);

      if (definition.kind !== "correlation") {
        throw new Error("expected a correlation");
      }

      expect(
        definition.steps.map((step: { reference: string }): string => {
          return step.reference;
        }),
      ).toEqual([name, "successful_sign_in"]);
      // Assigned, the rule named __proto__ had no field, and the correlation was refused.
      expect(
        readOwnValue(definition.correlation.aliases, "address"),
      ).toBeDefined();
      expect(
        readOwnValue(definition.correlation.aliases["address"]!, name),
      ).toBe("principalIp");
    },
  );
});

describe("the security events search, its chips and hunts", () => {
  // How the search compiles `team:x`, `team:*x*` and a chip of `team` = x.
  const TYPED: unknown = parseSecurityEventSearch("team:x").attributes["team"];
  const CONTAINS: unknown =
    parseSecurityEventSearch("team:*x*").attributes["team"];

  function queryAttributes(query: unknown): JSONObject {
    return (query as JSONObject)["attributes"] as JSONObject;
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a search for %s:x, typed bare or with @, filters on that attribute as the filter's own key",
    (name: string) => {
      for (const search of [
        `${name}:x team:x`,
        `@${name}:x @team:x`,
        `${name}:*x* team:*x*`,
      ]) {
        const filters: SecurityEventSearchFilters =
          parseSecurityEventSearch(search);

        expect(Object.getPrototypeOf(filters.attributes)).toBe(
          Object.prototype,
        );
        expect({ search, keys: Object.keys(filters.attributes) }).toEqual({
          search,
          keys: [name, "team"],
        });
        expect(readOwnValue(filters.attributes, name)).toEqual(
          search.includes("*") ? CONTAINS : TYPED,
        );
      }
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "the Events page's query filters on an attribute named %s, typed or a chip, as the query's own key",
    (name: string) => {
      const typed: JSONObject = queryAttributes(
        buildSecurityEventSearchQuery({
          base: {},
          search: `@${name}:*x* team:x`,
          filters: new Map(),
        }),
      );

      expect(Object.getPrototypeOf(typed)).toBe(Object.prototype);
      expect(Object.keys(typed)).toEqual([name, "team"]);
      expect(readOwnValue(typed, name)).toEqual(CONTAINS);

      const chip: JSONObject = queryAttributes(
        buildSecurityEventSearchQuery({
          base: {},
          search: "team:x",
          filters: new Map([
            [`attributes.${name}`, new Set(["y"])],
            [`attributes.team`, new Set(["y", "z"])],
          ]),
        }),
      );

      expect(Object.getPrototypeOf(chip)).toBe(Object.prototype);
      expect(Object.keys(chip)).toEqual(["team", name]);
      expect(readOwnValue(chip, name)).toBe("y");
      expect(readOwnValue(chip, "team")).toBeInstanceOf(Includes);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a hunt's chips keep a key named %s as their own, read back and from the Events page's chips",
    (name: string) => {
      const read: SecurityHuntFilters = readSecurityHuntFilters(
        JSON.parse(
          `{${JSON.stringify(name)}:["a","a","b"],"team":["c"]}`,
        ) as Record<string, unknown>,
      );

      expectOwn(read, name, ["a", "b"]);
      expect(Object.keys(read)).toEqual([name, "team"]);
      // No chip is named so: kept, it is seen, and refused as one.
      expect(getSecurityHuntFiltersProblem(read)).toBe(
        SECURITY_HUNT_MESSAGES.unknownFilter.message,
      );

      const fromChips: SecurityHuntFilters = securityHuntFiltersFromMap(
        new Map([
          [name, new Set(["a", "b"])],
          ["team", new Set(["c"])],
        ]),
      );

      expectOwn(fromChips, name, ["a", "b"]);
      expect(Object.keys(fromChips)).toEqual([name, "team"]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a hunt with a chip of the attribute named %s reads that attribute",
    (name: string) => {
      const filters: SecurityHuntFilters = readSecurityHuntFilters(
        JSON.parse(`{${JSON.stringify(`attributes.${name}`)}:["a"]}`) as Record<
          string,
          unknown
        >,
      );

      expect(getSecurityHuntFiltersProblem(filters)).toBeNull();

      const attributes: JSONObject = queryAttributes(
        buildSecurityHuntQuery({
          projectId: ObjectID.generate(),
          searchQuery: `@${name}:*x*`,
          filters,
          startTime: new Date("2026-10-27T09:00:00.000Z"),
          endTime: new Date("2026-10-27T10:00:00.000Z"),
        }),
      );

      // The chip is steered with, so it wins over the typed filter.
      expect(Object.keys(attributes)).toEqual([name]);
      expect(readOwnValue(attributes, name)).toBe("a");
      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    },
  );
});

describe("the log pipeline's key=value parser (#8487)", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a line's pair named %s is one of the result's own keys",
    (name: string) => {
      const pairs: Record<string, string> = parseKeyValuePairs(
        `${name}=first a=1 ${name}=second`,
      );

      expectOwn(pairs, name, "first");
      expect(Object.keys(pairs)).toEqual([name, "a"]);
    },
  );

  test("__proto__= never becomes a prototype, whatever follows it", () => {
    const pairs: Record<string, string> = parseKeyValuePairs(
      '__proto__={"polluted":"yes"} a=1',
    );

    expect(Object.getPrototypeOf(pairs)).toBe(Object.prototype);
    expect(typeof readOwnValue(pairs, "__proto__")).toBe("string");
    expect((pairs as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
