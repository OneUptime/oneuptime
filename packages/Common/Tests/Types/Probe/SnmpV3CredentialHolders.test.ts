import SnmpV3CredentialHolderUtil, {
  MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES,
  MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS,
  MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES,
  SnmpV3CredentialHolders,
} from "../../../Types/Probe/SnmpV3CredentialHolders";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO HOLDS AN SNMPv3 CREDENTIAL (#11172, #11174): what OneUptime hands a
 * probe beside each user and what the probe sends back with every trap that
 * user authenticates. It decides which project may keep a trap, so it is
 * read only as what it can be, and a list that cannot be read whole is not
 * known - never a shorter list, which would tell a device that carries the
 * credential from one that does not wrongly.
 */

const PROJECT_A: string = "11720000-0000-4000-8000-0000000000a1";
const PROJECT_B: string = "11720000-0000-4000-8000-0000000000b2";
const DEVICE_1: string = "11720000-0000-4000-8000-000000000d01";
const DEVICE_2: string = "11720000-0000-4000-8000-000000000d02";
const SITE_1: string = "11720000-0000-4000-8000-000000000501";

function ids(count: number, prefix: string): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
  });
}

describe("sanitize", () => {
  test("holders are taken as they were handed over", () => {
    const holders: SnmpV3CredentialHolders = {
      projectIds: [PROJECT_A],
      deviceIds: [DEVICE_1, DEVICE_2],
      siteIds: [SITE_1],
    };

    expect(SnmpV3CredentialHolderUtil.sanitize(holders)).toEqual(holders);
  });

  test("IDs in lower case, each once, as typed with spaces around", () => {
    expect(
      SnmpV3CredentialHolderUtil.sanitize({
        projectIds: [` ${PROJECT_A.toUpperCase()} `, PROJECT_A],
        deviceIds: [DEVICE_1.toUpperCase(), DEVICE_1],
        siteIds: [],
      }),
    ).toEqual({
      projectIds: [PROJECT_A],
      deviceIds: [DEVICE_1],
      siteIds: [],
    });
  });

  test("no project, or none that reads, is no holders at all", () => {
    for (const value of [
      undefined,
      null,
      "holders",
      42,
      [],
      {},
      { projectIds: [] },
      { projectIds: "not-a-list" },
      { projectIds: ["not-an-id"] },
      { projectIds: [PROJECT_A, 7] },
      { deviceIds: [DEVICE_1] },
    ]) {
      expect(SnmpV3CredentialHolderUtil.sanitize(value)).toBeNull();
    }
  });

  test("a device or site list that cannot be read whole is left out, never cut short", () => {
    expect(
      SnmpV3CredentialHolderUtil.sanitize({
        projectIds: [PROJECT_A],
        deviceIds: [DEVICE_1, "not-an-id"],
        siteIds: "not-a-list",
      }),
    ).toEqual({ projectIds: [PROJECT_A] });
  });

  test("lists longer than their limits are not known", () => {
    expect(
      SnmpV3CredentialHolderUtil.sanitize({
        projectIds: [PROJECT_A],
        deviceIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES + 1, "1172dddd"),
        siteIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES + 1, "11725555"),
      }),
    ).toEqual({ projectIds: [PROJECT_A] });

    expect(
      SnmpV3CredentialHolderUtil.sanitize({
        projectIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS + 1, "1172aaaa"),
      }),
    ).toBeNull();
  });

  test("at their limits, every ID is kept", () => {
    const holders: SnmpV3CredentialHolders | null =
      SnmpV3CredentialHolderUtil.sanitize({
        projectIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS, "1172aaaa"),
        deviceIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES, "1172dddd"),
        siteIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES, "11725555"),
      });

    expect(holders?.projectIds).toHaveLength(
      MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS,
    );
    expect(holders?.deviceIds).toHaveLength(
      MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES,
    );
    expect(holders?.siteIds).toHaveLength(MAX_SNMP_V3_CREDENTIAL_HOLDER_SITES);
  });

  test("nothing else the wire carries is kept", () => {
    expect(
      SnmpV3CredentialHolderUtil.sanitize({
        projectIds: [PROJECT_A],
        authKey: "a passphrase someone slipped in",
      }),
    ).toEqual({ projectIds: [PROJECT_A] });
  });
});

describe("merge", () => {
  test("one credential held by two devices and a site is held by all three", () => {
    expect(
      SnmpV3CredentialHolderUtil.merge(
        { projectIds: [PROJECT_A], deviceIds: [DEVICE_1], siteIds: [] },
        {
          projectIds: [PROJECT_A],
          deviceIds: [DEVICE_2],
          siteIds: [SITE_1],
        },
      ),
    ).toEqual({
      projectIds: [PROJECT_A],
      deviceIds: [DEVICE_1, DEVICE_2],
      siteIds: [SITE_1],
    });
  });

  test("the same credential in two projects is held by both", () => {
    expect(
      SnmpV3CredentialHolderUtil.merge(
        { projectIds: [PROJECT_A], deviceIds: [DEVICE_1], siteIds: [] },
        { projectIds: [PROJECT_B], deviceIds: [DEVICE_2], siteIds: [] },
      )?.projectIds,
    ).toEqual([PROJECT_A, PROJECT_B]);
  });

  test("a list either side does not know is not known", () => {
    expect(
      SnmpV3CredentialHolderUtil.merge(
        { projectIds: [PROJECT_A], deviceIds: [DEVICE_1], siteIds: [] },
        { projectIds: [PROJECT_A] },
      ),
    ).toStrictEqual({ projectIds: [PROJECT_A] });
  });

  test("a device list that grows past its limit is left out; projects past theirs leave nothing", () => {
    const many: Array<string> = ids(
      MAX_SNMP_V3_CREDENTIAL_HOLDER_DEVICES,
      "1172dddd",
    );

    expect(
      SnmpV3CredentialHolderUtil.merge(
        { projectIds: [PROJECT_A], deviceIds: many, siteIds: [] },
        { projectIds: [PROJECT_A], deviceIds: [DEVICE_1], siteIds: [] },
      ),
    ).toEqual({ projectIds: [PROJECT_A], siteIds: [] });

    expect(
      SnmpV3CredentialHolderUtil.merge(
        {
          projectIds: ids(MAX_SNMP_V3_CREDENTIAL_HOLDER_PROJECTS, "1172aaaa"),
        },
        { projectIds: [PROJECT_B] },
      ),
    ).toBeNull();
  });
});

test("isHeldByProject compares IDs however they are cased", () => {
  const holders: SnmpV3CredentialHolders = { projectIds: [PROJECT_A] };

  expect(SnmpV3CredentialHolderUtil.isHeldByProject(holders, PROJECT_A)).toBe(
    true,
  );
  expect(
    SnmpV3CredentialHolderUtil.isHeldByProject(
      holders,
      PROJECT_A.toUpperCase(),
    ),
  ).toBe(true);
  expect(SnmpV3CredentialHolderUtil.isHeldByProject(holders, PROJECT_B)).toBe(
    false,
  );
});
