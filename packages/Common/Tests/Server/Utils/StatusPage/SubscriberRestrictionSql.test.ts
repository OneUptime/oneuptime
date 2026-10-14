import {
  getEmailConditionSql,
  getEmailDomainSql,
  getHasAllowedDomainsSql,
  getIsAtAllowedDomainSql,
  getIsBlankSql,
  getIsPrivateUserEmailSql,
  getIsTakenByItsStatusPageSql,
  getOtherContactConditionSql,
  SubscriberContactColumnsSql,
  SubscriberRestrictionSettingsSql,
} from "../../../../Server/Utils/StatusPage/SubscriberRestrictionSql";
import { describe, expect, test } from "@jest/globals";

/*
 * The SQL that decides whom a status page's notifications reach
 * (Utils/StatusPage/SubscriberRestrictionSql), as text: built only from the
 * expressions it is handed, the same building blocks for the loader and the
 * counts, and the row condition the AND of the per-column ones. Whether it
 * picks the right rows is asked of Postgres itself, in
 * StatusPageSubscriberRestrictionsPostgres.test.ts.
 */

const SUBSCRIBER: SubscriberContactColumnsSql = {
  email: "E",
  phone: "P",
  slack: "S",
  microsoftTeams: "T",
  webhook: "W",
};

const SETTINGS: SubscriberRestrictionSettingsSql = {
  limitSubscribersToPrivateUsers: "LIMIT",
  allowedSubscriberEmailDomains: "LIST",
};

describe("the building blocks", () => {
  test("a blank value is NULL, empty or spaces", () => {
    expect(getIsBlankSql("X")).toBe("(NULLIF(TRIM(X), '') IS NULL)");
  });

  test("an address's domain: one @, no space, comma or semicolon, lower-cased", () => {
    expect(getEmailDomainSql("E")).toBe(
      "SUBSTRING(LOWER(TRIM(E)) FROM '^[^@[:space:],;]+@([^@[:space:],;]+)$')",
    );
  });

  test("a list is split as the server splits it, and its blank entries skipped", () => {
    const sql: string = getHasAllowedDomainsSql("LIST");

    expect(sql).toContain(
      "regexp_split_to_array(LOWER(COALESCE(LIST, '')), '[[:space:],;]+')",
    );
    expect(sql).toContain(`LTRIM("listedDomain"."entry", '@') <> ''`);
  });

  test("an address matches a domain exactly or as a subdomain, and nothing else", () => {
    const sql: string = getIsAtAllowedDomainSql({ email: "E", list: "LIST" });

    expect(sql).toContain(
      `${getEmailDomainSql("E")} = LTRIM("allowedDomain"."entry", '@')`,
    );
    expect(sql).toContain(
      `RIGHT(${getEmailDomainSql("E")}, LENGTH(LTRIM("allowedDomain"."entry", '@')) + 1) = '.' || LTRIM("allowedDomain"."entry", '@')`,
    );
    expect(sql).not.toContain("LIKE");
  });

  test("a private user's address: not deleted, of the pages asked about, matched trimmed and lower-cased", () => {
    const sql: string = getIsPrivateUserEmailSql({
      email: "E",
      statusPageId: "PAGE",
      privateUsersOf: "PRIVATE_USERS_OF",
    });

    expect(sql).toContain(
      `(PAGE, LOWER(TRIM(E))) IN (SELECT "privateUser"."statusPageId", LOWER(TRIM("privateUser"."email"))`,
    );
    expect(sql).toContain("WHERE PRIVATE_USERS_OF");
    expect(sql).toContain(`"privateUser"."deletedAt" IS NULL`);
    expect(sql).toContain(`"privateUser"."email" IS NOT NULL`);
    // A blank address is no one's.
    expect(sql.startsWith(`(NOT ${getIsBlankSql("E")} AND`)).toBe(true);
  });
});

describe("the conditions", () => {
  test("the email: a private user's when the page takes only those, at an allowed domain when it has any", () => {
    const sql: string = getEmailConditionSql({
      email: "E",
      statusPageId: "PAGE",
      privateUsersOf: "PRIVATE_USERS_OF",
      settings: SETTINGS,
    });

    expect(sql).toBe(
      `((NOT (LIMIT) IS TRUE OR ${getIsPrivateUserEmailSql({ email: "E", statusPageId: "PAGE", privateUsersOf: "PRIVATE_USERS_OF" })}) AND (${getIsBlankSql("E")} OR NOT ${getHasAllowedDomainsSql("LIST")} OR ${getIsAtAllowedDomainSql({ email: "E", list: "LIST" })}))`,
    );
  });

  test("every other contact: none, when the page takes only its private users", () => {
    expect(
      getOtherContactConditionSql({ column: "P", settings: SETTINGS }),
    ).toBe(`(NOT (LIMIT) IS TRUE OR ${getIsBlankSql("P")})`);
  });

  test("a whole row: every column's condition, together", () => {
    const sql: string = getIsTakenByItsStatusPageSql({
      subscriber: SUBSCRIBER,
      statusPageId: "PAGE",
      privateUsersOf: "PRIVATE_USERS_OF",
      settings: SETTINGS,
    });

    expect(sql).toBe(
      [
        getEmailConditionSql({
          email: "E",
          statusPageId: "PAGE",
          privateUsersOf: "PRIVATE_USERS_OF",
          settings: SETTINGS,
        }),
        ...["P", "S", "T", "W"].map((column: string): string => {
          return getOtherContactConditionSql({
            column: column,
            settings: SETTINGS,
          });
        }),
      ].join(" AND "),
    );
  });

  test("nothing but the expressions handed in: no value, no parameter of its own", () => {
    const sql: string = getIsTakenByItsStatusPageSql({
      subscriber: SUBSCRIBER,
      statusPageId: "PAGE",
      privateUsersOf: "PRIVATE_USERS_OF",
      settings: SETTINGS,
    });

    expect(sql).not.toMatch(/\$\d/);
    /*
     * The one ":name" in it is the regular expressions' [:space:] class,
     * which TypeORM leaves alone: it binds only the names it is given.
     */
    expect(sql.split("[:space:]").join("")).not.toMatch(/:[a-zA-Z]/);
    expect(sql).not.toContain("acme");
  });
});
