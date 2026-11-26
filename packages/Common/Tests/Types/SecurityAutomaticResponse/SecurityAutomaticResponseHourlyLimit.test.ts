import Project from "../../../Models/DatabaseModels/Project";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../Types/HeldPermissions";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN,
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
  getSecurityAutomaticResponseHourlyLimitError,
  readSecurityAutomaticResponseHourlyLimit,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { describe, expect, test } from "@jest/globals";

/*
 * A PROJECT'S OWN HOURLY LIMIT OF AUTOMATIC BLOCKS (#10746).
 *
 * The automatic response policies stop after so many automatic blocks an
 * hour and page the security owners. 50 suits most projects; a large one
 * under a steady stream of scanners may want more, and a cautious one
 * fewer. So a project sets its own: a whole number from 1 to 500, stored
 * on the project, 50 until someone changes it.
 *
 * Pinned here: the default and the range, what is refused and in which
 * words, how a stored value is read (never none, never one a project could
 * not set), and the column - who may change it, and that a Security Admin
 * may change nothing else of the project but the Trusted Proxies switches.
 */

describe("the hourly limit's numbers", () => {
  test("50 unless a project sets its own, from 1 to 500", () => {
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR).toBe(50);
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN).toBe(1);
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX).toBe(500);
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR).toBeGreaterThan(
      SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN,
    );
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR).toBeLessThan(
      SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX,
    );
  });

  test("the words that refuse one name the range as the numbers hold it", () => {
    expect(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.hourlyLimitOutOfRange).toBe(
      `Set the hourly limit to a whole number of blocks from ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN} to ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX}.`,
    );
  });
});

describe("what a project may set", () => {
  test.each([1, 2, 49, 50, 51, 120, 499, 500, "1", "500", " 120 "])(
    "%p is kept",
    (value: unknown) => {
      expect(getSecurityAutomaticResponseHourlyLimitError(value)).toBeNull();
    },
  );

  test.each([
    0,
    -1,
    501,
    1000,
    2.5,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    "  ",
    "fifty",
    "50 blocks",
    "0x10",
    "1e2",
    null,
    undefined,
    true,
    {},
    [],
    [50],
  ])("%p is refused, saying the range", (value: unknown) => {
    expect(getSecurityAutomaticResponseHourlyLimitError(value)).toBe(
      SECURITY_AUTOMATIC_RESPONSE_MESSAGES.hourlyLimitOutOfRange,
    );
  });
});

describe("a limit as it is stored, read", () => {
  test.each([
    [1, 1],
    [50, 50],
    [120, 120],
    [500, 500],
    ["120", 120],
  ])("%p reads as %p", (value: unknown, limit: number) => {
    expect(readSecurityAutomaticResponseHourlyLimit(value)).toBe(limit);
  });

  test.each([0, -5, 501, 2.5, null, undefined, "", "many", Number.NaN])(
    "%p reads as the default: never no limit, never stopped for good",
    (value: unknown) => {
      expect(readSecurityAutomaticResponseHourlyLimit(value)).toBe(
        SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
      );
    },
  );
});

describe("the project's column", () => {
  const project: Project = new Project();
  const column: string = "securityAutomaticResponseMaxBlocksPerHour";

  test("is a whole number, 50 unless changed, for every project", () => {
    const metadata: TableColumnMetadata =
      project.getTableColumnMetadata(column);

    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(
      SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
    );
    expect(metadata.title).toBe("Automatic Response Hourly Limit");
    expect(metadata.description).toContain("from 1 to 500, 50 unless changed");
  });

  test("a Security Admin changes it, as they turn the policies on, and so do a Project Owner and a Project Admin", () => {
    const access: ColumnAccessControl | null =
      project.getColumnAccessControlFor(column);

    expect(access?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
    ]);
    // Everyone in the project reads it: the page says the limit to whoever reads the policies.
    expect(access?.read).toContain(Permission.ProjectUser);
    expect(access?.read).toContain(Permission.ProjectMember);
  });

  test("the project's own update list lets a Security Admin through to it", () => {
    expect(project.getUpdatePermissions()).toContain(Permission.SecurityAdmin);
  });

  test("and to nothing else of the project but the Trusted Proxies switches: the only columns whose update names a Security Admin", () => {
    const columns: Dictionary<ColumnAccessControl> =
      project.getColumnAccessControlForAllColumns();

    // The record's own columns (its id, when it was created) are never written by a caller.
    const named: Array<string> = Object.keys(columns).filter(
      (key: string): boolean => {
        return (
          !ALWAYS_SELECTABLE_COLUMNS.includes(key) &&
          (columns[key]?.update || []).includes(Permission.SecurityAdmin)
        );
      },
    );

    /*
     * Beside it, the two switches of Security Events' Trusted Proxies a
     * Security Admin flips (#10546, #10548): whether the project's own load
     * balancers are trusted, and whether its access logs end with
     * X-Forwarded-For.
     */
    expect(named.sort()).toEqual(
      [
        column,
        "securityReadAccessLogForwardedFor",
        "securityTrustOwnLoadBalancers",
      ].sort(),
    );

    // Nor does any column let in a permission every member holds, now a Security Admin passes the table.
    for (const key of Object.keys(columns)) {
      if (ALWAYS_SELECTABLE_COLUMNS.includes(key)) {
        continue;
      }

      const update: Array<Permission> = columns[key]?.update || [];

      expect({ key, broad: update.includes(Permission.ProjectUser) }).toEqual({
        key,
        broad: false,
      });
      expect({ key, broad: update.includes(Permission.CurrentUser) }).toEqual({
        key,
        broad: false,
      });
    }
  });
});
