import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import {
  ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  fillSubscriberRestrictionMessage,
  formatAllowedEmailDomains,
  getAllowedEmailDomainEntries,
  getAllowedEmailDomains,
  getAllowedEmailDomainsIssue,
  getAllowedEmailDomainsProblem,
  getDomainNotAllowedMessage,
  getEmailAddressDomain,
  isEmailAtAllowedDomain,
  isSameEmailAddress,
  LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN,
  MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS,
  MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_TEXT_LENGTH,
  normalizeAllowedEmailDomains,
  SubscriberRestrictionMessages,
} from "../../../Types/StatusPage/SubscriberRestrictions";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * Who may be a status page's subscriber (Types/StatusPage/
 * SubscriberRestrictions): Only Private Users Can Subscribe and Allowed
 * Email Domains. The rules a sign-up and the team's additions are refused
 * by, and what they are refused with; the same rules in SQL decide whom a
 * send reaches (SubscriberRestrictionSql, pinned against Postgres in
 * StatusPageSubscriberRestrictionsPostgres.test.ts).
 */

describe("an allowed domains list, as written", () => {
  test("one domain a line, trimmed and lower-cased", () => {
    expect(getAllowedEmailDomainEntries("  Acme.com \nACME.de\n")).toEqual([
      "acme.com",
      "acme.de",
    ]);
  });

  test("commas, semicolons and spaces separate too, and Windows line breaks are fine", () => {
    expect(
      getAllowedEmailDomainEntries(
        "acme.com, acme.de;acme.fr acme.io\r\nx.org",
      ),
    ).toEqual(["acme.com", "acme.de", "acme.fr", "acme.io", "x.org"]);
  });

  test("a leading @ is taken off, as people paste them", () => {
    expect(getAllowedEmailDomainEntries("@acme.com\n@@acme.de")).toEqual([
      "acme.com",
      "acme.de",
    ]);
  });

  test("blank lines and repeats are left out, in the order written", () => {
    expect(
      getAllowedEmailDomainEntries("b.com\n\n\na.com\nB.COM\n@a.com"),
    ).toEqual(["b.com", "a.com"]);
  });

  test.each([null, undefined, "", "   ", "\n\n"])(
    "%p holds no domain",
    (value: string | null | undefined) => {
      expect(getAllowedEmailDomainEntries(value)).toEqual([]);
      expect(getAllowedEmailDomains(value)).toEqual([]);
      expect(normalizeAllowedEmailDomains(value)).toBeNull();
    },
  );

  test("a value that is not text holds no domain", () => {
    expect(getAllowedEmailDomainEntries(42 as unknown as string)).toEqual([]);
  });
});

describe("what keeps a list from being saved", () => {
  test.each([null, undefined, ""])(
    "%p is no list, and is fine",
    (value: unknown) => {
      expect(getAllowedEmailDomainsIssue(value)).toBeNull();
      expect(getAllowedEmailDomainsProblem(value)).toBeNull();
    },
  );

  test("valid domains, however separated, are fine", () => {
    expect(
      getAllowedEmailDomainsProblem("acme.com\neu.acme.com, acme.co.uk"),
    ).toBeNull();
  });

  test.each([
    ["not a domain", "not"],
    ["acme", "acme"],
    ["acme.com\nhttps://acme.com", "https://acme.com"],
    ["acme.com\nuser@acme.com", "user@acme.com"],
    ["*.acme.com", "*.acme.com"],
    ["acme..com", "acme..com"],
  ])("%j is refused, naming the entry %j", (value: string, entry: string) => {
    expect(getAllowedEmailDomainsIssue(value)).toEqual({
      kind: "invalidDomain",
      domain: entry,
    });
    expect(getAllowedEmailDomainsProblem(value)).toBe(
      fillSubscriberRestrictionMessage(
        SubscriberRestrictionMessages.invalidDomain,
        { domain: entry },
      ),
    );
  });

  test("the first entry that is no domain is the one named", () => {
    expect(getAllowedEmailDomainsIssue("acme.com\nfirst\nsecond")).toEqual({
      kind: "invalidDomain",
      domain: "first",
    });
  });

  test("a value that is not text is refused", () => {
    expect(getAllowedEmailDomainsIssue(12)).toEqual({
      kind: "invalidDomain",
      domain: "12",
    });
    expect(getAllowedEmailDomainsProblem(["acme.com"])).toContain("acme.com");
  });

  test(`at most ${MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS} domains`, () => {
    const domains: Array<string> = Array.from(
      { length: MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS },
      (_value: unknown, index: number): string => {
        return `d${index}.example.com`;
      },
    );

    expect(getAllowedEmailDomainsProblem(domains.join("\n"))).toBeNull();
    expect(
      getAllowedEmailDomainsIssue(
        [...domains, "one-more.example.com"].join("\n"),
      ),
    ).toEqual({ kind: "tooManyDomains" });
    expect(
      getAllowedEmailDomainsProblem(
        [...domains, "one-more.example.com"].join("\n"),
      ),
    ).toBe(SubscriberRestrictionMessages.tooManyDomains);
  });

  test("a list written longer than any list of the most domains is refused before it is read", () => {
    const long: string = `acme.com${" ".repeat(MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_TEXT_LENGTH)}`;

    expect(getAllowedEmailDomainsIssue(long)).toEqual({
      kind: "tooManyDomains",
    });
    expect(getAllowedEmailDomainsProblem(long)).toBe(
      SubscriberRestrictionMessages.tooManyDomains,
    );
  });

  test("the most domains at their longest still fit", () => {
    const longest: string = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    expect(longest.length).toBeLessThanOrEqual(253);

    const domains: Array<string> = Array.from(
      { length: MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS },
      (_value: unknown, index: number): string => {
        return `${index}${longest.slice(String(index).length)}`;
      },
    );

    expect(getAllowedEmailDomainsProblem(domains.join("\n"))).toBeNull();
  });

  test("a long list with every entry repeated is read in time that grows with its length", () => {
    // 40,000 entries: a list that compared each entry with every other took seconds.
    const repeated: string = Array.from(
      { length: 40000 },
      (_value: unknown, index: number): string => {
        return `d${index % 50}.example.com`;
      },
    ).join("\n");

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(getAllowedEmailDomainEntries(repeated)).toHaveLength(50);
      },
      limitInMs: 1000,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });

  test("repeats do not count towards the most", () => {
    const repeated: string = Array.from(
      { length: MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS + 50 },
      (): string => {
        return "acme.com";
      },
    ).join("\n");

    expect(getAllowedEmailDomainsProblem(repeated)).toBeNull();
  });
});

describe("the list as it is stored", () => {
  test("its valid domains, one a line", () => {
    expect(
      normalizeAllowedEmailDomains(" @Acme.com, acme.de\n\nacme.com"),
    ).toBe("acme.com\nacme.de");
  });

  test("an entry that is no domain is never matched", () => {
    expect(getAllowedEmailDomains("acme.com\nnot a domain")).toEqual([
      "acme.com",
    ]);
  });
});

describe("the domain an address is at", () => {
  test.each([
    ["user@acme.com", "acme.com"],
    ["  User@EU.Acme.COM ", "eu.acme.com"],
    ["first.last+tag@acme.co.uk", "acme.co.uk"],
  ])("%j is at %j", (email: string, domain: string) => {
    expect(getEmailAddressDomain(email)).toBe(domain);
  });

  test.each([
    "x@acme.com@evil.com",
    "acme.com",
    "@acme.com",
    "user@",
    "user name@acme.com",
    "a@acme.com,b@evil.com",
    "a@acme.com;b@evil.com",
    "user@not a domain",
    "",
  ])("%j is at no domain", (email: string) => {
    expect(getEmailAddressDomain(email)).toBeNull();
  });

  test("nothing is at no domain", () => {
    expect(getEmailAddressDomain(null)).toBeNull();
    expect(getEmailAddressDomain(undefined)).toBeNull();
  });
});

describe("whether an address is at an allowed domain", () => {
  const domains: Array<string> = ["acme.com", "acme.de"];

  test("no domains allows any address", () => {
    expect(isEmailAtAllowedDomain({ email: "a@x.org", domains: [] })).toBe(
      true,
    );
  });

  test.each(["a@acme.com", "A@ACME.DE", "a@eu.acme.com", "a@x.y.acme.com"])(
    "%j is at one, exactly or at a subdomain",
    (email: string) => {
      expect(isEmailAtAllowedDomain({ email, domains })).toBe(true);
    },
  );

  test.each([
    "a@evilacme.com",
    "a@acme.com.evil.com",
    "a@acme.co",
    "x@acme.com@evil.com",
    "a@acme.com,b@evil.com",
    "not an address",
  ])("%j is not", (email: string) => {
    expect(isEmailAtAllowedDomain({ email, domains })).toBe(false);
  });

  test("no address is at none of them", () => {
    expect(isEmailAtAllowedDomain({ email: null, domains })).toBe(false);
  });
});

describe("what a sign-up at another domain is told", () => {
  test.each([
    [["acme.com"], "acme.com"],
    [["acme.com", "acme.de"], "acme.com or acme.de"],
    [["acme.com", "acme.de", "acme.fr"], "acme.com, acme.de or acme.fr"],
  ])("%j reads %j", (domains: Array<string>, text: string) => {
    expect(formatAllowedEmailDomains(domains)).toBe(text);
    expect(getDomainNotAllowedMessage(domains)).toBe(
      `Only email addresses at ${text} can subscribe to this status page.`,
    );
  });

  test("no domains reads as nothing", () => {
    expect(formatAllowedEmailDomains([])).toBe("");
  });
});

describe("the messages", () => {
  test("every placeholder is filled, every time it appears", () => {
    expect(
      fillSubscriberRestrictionMessage("{{a}} and {{a}}, {{b}}", {
        a: "x",
        b: "y",
      }),
    ).toBe("x and x, y");
  });

  test("the team is told which address is not a private user, and what to do", () => {
    const message: string = fillSubscriberRestrictionMessage(
      SubscriberRestrictionMessages.teamAddedNotPrivateUser,
      { email: "someone@acme.com" },
    );

    expect(message).toContain("someone@acme.com");
    expect(message).toContain("private user");
    expect(message).toContain("Only Private Users Can Subscribe");
    expect(message).not.toContain("{{");
  });

  test("a visitor is told only what they can do", () => {
    for (const message of [
      SubscriberRestrictionMessages.notPrivateUser,
      SubscriberRestrictionMessages.notOwnEmail,
      SubscriberRestrictionMessages.notSignedIn,
      SubscriberRestrictionMessages.emailOnly,
    ]) {
      expect(message).not.toContain("{{");
      expect(message).not.toContain("Only Private Users Can Subscribe");
      expect(message.endsWith(".")).toBe(true);
    }
  });
});

describe("whether two addresses are the same", () => {
  test("compared trimmed and lower-cased", () => {
    expect(isSameEmailAddress(" A@Acme.com", "a@acme.com ")).toBe(true);
    expect(isSameEmailAddress("a@acme.com", "b@acme.com")).toBe(false);
  });

  test("a missing address is no one's", () => {
    expect(isSameEmailAddress(null, "a@acme.com")).toBe(false);
    expect(isSameEmailAddress("a@acme.com", undefined)).toBe(false);
    expect(isSameEmailAddress("", "")).toBe(false);
  });
});

describe("the columns", () => {
  const page: StatusPage = new StatusPage();

  test("Only Private Users Can Subscribe is a switch, off by default", () => {
    const metadata: { type: TableColumnType; defaultValue?: unknown } =
      page.getTableColumnMetadata(LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN);

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(false);
  });

  test("Allowed Email Domains is long text, with nothing by default", () => {
    const metadata: { type: TableColumnType; defaultValue?: unknown } =
      page.getTableColumnMetadata(ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN);

    expect(metadata.type).toBe(TableColumnType.VeryLongText);
    expect(metadata.defaultValue).toBeUndefined();
  });

  test.each([
    LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN,
    ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  ])("%s is set on the Scale plan, read on every plan", (column: string) => {
    expect(page.getColumnBillingAccessControl(column)).toEqual({
      read: PlanType.Free,
      update: PlanType.Scale,
      create: PlanType.Scale,
    });
  });

  test.each([
    LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN,
    ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  ])("%s is the team's to change, never the public's", (column: string) => {
    const access: {
      read: Array<Permission>;
      update: Array<Permission>;
      create: Array<Permission>;
    } = page.getColumnAccessControlFor(column)!;

    expect(access.update).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.StatusPageAdmin,
        Permission.EditProjectStatusPage,
      ]),
    );
    expect(access.update).not.toContain(Permission.Public);
    expect(access.create).not.toContain(Permission.Public);
  });

  test("the status page itself reads whether only private users subscribe - its Subscribe page needs it - but never the domains", () => {
    expect(
      page.getColumnAccessControlFor(LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN)!
        .read,
    ).toContain(Permission.Public);
    expect(
      page.getColumnAccessControlFor(ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN)!
        .read,
    ).not.toContain(Permission.Public);
  });
});
