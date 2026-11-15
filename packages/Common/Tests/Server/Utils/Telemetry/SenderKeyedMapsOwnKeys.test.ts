import { afterEach, describe, expect, test } from "@jest/globals";
import {
  MAX_CHANGE_EVENT_AGE_IN_DAYS,
  MAX_CHANGE_EVENT_ATTRIBUTES,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
  parseChangeEventIngestEntry,
} from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import LogRecordingRuleQuery, {
  LogRecordingRulePoint,
} from "../../../../Server/Utils/Telemetry/LogRecordingRuleQuery";
import LogRecordingRuleMetric from "../../../../Server/Utils/Telemetry/LogRecordingRuleMetric";
import InventoryItem, {
  EntityAttributes,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import { buildSecurityEventDbRow } from "../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import {
  resolveCloudResourceOf,
  storedAttributesOf,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LogRecordingRuleDefinitionUtil,
} from "../../../../Types/Log/LogRecordingRuleDefinition";
import ObjectID from "../../../../Types/ObjectID";
import {
  OpenStackCapacityHost,
  OpenStackFlavorFit,
  OpenStackInventories,
  OpenStackPlacementAnswer,
  getOpenStackFlavorFit,
  getOpenStackPlacementAnswer,
} from "../../../../Types/OpenStack/OpenStackCapacity";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { readOwnValue, writeOwnValue } from "../../../../Utils/LookupTable";
import { flattenPayload } from "../../../../Utils/SecurityEvent/NormalizerHelpers";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";

/*
 * ISSUE #8220: MAPS KEYED BY WHAT A SENDER WROTE KEEP A KEY NAMED __proto__.
 *
 * An attribute, a label, an id key or a period has no reserved names, and
 * every object inherits "__proto__" as a setter: `map[key] = value` ignores a
 * string under it and makes an object under it the map's prototype, and
 * `{ ...map }` - Object.assign, on this code's ES2017 target - does the same.
 * PR #8219 fixed the OTLP paths; these are the rest #8220 lists, each now
 * written with writeOwnValue, copied with copyOwnValues or merged with
 * assignOwnValues (Common/Utils/LookupTable).
 *
 * Inputs are built with JSON.parse, so a "__proto__" key is the input's own,
 * as a decoded request body holds it. Every name Object.prototype has is a
 * case (INHERITED_PROPERTY_NAMES), and after each test nothing may have been
 * written onto Object.prototype or the Object function.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "checkout",
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

// A JSON object, decoded: every name as its own key, each with its own text.
function everyName(prefix: string = "own"): JSONObject {
  return JSON.parse(
    `{${INHERITED_PROPERTY_NAMES.map((name: string): string => {
      return `${JSON.stringify(name)}:${JSON.stringify(`${prefix} ${name}`)}`;
    }).join(",")}}`,
  ) as JSONObject;
}

// One key, decoded: `{ "<name>": <value> }` with the key as the object's own.
function decoded(name: string, value: unknown): JSONObject {
  return JSON.parse(
    `{${JSON.stringify(name)}:${JSON.stringify(value)}}`,
  ) as JSONObject;
}

// What a map holds as its own, key by key, and that it is a plain object still.
function ownEntriesOf(map: unknown): Array<[string, unknown]> {
  expect(Object.getPrototypeOf(map)).toBe(Object.prototype);

  return Object.keys(map as JSONObject).map(
    (key: string): [string, unknown] => {
      return [key, readOwnValue(map as JSONObject, key)];
    },
  );
}

describe("a change event's attributes (ChangeEventRow)", () => {
  function parse(entry: JSONObject): ParsedChangeEventEntry {
    const parsed: ParsedChangeEventEntry | null =
      parseChangeEventIngestEntry(entry);

    if (!parsed) {
      throw new Error("expected the entry to parse");
    }

    return parsed;
  }

  test("every name a posted event's attributes hold is one of its attributes, __proto__ included", () => {
    const parsed: ParsedChangeEventEntry = parse({
      title: "Deploy 2.3.1",
      attributes: everyName(),
    });

    expect(ownEntriesOf(parsed.attributes)).toEqual(
      INHERITED_PROPERTY_NAMES.map((name: string): [string, string] => {
        return [name, `own ${name}`];
      }),
    );
  });

  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s is stored on the row, listed in attributeKeys and in the insert's JSON",
    (name: string) => {
      const parsed: ParsedChangeEventEntry = parse({
        title: "Deploy 2.3.1",
        attributes: JSON.parse(
          `{${JSON.stringify(name)}:"x","team":"payments"}`,
        ) as JSONObject,
      });
      const row: JSONObject = buildChangeEventDbRow({
        parsed,
        projectId: PROJECT_ID,
        serviceMetadata: SERVICE_METADATA,
        retentionDays: 30,
        systemAttributes: { "oneuptime.change.source": "api" },
      });
      const attributes: JSONObject = row["attributes"] as JSONObject;

      expect(ownEntriesOf(attributes)).toEqual([
        [name, "x"],
        ["team", "payments"],
        ["oneuptime.change.source", "api"],
      ]);
      expect(row["attributeKeys"]).toEqual(
        [name, "team", "oneuptime.change.source"].sort(),
      );
      expect(
        readOwnValue(
          (JSON.parse(JSON.stringify(row)) as JSONObject)[
            "attributes"
          ] as JSONObject,
          name,
        ),
      ).toBe("x");
    },
  );

  test('the issue\'s case: {"__proto__":"x","team":"a"} is stored with both keys', () => {
    const parsed: ParsedChangeEventEntry = parse(
      JSON.parse(
        '{"title":"Deploy","attributes":{"__proto__":"x","team":"a"}}',
      ) as JSONObject,
    );
    const row: JSONObject = buildChangeEventDbRow({
      parsed,
      projectId: PROJECT_ID,
      serviceMetadata: SERVICE_METADATA,
      retentionDays: 30,
    });

    expect(ownEntriesOf(row["attributes"])).toEqual([
      ["__proto__", "x"],
      ["team", "a"],
    ]);
    expect(row["attributeKeys"]).toEqual(["__proto__", "team"]);
  });

  test("a number or a boolean under __proto__ is kept as its text, as under any key", () => {
    expect(
      ownEntriesOf(
        parse({ title: "Deploy", attributes: decoded("__proto__", 42) })
          .attributes,
      ),
    ).toEqual([["__proto__", "42"]]);
    expect(
      ownEntriesOf(
        parse({ title: "Deploy", attributes: decoded("__proto__", false) })
          .attributes,
      ),
    ).toEqual([["__proto__", "false"]]);
  });

  test("an object or an array under __proto__ is no attribute, as under any key, and never the map's prototype", () => {
    for (const value of [{ polluted: "yes" }, ["a", "b"], null]) {
      const parsed: ParsedChangeEventEntry = parse({
        title: "Deploy",
        attributes: JSON.parse(
          `{"__proto__":${JSON.stringify(value)},"team":"a"}`,
        ) as JSONObject,
      });

      expect(ownEntriesOf(parsed.attributes)).toEqual([["team", "a"]]);
      expect(
        (parsed.attributes as Record<string, unknown>)["polluted"],
      ).toBeUndefined();
    }
  });

  test("an attribute named __proto__ counts towards the cap like any other, and is kept within it", () => {
    const attributes: JSONObject = decoded("__proto__", "first");

    for (let index: number = 0; index < MAX_CHANGE_EVENT_ATTRIBUTES; index++) {
      attributes[`key.${index}`] = "v";
    }

    const parsed: ParsedChangeEventEntry = parse({
      title: "Deploy",
      attributes,
    });

    expect(Object.keys(parsed.attributes)).toHaveLength(
      MAX_CHANGE_EVENT_ATTRIBUTES,
    );
    expect(readOwnValue(parsed.attributes, "__proto__")).toBe("first");
    expect(
      readOwnValue(parsed.attributes, `key.${MAX_CHANGE_EVENT_ATTRIBUTES - 1}`),
    ).toBeUndefined();
  });

  test("an event whose time is out of bounds keeps its __proto__ attribute beside the original time", () => {
    const longAgo: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -(MAX_CHANGE_EVENT_AGE_IN_DAYS + 5),
    );
    const parsed: ParsedChangeEventEntry = parse({
      title: "Deploy",
      time: longAgo.toISOString(),
      attributes: decoded("__proto__", "x"),
    });
    const row: JSONObject = buildChangeEventDbRow({
      parsed,
      projectId: PROJECT_ID,
      serviceMetadata: SERVICE_METADATA,
      retentionDays: 30,
    });
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(readOwnValue(attributes, "__proto__")).toBe("x");
    expect(Object.keys(attributes).sort()).toEqual(
      ["__proto__", "oneuptime.original_time"].sort(),
    );
    // The parsed entry's own map is not the row's: the row is its own copy.
    expect(Object.keys(parsed.attributes)).toEqual(["__proto__"]);
  });

  test("OneUptime's own attributes are still written over a posted value of the same name", () => {
    const parsed: ParsedChangeEventEntry = parse({
      title: "Deploy",
      attributes: JSON.parse(
        '{"__proto__":"x","deploy.source":"posted"}',
      ) as JSONObject,
    });
    const row: JSONObject = buildChangeEventDbRow({
      parsed,
      projectId: PROJECT_ID,
      serviceMetadata: SERVICE_METADATA,
      retentionDays: 30,
      systemAttributes: { "deploy.source": "oneuptime" },
    });

    expect(ownEntriesOf(row["attributes"])).toEqual([
      ["__proto__", "x"],
      ["deploy.source", "oneuptime"],
    ]);
  });
});

describe("a log recording rule grouped by an attribute named like what every object inherits", () => {
  const WINDOW: {
    startTime: Date;
    endTime: Date;
    minutes: number;
    skippedMinutes: number;
  } = {
    startTime: new Date("2026-10-07T10:00:00.000Z"),
    endTime: new Date("2026-10-07T10:03:00.000Z"),
    minutes: 3,
    skippedMinutes: 0,
  };
  const MINUTE: number = WINDOW.startTime.getTime() / 1000;

  function pointsGroupedBy(
    groupBy: Array<string>,
    rows: Array<JSONObject>,
  ): Array<LogRecordingRulePoint> {
    return LogRecordingRuleQuery.readPoints({
      rows,
      definition: LogRecordingRuleDefinitionUtil.normalize({
        filter: {},
        aggregationType: AggregationType.Count,
        groupByAttributes: groupBy,
      }),
      window: WINDOW,
    }).points;
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a rule grouped by %s alone has one series per value, and each row carries it as an attribute",
    (name: string) => {
      const points: Array<LogRecordingRulePoint> = pointsGroupedBy(
        [name],
        [
          { bucket: MINUTE, g0: "a", matchedLogs: "2", value: 2 },
          { bucket: MINUTE, g0: "b", matchedLogs: "1", value: 1 },
        ],
      );

      expect(
        points.map((point: LogRecordingRulePoint) => {
          return ownEntriesOf(point.groupValues);
        }),
      ).toEqual([[[name, "a"]], [[name, "b"]]]);

      const ruleId: ObjectID = ObjectID.generate();
      const rows: Array<JSONObject> = LogRecordingRuleMetric.buildRows({
        ruleId,
        projectId: PROJECT_ID,
        outputMetricName: "checkout.requests",
        points,
        now: WINDOW.endTime,
      });

      expect(
        rows.map((row: JSONObject) => {
          return ownEntriesOf(row["attributes"]);
        }),
      ).toEqual([
        [
          [name, "a"],
          [LOG_RECORDING_RULE_ID_ATTRIBUTE, ruleId.toString()],
        ],
        [
          [name, "b"],
          [LOG_RECORDING_RULE_ID_ATTRIBUTE, ruleId.toString()],
        ],
      ]);
      expect(rows[0]!["attributeKeys"]).toEqual(
        [name, LOG_RECORDING_RULE_ID_ATTRIBUTE].sort(),
      );
      // As the insert's JSON sends it.
      expect(
        readOwnValue(
          (JSON.parse(JSON.stringify(rows[1])) as JSONObject)[
            "attributes"
          ] as JSONObject,
          name,
        ),
      ).toBe("b");
    },
  );

  test("a log that lacked the group-by attribute is written without it, __proto__ as any other", () => {
    const points: Array<LogRecordingRulePoint> = pointsGroupedBy(
      ["__proto__", "team"],
      [{ bucket: MINUTE, g0: "", g1: "payments", matchedLogs: "1", value: 1 }],
    );

    expect(ownEntriesOf(points[0]!.groupValues)).toEqual([
      ["__proto__", ""],
      ["team", "payments"],
    ]);

    const row: JSONObject = LogRecordingRuleMetric.buildRows({
      ruleId: ObjectID.generate(),
      projectId: PROJECT_ID,
      outputMetricName: "checkout.requests",
      points,
      now: WINDOW.endTime,
    })[0]!;

    expect(Object.keys(row["attributes"] as JSONObject)).toEqual([
      "team",
      LOG_RECORDING_RULE_ID_ATTRIBUTE,
    ]);
  });

  test("the rule's id is still written last, so no group-by value stands in for it", () => {
    const ruleId: ObjectID = ObjectID.generate();
    const row: JSONObject = LogRecordingRuleMetric.buildRows({
      ruleId,
      projectId: PROJECT_ID,
      outputMetricName: "checkout.requests",
      points: [
        {
          bucketStart: WINDOW.startTime,
          groupValues: JSON.parse(
            `{"__proto__":"x",${JSON.stringify(LOG_RECORDING_RULE_ID_ATTRIBUTE)}:"forged"}`,
          ) as Record<string, string>,
          value: 1,
          matchedLogs: 1,
        },
      ],
      now: WINDOW.endTime,
    })[0]!;

    expect(ownEntriesOf(row["attributes"])).toEqual([
      ["__proto__", "x"],
      [LOG_RECORDING_RULE_ID_ATTRIBUTE, ruleId.toString()],
    ]);
  });
});

describe("an OTLP entity_ref whose id or description keys are named like what every object inherits (TelemetryEntity)", () => {
  const PROJECT: string = PROJECT_ID.toString();

  function hostsFrom(
    attributes: EntityAttributes,
    idKeys: Array<string>,
    descriptionKeys: Array<string> = [],
  ): Array<ExtractedEntity> {
    return InventoryItem.extractEntities({
      projectId: PROJECT,
      attributes,
      entityRefs: [{ type: "host", idKeys, descriptionKeys }],
    }).filter((entity: ExtractedEntity): boolean => {
      return entity.entityType === EntityType.Host;
    });
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "an id key named %s identifies the entity: its value is the entity's identity, and two values are two entities",
    (name: string) => {
      const first: Array<ExtractedEntity> = hostsFrom(
        decoded(name, "Web-1") as EntityAttributes,
        [name],
      );
      const second: Array<ExtractedEntity> = hostsFrom(
        decoded(name, "web-2") as EntityAttributes,
        [name],
      );

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      // Canonicalized as every identifying value is: trimmed and lowercased.
      expect(ownEntriesOf(first[0]!.identifyingAttributes)).toEqual([
        [name, "web-1"],
      ]);
      expect(first[0]!.entityKey).toBe(
        InventoryItem.computeEntityKey({
          projectId: PROJECT,
          entityType: EntityType.Host,
          identifyingAttributes: decoded(name, "web-1") as Record<
            string,
            string
          >,
        }),
      );
      expect(first[0]!.entityKey).not.toBe(second[0]!.entityKey);
      // Never the key of an entity identified by nothing at all.
      expect(first[0]!.entityKey).not.toBe(
        InventoryItem.computeEntityKey({
          projectId: PROJECT,
          entityType: EntityType.Host,
          identifyingAttributes: {},
        }),
      );
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "an id key named %s that the resource does not hold makes the ref unusable, never an identity of what every object inherits",
    (name: string) => {
      const hosts: Array<ExtractedEntity> = hostsFrom(
        { "host.name": "web-1" },
        [name],
      );

      // The ref names no id the resource has, so host.name identifies it, as for any unusable ref.
      expect(
        hosts.map((host: ExtractedEntity) => {
          return ownEntriesOf(host.identifyingAttributes);
        }),
      ).toEqual([[["host.name", "web-1"]]]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a description key named %s is one of the entity's descriptive attributes",
    (name: string) => {
      const attributes: EntityAttributes = JSON.parse(
        `{"host.name":"web-1",${JSON.stringify(name)}:"rack 4"}`,
      ) as EntityAttributes;
      const hosts: Array<ExtractedEntity> = hostsFrom(
        attributes,
        ["host.name"],
        [name],
      );

      expect(hosts).toHaveLength(1);
      expect(ownEntriesOf(hosts[0]!.descriptiveAttributes)).toEqual([
        [name, "rack 4"],
      ]);
      // Descriptive attributes never feed the key.
      expect(hosts[0]!.entityKey).toBe(
        hostsFrom({ "host.name": "web-1" }, ["host.name"])[0]!.entityKey,
      );
    },
  );

  test("the identifying set keeps every key of a ref keyed by several, __proto__ among them", () => {
    const hosts: Array<ExtractedEntity> = hostsFrom(
      JSON.parse(
        '{"host.name":"web-1","__proto__":"eu-1","toString":"r4"}',
      ) as EntityAttributes,
      ["host.name", "__proto__", "toString"],
    );

    expect(hosts).toHaveLength(1);
    expect(ownEntriesOf(hosts[0]!.identifyingAttributes)).toEqual([
      ["host.name", "web-1"],
      ["__proto__", "eu-1"],
      ["toString", "r4"],
    ]);
  });
});

describe("a security event's attributes (SecurityEventRow, flattenPayload)", () => {
  function normalized(attributes: JSONObject): NormalizedSecurityEvent {
    return {
      time: OneUptimeDate.getCurrentDate(),
      eventUid: "event-uid-1",
      categoryUid: 3,
      categoryName: "Identity & Access Management",
      classUid: 3002,
      className: "Authentication",
      activityName: "Logon",
      severityId: 4,
      severityName: OcsfSeverity.High,
      statusName: "Failure",
      message: "Failed login for alice",
      vendorName: "TestVendor",
      productName: "TestProduct",
      ruleId: "rule-1",
      ruleName: "Failed Logins",
      mitreTactics: [],
      mitreTechniques: [],
      principalUser: "alice",
      principalHost: "",
      principalIp: "",
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser: "",
      targetHost: "",
      targetIp: "",
      targetPort: 0,
      targetResource: "",
      observables: [],
      attributes,
    };
  }

  function rowOf(event: NormalizedSecurityEvent): JSONObject {
    return buildSecurityEventDbRow({
      normalized: event,
      projectId: PROJECT_ID,
      serviceMetadata: SERVICE_METADATA,
      retentionDays: 30,
    });
  }

  test("every name a source's payload holds at its top is one of the flattened attributes", () => {
    expect(ownEntriesOf(flattenPayload(everyName()))).toEqual(
      INHERITED_PROPERTY_NAMES.map((name: string): [string, string] => {
        return [name, `own ${name}`];
      }),
    );
  });

  test("a __proto__ field is flattened like any other: a number as text, a list of scalars joined, an object by its keys", () => {
    expect(ownEntriesOf(flattenPayload(decoded("__proto__", 7)))).toEqual([
      ["__proto__", "7"],
    ]);
    expect(
      ownEntriesOf(flattenPayload(decoded("__proto__", ["a", 1, true]))),
    ).toEqual([["__proto__", "a,1,true"]]);
    expect(
      ownEntriesOf(
        flattenPayload(decoded("__proto__", { polluted: "yes", n: 1 })),
      ),
    ).toEqual([
      ["__proto__.polluted", "yes"],
      ["__proto__.n", "1"],
    ]);
    expect(
      ownEntriesOf(
        flattenPayload(
          JSON.parse('{"user":{"__proto__":"admin"}}') as JSONObject,
        ),
      ),
    ).toEqual([["user.__proto__", "admin"]]);
  });

  test("a payload deeper than the cap keeps a __proto__ field as its JSON", () => {
    expect(
      ownEntriesOf(flattenPayload(decoded("__proto__", { a: { b: 1 } }), 1)),
    ).toEqual([["__proto__", '{"a":{"b":1}}']]);
  });

  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s is on the event's row and in its attributeKeys",
    (name: string) => {
      const row: JSONObject = rowOf(
        normalized(
          JSON.parse(
            `{${JSON.stringify(name)}:"x","user.name":"alice"}`,
          ) as JSONObject,
        ),
      );

      expect(ownEntriesOf(row["attributes"])).toEqual([
        [name, "x"],
        ["user.name", "alice"],
      ]);
      expect(row["attributeKeys"]).toEqual([name, "user.name"].sort());
      expect(
        readOwnValue(
          (JSON.parse(JSON.stringify(row)) as JSONObject)[
            "attributes"
          ] as JSONObject,
          name,
        ),
      ).toBe("x");
    },
  );

  test("an event stamped with the ingestion time keeps its __proto__ attribute, and the source's map is left as it was", () => {
    const attributes: JSONObject = decoded("__proto__", "x");
    const event: NormalizedSecurityEvent = normalized(attributes);

    event.time = new Date("2000-01-01T00:00:00.000Z");

    const row: JSONObject = rowOf(event);

    expect(ownEntriesOf(row["attributes"])).toEqual([
      ["__proto__", "x"],
      ["oneuptime.original_time", String(event.time)],
    ]);
    expect(row["attributes"]).not.toBe(attributes);
    expect(Object.keys(attributes)).toEqual(["__proto__"]);
  });
});

describe("a cloud metric's dimensions (CloudMetricPayload.storedAttributesOf)", () => {
  function attribute(key: string, value: string): JSONObject {
    return { key: key, value: { stringValue: value } };
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a datapoint dimension named %s is in the map the resolver reads, as on the stored row",
    (name: string) => {
      const stored: JSONObject = storedAttributesOf(
        [
          attribute("cloud.provider", "aws"),
          attribute(name, "resource's"),
        ] as never,
        [attribute(name, "x"), attribute("region", "eu-west-1")] as never,
      ) as JSONObject;

      expect(ownEntriesOf(stored)).toEqual([
        ["resource.cloud.provider", "aws"],
        [`resource.${name}`, "resource's"],
        [name, "x"],
        ["region", "eu-west-1"],
      ]);
    },
  );

  test('the issue\'s case: a datapoint attribute { key: "__proto__" } is in the returned map', () => {
    const stored: JSONObject = storedAttributesOf(
      [] as never,
      [attribute("__proto__", "x")] as never,
    ) as JSONObject;

    expect(ownEntriesOf(stored)).toEqual([["__proto__", "x"]]);
  });

  test("a datapoint's own key wins over the resource's, as the ingest merges them", () => {
    const stored: JSONObject = storedAttributesOf(
      [attribute("service.name", "resource")] as never,
      [attribute("resource.service.name", "datapoint")] as never,
    ) as JSONObject;

    expect(ownEntriesOf(stored)).toEqual([
      ["resource.service.name", "datapoint"],
    ]);
  });

  test("resolving a resource from dimensions named like what every object inherits finds nothing and throws nothing", () => {
    expect(
      resolveCloudResourceOf({
        metricName: "aws.ec2.cpuutilization",
        resourceAttributes: INHERITED_PROPERTY_NAMES.map((name: string) => {
          return attribute(name, "x");
        }) as never,
        datapointAttributes: INHERITED_PROPERTY_NAMES.map((name: string) => {
          return attribute(name, "y");
        }) as never,
      }),
    ).toBeNull();
  });
});

describe("OpenStack capacity by the names a cloud gives its zones, aggregates and resource classes (OpenStackCapacity)", () => {
  function inventoriesWith(name: string): OpenStackInventories {
    const inventories: OpenStackInventories = {};

    // As readOpenStackInventories keeps a class of each name: the host's own key.
    writeOwnValue(inventories, "VCPU", {
      total: 8,
      reserved: 0,
      allocationRatio: 1,
      used: 8,
    });
    writeOwnValue(inventories, name, {
      total: 4,
      reserved: 0,
      allocationRatio: 1,
      used: 4,
    });

    return inventories;
  }

  function capacityHost(
    name: string,
    extra: Partial<OpenStackCapacityHost> = {},
  ): OpenStackCapacityHost {
    return {
      name,
      regionName: "RegionOne",
      zone: "nova",
      aggregates: [],
      state: "up",
      instanceCount: 0,
      inventories: {
        VCPU: { total: 16, reserved: 0, allocationRatio: 1, used: 0 },
      },
      ...extra,
    };
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a host full of a resource class named %s still fits the flavor when empty",
    (name: string) => {
      const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
        resources: JSON.parse(`{"VCPU":1,${JSON.stringify(name)}:1}`) as Record<
          string,
          number
        >,
        hosts: [
          capacityHost("compute-01", { inventories: inventoriesWith(name) }),
        ],
      });

      expect(fit.fits).toBe(0);
      expect(fit.fitsOnAnEmptyHost).toBe(true);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a flavor asking for a resource class named %s that a host does not list fits none there",
    (name: string) => {
      const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
        resources: JSON.parse(`{${JSON.stringify(name)}:1}`) as Record<
          string,
          number
        >,
        hosts: [capacityHost("compute-01")],
      });

      expect(fit.fits).toBe(0);
      expect(fit.fitsOnAnEmptyHost).toBe(false);
      expect(fit.limitedBy).toBe(name);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "the fit adds up under a zone and an aggregate named %s",
    (name: string) => {
      const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
        resources: { VCPU: 4 },
        hosts: [
          capacityHost("compute-01", {
            zone: name,
            aggregates: [name, "gold"],
          }),
          capacityHost("compute-02", { zone: name, aggregates: [name] }),
          capacityHost("compute-03", { zone: "nova" }),
        ],
      });

      expect(fit.fits).toBe(12);
      expect(ownEntriesOf(fit.byZone)).toEqual([
        [name, 8],
        ["nova", 4],
      ]);
      expect(ownEntriesOf(fit.byAggregate)).toEqual([
        [name, 8],
        ["gold", 4],
      ]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "what stops the most hosts is a resource class named %s when it does",
    (name: string) => {
      const full: OpenStackInventories = inventoriesWith(name);

      // Room for VCPU on each, none of the named class.
      writeOwnValue(full, "VCPU", {
        total: 16,
        reserved: 0,
        allocationRatio: 1,
        used: 0,
      });

      const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
        resources: JSON.parse(`{"VCPU":1,${JSON.stringify(name)}:1}`) as Record<
          string,
          number
        >,
        hosts: [
          capacityHost("compute-01", { inventories: full }),
          capacityHost("compute-02", { inventories: full }),
        ],
      });

      expect(fit.fits).toBe(0);
      expect(fit.limitedBy).toBe(name);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "Placement's answer adds up under a zone and an aggregate named %s",
    (name: string) => {
      const answer: OpenStackPlacementAnswer = getOpenStackPlacementAnswer({
        candidates: [
          { rootProviderUuid: "uuid-1", fit: 3 },
          { rootProviderUuid: "uuid-2", fit: 2 },
        ],
        providerNames: new Map([
          ["uuid-1", "compute-01.example.org"],
          ["uuid-2", "compute-02.example.org"],
        ]),
        hostsByShortName: new Map([
          [
            "compute-01",
            { name: "compute-01", zone: name, aggregates: [name], state: "up" },
          ],
          [
            "compute-02",
            {
              name: "compute-02",
              zone: "nova",
              aggregates: [name],
              state: "up",
            },
          ],
        ]),
        candidateLimit: 1000,
      });

      expect(answer.fits).toBe(5);
      expect(ownEntriesOf(answer.byZone)).toEqual([
        [name, 3],
        ["nova", 2],
      ]);
      expect(ownEntriesOf(answer.byAggregate)).toEqual([[name, 5]]);
    },
  );
});
