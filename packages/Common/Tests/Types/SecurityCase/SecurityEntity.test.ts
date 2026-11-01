import {
  SECURITY_ENTITY_LIMIT,
  SecurityEntity,
  SecurityEntityType,
  entitiesFromObservables,
  getDataStoreEntityValue,
  getDataStoreKeyOfEntityValue,
  getSecurityEntityIcon,
  inferSecurityEntityType,
  isDataStoreEntityValue,
  isIpAddress,
  mergeSecurityEntities,
  securityEntityTypeForField,
} from "../../../Types/SecurityCase/SecurityEntity";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, test } from "@jest/globals";

describe("inferSecurityEntityType", () => {
  test.each([
    ["203.0.113.7", SecurityEntityType.IpAddress],
    ["10.0.0.1", SecurityEntityType.IpAddress],
    ["2001:db8::7", SecurityEntityType.IpAddress],
    ["::1", SecurityEntityType.IpAddress],
    ["d41d8cd98f00b204e9800998ecf8427e", SecurityEntityType.FileHash],
    ["da39a3ee5e6b4b0d3255bfef95601890afd80709", SecurityEntityType.FileHash],
    [
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      SecurityEntityType.FileHash,
    ],
    ["https://evil.example/payload.sh", SecurityEntityType.Url],
    ["alice@acme.com", SecurityEntityType.User],
    ["evil.example", SecurityEntityType.Domain],
    ["c2.bad-actor.example.org", SecurityEntityType.Domain],
    ["web-01", SecurityEntityType.Other],
    ["", SecurityEntityType.Other],
  ])("%s is a %s", (value: string, expected: SecurityEntityType) => {
    expect(inferSecurityEntityType(value)).toBe(expected);
  });

  test("an address with an octet over 255 is not an IP address", () => {
    expect(isIpAddress("300.1.1.1")).toBe(false);
    expect(inferSecurityEntityType("300.1.1.1")).not.toBe(
      SecurityEntityType.IpAddress,
    );
  });

  test("a hex string of a length no digest has is not a hash", () => {
    expect(inferSecurityEntityType("abcdef0123")).toBe(
      SecurityEntityType.Other,
    );
  });

  /*
   * A store's key holds whatever its cloud names it by: read by its shape
   * alone, a Google Cloud resource name after the prefix is a URL, and a
   * traced database's user@host a sign-in name.
   */
  test.each([
    "data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders-exports",
    "data-store://storage.googleapis.com/projects/_/buckets/exports",
    "data-store:traced:mysql:admin@db.example.com",
    "  DATA-STORE:database:5f0c2a4e-0000-4000-8000-000000000001  ",
  ])("%s is a data store, whatever its key looks like", (value: string) => {
    expect(inferSecurityEntityType(value)).toBe(SecurityEntityType.DataStore);
  });

  test("the prefix alone, or a store's key without it, is no data store", () => {
    expect(inferSecurityEntityType("data-store:")).toBe(
      SecurityEntityType.Other,
    );
    expect(isDataStoreEntityValue("data-store:   ")).toBe(false);
    expect(isDataStoreEntityValue(null)).toBe(false);
    expect(
      inferSecurityEntityType("cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders"),
    ).not.toBe(SecurityEntityType.DataStore);
  });
});

describe("a data store's entity value", () => {
  test("is the prefix and the store's key, and gives the key back", () => {
    const value: string = getDataStoreEntityValue(
      " cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders ",
    );

    expect(value).toBe(
      "data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders",
    );
    expect(isDataStoreEntityValue(value)).toBe(true);
    expect(getDataStoreKeyOfEntityValue(value)).toBe(
      "cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders",
    );
    expect(getDataStoreKeyOfEntityValue("alice@acme.com")).toBe("");
  });

  test("is typed as a store when it arrives untyped, as an observable or a stored entry", () => {
    const value: string = getDataStoreEntityValue(
      "cloud:gcp:Google Cloud Storage Bucket://storage.googleapis.com/projects/_/buckets/exports",
    );

    expect(entitiesFromObservables([value])).toEqual([
      { type: SecurityEntityType.DataStore, value },
    ]);
    expect(
      mergeSecurityEntities([{ type: "Bucket" as SecurityEntityType, value }]),
    ).toEqual([{ type: SecurityEntityType.DataStore, value }]);
  });
});

describe("securityEntityTypeForField", () => {
  test("typed columns say what their values are", () => {
    expect(securityEntityTypeForField("principalUser")).toBe(
      SecurityEntityType.User,
    );
    expect(securityEntityTypeForField("targetHost")).toBe(
      SecurityEntityType.Host,
    );
    expect(securityEntityTypeForField("principalIp")).toBe(
      SecurityEntityType.IpAddress,
    );
    expect(securityEntityTypeForField("principalProcess")).toBe(
      SecurityEntityType.Process,
    );
  });

  test.each([
    "processName",
    "processPath",
    "processCommandLine",
    "parentProcessName",
    "parentProcessPath",
    "parentProcessCommandLine",
  ])(
    "%s, a column of the process an event is about, holds a process",
    (field: string) => {
      expect(securityEntityTypeForField(field)).toBe(
        SecurityEntityType.Process,
      );
    },
  );

  test("a column that holds anything, and an unknown field, leave it to the value", () => {
    expect(securityEntityTypeForField("targetResource")).toBeUndefined();
    expect(securityEntityTypeForField("eventName")).toBeUndefined();
    expect(securityEntityTypeForField("")).toBeUndefined();
    expect(securityEntityTypeForField(undefined)).toBeUndefined();
  });

  test("attribute keys whose last word names the thing are typed by it", () => {
    expect(securityEntityTypeForField("userIdentity.arn")).toBe(
      SecurityEntityType.User,
    );
    expect(securityEntityTypeForField("user.username")).toBe(
      SecurityEntityType.User,
    );
    expect(securityEntityTypeForField("device.hostname")).toBe(
      SecurityEntityType.Host,
    );
    expect(securityEntityTypeForField("client.src_ip")).toBe(
      SecurityEntityType.IpAddress,
    );
  });

  test("Object.prototype keys are attributes, never columns", () => {
    expect(securityEntityTypeForField("constructor")).toBeUndefined();
    expect(securityEntityTypeForField("toString")).toBeUndefined();
  });
});

describe("mergeSecurityEntities", () => {
  test("dedupes case-insensitively, keeping the first spelling", () => {
    const merged: Array<SecurityEntity> = mergeSecurityEntities(
      [{ type: SecurityEntityType.Host, value: "WEB-01" }],
      [{ type: SecurityEntityType.Host, value: "web-01" }],
    );

    expect(merged).toEqual([
      { type: SecurityEntityType.Host, value: "WEB-01" },
    ]);
  });

  test("a typed copy improves an earlier untyped one", () => {
    const merged: Array<SecurityEntity> = mergeSecurityEntities(
      entitiesFromObservables(["web-01"]),
      [{ type: SecurityEntityType.Host, value: "web-01" }],
    );

    expect(merged).toEqual([
      { type: SecurityEntityType.Host, value: "web-01" },
    ]);
  });

  test("a typed entity is never downgraded by a later guess", () => {
    const merged: Array<SecurityEntity> = mergeSecurityEntities(
      [{ type: SecurityEntityType.User, value: "alice@acme.com" }],
      [{ type: SecurityEntityType.Domain, value: "alice@acme.com" }],
    );

    expect(merged[0]?.type).toBe(SecurityEntityType.User);
  });

  test("drops empty values and caps the list", () => {
    const many: Array<SecurityEntity> = [];

    for (let index: number = 0; index < SECURITY_ENTITY_LIMIT + 10; index++) {
      many.push({ type: SecurityEntityType.Host, value: `host-${index}` });
    }

    const merged: Array<SecurityEntity> = mergeSecurityEntities(
      [{ type: SecurityEntityType.Host, value: "   " }],
      many,
    );

    expect(merged).toHaveLength(SECURITY_ENTITY_LIMIT);
    expect(merged[0]?.value).toBe("host-0");
  });

  test("an unknown type from stored JSON is re-inferred from the value", () => {
    const merged: Array<SecurityEntity> = mergeSecurityEntities([
      { type: "Planet" as SecurityEntityType, value: "203.0.113.9" },
    ]);

    expect(merged[0]?.type).toBe(SecurityEntityType.IpAddress);
  });

  test("tolerates null lists and malformed entries", () => {
    expect(
      mergeSecurityEntities(null, undefined, [
        null as unknown as SecurityEntity,
        { type: SecurityEntityType.User } as unknown as SecurityEntity,
      ]),
    ).toEqual([]);
  });
});

describe("getSecurityEntityIcon", () => {
  test("every type has an icon of its own", () => {
    const icons: Set<IconProp> = new Set(
      Object.values(SecurityEntityType).map((type: SecurityEntityType) => {
        return getSecurityEntityIcon(type);
      }),
    );

    expect(icons.size).toBe(Object.values(SecurityEntityType).length);
  });
});
