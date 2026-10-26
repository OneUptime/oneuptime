import { describe, expect, test } from "@jest/globals";
import {
  getAwsOrganizationsRegion,
  isAwsOrganizationAccountActive,
  listAwsOrganizationAccounts,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsOrganizations";
import {
  CLOUD_MAX_ORGANIZATION_ACCOUNTS,
  getOrganizationLimitWarning,
  orderLeastRecentlyRead,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { createFakeAws, FakeAws } from "./FakeAwsApi";

/*
 * An organization's accounts, as a read takes them: only the ones in use
 * (AWS's State - Status retired on 9 September 2026), the first fifty with
 * a warning that says how many there are, and the one read least recently
 * first - so a read that stops at its limit reaches the rest next time,
 * rather than reading the same first accounts every time.
 */

describe("which of an organization's AWS accounts are read", () => {
  test("an ACTIVE State is read; every other State is not", () => {
    expect(isAwsOrganizationAccountActive({ State: "ACTIVE" })).toBe(true);
    expect(isAwsOrganizationAccountActive({ State: "active" })).toBe(true);

    for (const state of [
      "SUSPENDED",
      "PENDING_CLOSURE",
      "CLOSED",
      "PENDING_ACTIVATION",
    ]) {
      expect(isAwsOrganizationAccountActive({ State: state })).toBe(false);
    }
  });

  test("State wins over the retired Status; Status speaks only when State is absent", () => {
    expect(
      isAwsOrganizationAccountActive({ State: "SUSPENDED", Status: "ACTIVE" }),
    ).toBe(false);
    expect(
      isAwsOrganizationAccountActive({ State: "ACTIVE", Status: "SUSPENDED" }),
    ).toBe(true);
    expect(isAwsOrganizationAccountActive({ Status: "SUSPENDED" })).toBe(false);
    expect(isAwsOrganizationAccountActive({ Status: "ACTIVE" })).toBe(true);
  });

  test("an account that says neither is read: AWS lists every account it can", () => {
    expect(isAwsOrganizationAccountActive({})).toBe(true);
  });

  test("the listing keeps the accounts in use, in the order AWS lists them", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      organizationAccounts: [
        { Id: "111111111111", Name: "One", State: "ACTIVE" },
        { Id: "222222222222", Name: "Two", State: "SUSPENDED" },
        {
          Id: "333333333333",
          Name: "Three",
          State: "ACTIVE",
          Status: "ACTIVE",
        },
      ],
    });

    expect(
      await listAwsOrganizationAccounts({
        transport: fake.transport,
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "s",
        },
        region: "us-east-1",
      }),
    ).toEqual([
      { id: "111111111111", name: "One" },
      { id: "333333333333", name: "Three" },
    ]);
  });

  test("Organizations is asked in its partition's own Region", () => {
    expect(getAwsOrganizationsRegion("eu-west-1")).toBe("us-east-1");
    expect(getAwsOrganizationsRegion("us-gov-east-1")).toBe("us-gov-west-1");
    expect(getAwsOrganizationsRegion("cn-north-1")).toBe("cn-northwest-1");
  });
});

describe("an organization of more accounts than one connection reads", () => {
  test("is said, with how many it has and what to do", () => {
    expect(CLOUD_MAX_ORGANIZATION_ACCOUNTS).toBe(50);
    expect(getOrganizationLimitWarning({ total: 61, noun: "projects" })).toBe(
      "The organization has 61 projects: this connection reads the first 50. Connect the others with a connection of their own.",
    );
  });

  test("fifty or fewer say nothing", () => {
    expect(getOrganizationLimitWarning({ total: 50, noun: "accounts" })).toBe(
      null,
    );
    expect(getOrganizationLimitWarning({ total: 0, noun: "accounts" })).toBe(
      null,
    );
  });
});

describe("the order an organization's accounts are read in", () => {
  const at: (minutesAgo: number) => string = (minutesAgo: number): string => {
    return new Date(
      Date.UTC(2026, 9, 21, 12) - minutesAgo * 60000,
    ).toISOString();
  };

  test("the one read least recently first, and one never read before any other", () => {
    const readAt: Record<string, string | undefined> = {
      a: at(1),
      b: at(30),
      c: undefined,
      d: at(5),
    };

    expect(
      orderLeastRecentlyRead({
        accounts: ["a", "b", "c", "d"],
        readAt: (account: string): string | undefined => {
          return readAt[account];
        },
      }),
    ).toEqual(["c", "b", "d", "a"]);
  });

  test("accounts read at the same time - or never - keep the order they were listed in", () => {
    expect(
      orderLeastRecentlyRead({
        accounts: ["a", "b", "c", "d"],
        readAt: (account: string): string | undefined => {
          return account === "c" ? at(10) : undefined;
        },
      }),
    ).toEqual(["a", "b", "d", "c"]);
    expect(
      orderLeastRecentlyRead({
        accounts: ["x", "y"],
        readAt: (): string => {
          return at(3);
        },
      }),
    ).toEqual(["x", "y"]);
  });

  test("a time that is not a time is never read", () => {
    expect(
      orderLeastRecentlyRead({
        accounts: ["a", "b"],
        readAt: (account: string): string => {
          return account === "a" ? at(1) : "yesterday";
        },
      }),
    ).toEqual(["b", "a"]);
  });

  test("however the reads are cut short, every account is reached within as many reads as fit", () => {
    // Fifty accounts, three a read: every one is read within seventeen reads.
    const accounts: Array<string> = [];
    const readAt: Record<string, string> = {};

    for (let index: number = 0; index < 50; index++) {
      accounts.push(`account-${index}`);
    }

    for (let read: number = 0; read < 17; read++) {
      const ordered: Array<string> = orderLeastRecentlyRead({
        accounts,
        readAt: (account: string): string | undefined => {
          return readAt[account];
        },
      });

      for (const account of ordered.slice(0, 3)) {
        readAt[account] = new Date(
          Date.UTC(2026, 9, 21, 12, read),
        ).toISOString();
      }
    }

    expect(Object.keys(readAt)).toHaveLength(50);
  });
});
