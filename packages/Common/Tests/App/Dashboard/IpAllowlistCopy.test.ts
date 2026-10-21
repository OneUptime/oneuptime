import { describe, expect, test } from "@jest/globals";
import IpAllowlistCopy, {
  getIpAllowlistEntries,
  getIpAllowlistProblem,
  IP_ALLOWLIST_COLUMN,
  isIpAllowlistEntryValid,
  isIpAllowlistInForce,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistCopy";
import * as StatusPageAccessCopyModule from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import IP from "../../../Types/IP/IP";

/*
 * An IP allowlist - one entry a line - is edited under Advanced on two
 * pages: a status page's Access and a dashboard's Sharing. Both columns are
 * matched on the server by the same IP.isInWhitelist, so both pages read and
 * refuse a list by the same rules, kept once in Components/IpAllowlist. The
 * status page's copy module still exports them, as it did before they were
 * shared.
 */

describe("one set of rules for both pages", () => {
  test("the status page's copy exports the shared rules themselves", () => {
    expect(StatusPageAccessCopyModule.getIpAllowlistEntries).toBe(
      getIpAllowlistEntries,
    );
    expect(StatusPageAccessCopyModule.getIpAllowlistProblem).toBe(
      getIpAllowlistProblem,
    );
    expect(StatusPageAccessCopyModule.isIpAllowlistEntryValid).toBe(
      isIpAllowlistEntryValid,
    );
    expect(StatusPageAccessCopyModule.isIpAllowlistInForce).toBe(
      isIpAllowlistInForce,
    );
  });

  test("and the shared sentences, word for word", () => {
    const StatusPageAccessCopy: typeof StatusPageAccessCopyModule.default =
      StatusPageAccessCopyModule.default;

    expect(StatusPageAccessCopy.ipAllowlistTitle).toBe(IpAllowlistCopy.title);
    expect(StatusPageAccessCopy.ipAllowlistEditButton).toBe(
      IpAllowlistCopy.editButton,
    );
    expect(StatusPageAccessCopy.ipAllowlistFieldDescription).toBe(
      IpAllowlistCopy.fieldDescription,
    );
    expect(StatusPageAccessCopy.ipAllowlistBlank).toBe(IpAllowlistCopy.blank);
    expect(StatusPageAccessCopy.ipAllowlistInvalidEntry).toBe(
      IpAllowlistCopy.invalidEntry,
    );
  });

  test("both models keep the list in the column the rules name, gated on the same plan", () => {
    expect(IP_ALLOWLIST_COLUMN).toBe("ipWhitelist");

    for (const model of [new StatusPage(), new Dashboard()]) {
      expect(model.getTableColumnMetadata(IP_ALLOWLIST_COLUMN)).toBeDefined();
      expect(
        model.getColumnBillingAccessControl(IP_ALLOWLIST_COLUMN)?.update,
      ).toBe(
        new StatusPage().getColumnBillingAccessControl(IP_ALLOWLIST_COLUMN)
          ?.update,
      );
    }
  });
});

describe("the rules read a list as the server does", () => {
  test("in force whenever the column holds anything at all", () => {
    expect(isIpAllowlistInForce(undefined)).toBe(false);
    expect(isIpAllowlistInForce(null)).toBe(false);
    expect(isIpAllowlistInForce("")).toBe(false);
    expect(isIpAllowlistInForce("\n")).toBe(true);
    expect(isIpAllowlistInForce("203.0.113.7")).toBe(true);
  });

  test("entries are the trimmed, non-blank lines", () => {
    expect(
      getIpAllowlistEntries(" 203.0.113.7 \r\n\n10.0.0.0/8\n  \n"),
    ).toEqual(["203.0.113.7", "10.0.0.0/8"]);
  });

  test.each([
    ["203.0.113.7", true],
    ["2001:db8::1", true],
    ["10.0.0.0/8", true],
    ["10.0.0.0/0", true],
    ["10.0.0.0/32", true],
    ["10.0.0.0/33", false],
    ["10.0.0.0/8/8", false],
    ["2001:db8::/32", false],
    ["office.example.com", false],
    ["10.0.0", false],
    ["10.0.0.0/", false],
    ["10.0.0.0/x", false],
  ])("%s is valid: %s", (entry: string, isValid: boolean) => {
    expect(isIpAllowlistEntryValid(entry)).toBe(isValid);
  });

  test("an entry the rules accept is one the server matches", () => {
    // An address matches itself; a range matches an address inside it.
    expect(
      IP.isInWhitelist({ ip: "203.0.113.7", whitelist: ["203.0.113.7"] }),
    ).toBe(true);
    expect(
      IP.isInWhitelist({ ip: "10.9.9.9", whitelist: ["10.0.0.0/8"] }),
    ).toBe(true);
  });

  test("the problem with a list, or none", () => {
    expect(getIpAllowlistProblem(undefined)).toBeNull();
    expect(getIpAllowlistProblem("")).toBeNull();
    expect(getIpAllowlistProblem("203.0.113.7\n10.0.0.0/8\n")).toBeNull();
    expect(getIpAllowlistProblem(" \n \n")).toBe(IpAllowlistCopy.blank);
    expect(getIpAllowlistProblem("203.0.113.7\nexample.com\n10.0.0.0/33")).toBe(
      "example.com is not an IP address or an IPv4 range such as 10.0.0.0/8.",
    );
  });
});
