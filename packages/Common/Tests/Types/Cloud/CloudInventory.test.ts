import {
  CLOUD_ENDPOINTS_MAX,
  CLOUD_PROPERTIES_MAX_BYTES,
  CLOUD_PROPERTY_VALUE_MAX_LENGTH,
  CLOUD_RELATIONSHIPS_MAX,
  CLOUD_RELATIONSHIP_LABELS,
  CLOUD_TAGS_MAX,
  CLOUD_TAG_KEY_MAX_LENGTH,
  CLOUD_TAG_VALUE_MAX_LENGTH,
  CloudRelationshipKind,
  CloudResourceRelationship,
  boundCloudRelationships,
  normalizeCloudEndpoints,
  normalizeCloudHost,
  normalizeCloudTags,
  pickCloudProperties,
  readCloudEndpoints,
  readCloudPath,
  readCloudRelationships,
  readCloudTags,
} from "../../../Types/Cloud/CloudInventory";
import { describe, expect, test } from "@jest/globals";

/*
 * What an inventory keeps of a resource is bounded and safe by
 * construction: tags in one shape whatever the cloud wrote, only the
 * properties a type names, relationships and endpoints without repeats -
 * and none of it ever larger than its limit, whatever a cloud returns.
 */

describe("tags", () => {
  test("AWS's list of Key and Value, and Azure's and Google Cloud's map, read the same", () => {
    expect(
      normalizeCloudTags([
        { Key: "team", Value: "payments" },
        { Key: "env", Value: "production" },
      ]),
    ).toEqual({ team: "payments", env: "production" });
    expect(normalizeCloudTags({ team: "payments", env: "production" })).toEqual(
      { team: "payments", env: "production" },
    );
    // Lower-case keys, as some SDKs write them.
    expect(normalizeCloudTags([{ key: "team", value: "search" }])).toEqual({
      team: "search",
    });
  });

  test("keeps the first spelling of a repeated key, and drops empty keys", () => {
    expect(
      normalizeCloudTags([
        { Key: "team", Value: "first" },
        { Key: "team", Value: "second" },
        { Key: "  ", Value: "nobody" },
        { Key: "", Value: "nobody" },
      ]),
    ).toEqual({ team: "first" });
  });

  test("reads numbers and booleans as text, and keeps an empty value", () => {
    expect(
      normalizeCloudTags({ replicas: 3, public: false, owner: "" }),
    ).toEqual({ replicas: "3", public: "false", owner: "" });
  });

  test("keeps at most CLOUD_TAGS_MAX, with keys and values clamped", () => {
    const many: Record<string, string> = {};

    for (let index: number = 0; index < CLOUD_TAGS_MAX + 25; index++) {
      many[`key-${index}`] = "value";
    }

    expect(Object.keys(normalizeCloudTags(many))).toHaveLength(CLOUD_TAGS_MAX);

    const long: Record<string, string> = normalizeCloudTags({
      ["k".repeat(CLOUD_TAG_KEY_MAX_LENGTH + 10)]: "v".repeat(
        CLOUD_TAG_VALUE_MAX_LENGTH + 10,
      ),
    });
    const [key, value] = Object.entries(long)[0] as [string, string];

    expect(key).toHaveLength(CLOUD_TAG_KEY_MAX_LENGTH);
    expect(value).toHaveLength(CLOUD_TAG_VALUE_MAX_LENGTH);
  });

  test("anything that is not tags reads as none", () => {
    for (const raw of [null, undefined, "team=payments", 42, [1, 2], [null]]) {
      expect(normalizeCloudTags(raw)).toEqual({});
    }
    expect(readCloudTags(["not", "a", "map"])).toEqual({});
    expect(readCloudTags({ team: "payments" })).toEqual({ team: "payments" });
  });
});

describe("properties", () => {
  const description: Record<string, unknown> = {
    InstanceType: "m5.large",
    State: { Name: "running", Code: 16 },
    Monitoring: true,
    SecurityGroupIds: ["sg-1", "sg-2"],
    UserData: "IyEvYmluL2Jhc2gKZXhwb3J0IFRPS0VOPXNlY3JldA==",
    Environment: { Variables: { DATABASE_PASSWORD: "hunter2" } },
    Tags: [{ Key: "Name", Value: "web-1" }],
  };

  test("keeps only the paths a type names, each under its own path", () => {
    expect(
      pickCloudProperties(description, [
        "InstanceType",
        "State.Name",
        "Monitoring",
        "SecurityGroupIds",
      ]),
    ).toEqual({
      InstanceType: "m5.large",
      "State.Name": "running",
      Monitoring: true,
      SecurityGroupIds: ["sg-1", "sg-2"],
    });
  });

  test("never keeps what a type does not name - user data, an environment - however it is nested", () => {
    const kept: Record<string, unknown> = pickCloudProperties(description, [
      "InstanceType",
    ]);

    expect(JSON.stringify(kept)).not.toContain("hunter2");
    expect(JSON.stringify(kept)).not.toContain("IyEvYmluL2Jhc2g");
  });

  test("leaves out objects and lists of objects, even at a named path", () => {
    expect(
      pickCloudProperties(
        { State: { Name: "running" }, Tags: [{ Key: "a", Value: "b" }] },
        ["State", "Tags"],
      ),
    ).toEqual({});
  });

  test("clamps long text and long lists", () => {
    const kept: Record<string, unknown> = pickCloudProperties(
      {
        Note: "x".repeat(CLOUD_PROPERTY_VALUE_MAX_LENGTH * 2),
        Ids: Array.from({ length: 50 }, (_: unknown, index: number) => {
          return `id-${index}`;
        }),
      },
      ["Note", "Ids"],
    );

    expect(kept["Note"]).toHaveLength(CLOUD_PROPERTY_VALUE_MAX_LENGTH);
    expect(kept["Ids"]).toHaveLength(20);
  });

  test("stays under CLOUD_PROPERTIES_MAX_BYTES whatever the cloud returns", () => {
    const huge: Record<string, string> = {};
    const paths: Array<string> = [];

    for (let index: number = 0; index < 200; index++) {
      huge[`Field${index}`] = "y".repeat(CLOUD_PROPERTY_VALUE_MAX_LENGTH);
      paths.push(`Field${index}`);
    }

    expect(
      JSON.stringify(pickCloudProperties(huge, paths)).length,
    ).toBeLessThanOrEqual(CLOUD_PROPERTIES_MAX_BYTES);
  });

  test("reads a dotted path, and nothing through a list or a missing step", () => {
    expect(readCloudPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    expect(readCloudPath({ a: [{ b: 1 }] }, "a.b")).toBeUndefined();
    expect(readCloudPath({ a: null }, "a.b")).toBeUndefined();
    expect(readCloudPath("text", "length")).toBeUndefined();
  });
});

describe("relationships", () => {
  test("keeps known kinds with a target, each pair once (any case)", () => {
    expect(
      boundCloudRelationships([
        { kind: CloudRelationshipKind.RunsIn, target: "subnet-1" },
        { kind: CloudRelationshipKind.RunsIn, target: "SUBNET-1" },
        { kind: CloudRelationshipKind.ProtectedBy, target: "subnet-1" },
        { kind: "talks-to" as CloudRelationshipKind, target: "db-1" },
        { kind: CloudRelationshipKind.PartOf, target: "  " },
      ]),
    ).toEqual([
      { kind: CloudRelationshipKind.RunsIn, target: "subnet-1" },
      { kind: CloudRelationshipKind.ProtectedBy, target: "subnet-1" },
    ]);
  });

  test("keeps the target's type when given", () => {
    expect(
      boundCloudRelationships([
        {
          kind: CloudRelationshipKind.RunsIn,
          target: "vpc-1",
          targetType: "AWS::EC2::VPC",
        },
      ]),
    ).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "vpc-1",
        targetType: "AWS::EC2::VPC",
      },
    ]);
  });

  test("keeps at most CLOUD_RELATIONSHIPS_MAX", () => {
    const many: Array<CloudResourceRelationship> = Array.from(
      { length: CLOUD_RELATIONSHIPS_MAX + 30 },
      (_: unknown, index: number): CloudResourceRelationship => {
        return { kind: CloudRelationshipKind.RoutesTo, target: `i-${index}` };
      },
    );

    expect(boundCloudRelationships(many)).toHaveLength(CLOUD_RELATIONSHIPS_MAX);
  });

  test("read back from a row, anything malformed is skipped", () => {
    expect(
      readCloudRelationships([
        { kind: "runs-in", target: "subnet-1" },
        { kind: "nonsense", target: "x" },
        { target: "no-kind" },
        "text",
        null,
      ]),
    ).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-1",
        targetType: undefined,
      },
    ]);
    expect(readCloudRelationships({ kind: "runs-in" })).toEqual([]);
  });

  test("every kind has words to show", () => {
    for (const kind of Object.values(CloudRelationshipKind)) {
      expect(CLOUD_RELATIONSHIP_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("endpoints", () => {
  test("a host is compared lower case, without scheme, credentials, path, port or trailing dot", () => {
    expect(
      normalizeCloudHost("https://Shop.Example.com:443/checkout?x=1"),
    ).toBe("shop.example.com");
    expect(normalizeCloudHost("user:pass@api.example.com")).toBe(
      "api.example.com",
    );
    expect(normalizeCloudHost("my-lb-123.us-east-1.elb.amazonaws.com.")).toBe(
      "my-lb-123.us-east-1.elb.amazonaws.com",
    );
    expect(normalizeCloudHost("10.0.0.5")).toBe("10.0.0.5");
  });

  test("an IPv6 address stays whole, bracketed or bare", () => {
    expect(normalizeCloudHost("[2001:db8::1]:8080")).toBe("2001:db8::1");
    expect(normalizeCloudHost("2001:db8::1")).toBe("2001:db8::1");
  });

  test("anything that is not a host is dropped", () => {
    for (const value of [
      "",
      "   ",
      null,
      undefined,
      { host: "a.example.com" },
      "has space.example.com",
      `${"a".repeat(260)}.com`,
    ]) {
      expect(normalizeCloudHost(value)).toBe("");
    }
  });

  test("kept without repeats, at most CLOUD_ENDPOINTS_MAX", () => {
    expect(
      normalizeCloudEndpoints([
        "https://a.example.com",
        "A.EXAMPLE.COM",
        "b.example.com",
        null,
      ]),
    ).toEqual(["a.example.com", "b.example.com"]);

    const many: Array<string> = Array.from(
      { length: CLOUD_ENDPOINTS_MAX + 10 },
      (_: unknown, index: number): string => {
        return `host-${index}.example.com`;
      },
    );

    expect(normalizeCloudEndpoints(many)).toHaveLength(CLOUD_ENDPOINTS_MAX);
    expect(readCloudEndpoints("a.example.com")).toEqual([]);
    expect(readCloudEndpoints(["A.example.com"])).toEqual(["a.example.com"]);
  });
});
