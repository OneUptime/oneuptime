import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_CHECK_ADMIN_ONLY_READS,
  OpenStackCheckAdminRead,
  getOpenStackCheckTokenRefusal,
  isOpenStackRoleRefused,
} from "../../../../Utils/OpenStack/Checks/OpenStackCheckGuard";
import { OpenStackToken } from "../../../../Utils/OpenStack/OpenStackKeystone";
import { FIXTURES_ROOT } from "../Helpers/RecordedCloud";

/*
 * What stands between a run and a customer's cloud, as a table of what a token can say about
 * itself, and held to what the recordings say a real project's reader is refused.
 */

const PROJECT_ID: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROJECT_NAME: string = "oneuptime-checks";

function tokenOf(overrides: Partial<OpenStackToken> = {}): OpenStackToken {
  return {
    id: "a-token",
    expiresAt: null,
    catalog: [],
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    roleNames: ["member"],
    hasAccessRules: false,
    isUnrestricted: false,
    isAdminProject: false,
    ...overrides,
  };
}

function refusalOf(
  token: Partial<OpenStackToken>,
  guard?: { expected?: string | undefined; pinned?: string | undefined },
): string | null {
  return getOpenStackCheckTokenRefusal({
    token: tokenOf(token),
    expectedProjectName: guard?.expected ?? PROJECT_NAME,
    pinnedProjectId: guard?.pinned,
  });
}

describe("what a token may write with", () => {
  test("a member on the project it was given", () => {
    expect(refusalOf({})).toBeNull();
    expect(refusalOf({}, { pinned: PROJECT_ID })).toBeNull();
    expect(refusalOf({ roleNames: ["member", "reader"] })).toBeNull();
    expect(refusalOf({ roleNames: ["_member_"] })).toBeNull();
    expect(refusalOf({ roleNames: [] })).toBeNull();
  });

  type Row = [string, Partial<OpenStackToken>, string | undefined, string];

  const ROWS: Array<Row> = [
    ["no project scope", { projectId: null }, undefined, "not scoped"],
    [
      "another project by name",
      { projectName: "payments" },
      undefined,
      "scoped to project payments",
    ],
    [
      "a project whose name only differs in case",
      { projectName: "ONEUPTIME-CHECKS" },
      undefined,
      "scoped to project ONEUPTIME-CHECKS",
    ],
    [
      "a project whose name only differs by a space",
      { projectName: `${PROJECT_NAME} ` },
      undefined,
      "scoped to project",
    ],
    [
      "the project's name with another id",
      { projectId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      PROJECT_ID,
      "not the same project",
    ],
    ["admin", { roleNames: ["admin"] }, undefined, "admin role"],
    ["ADMIN", { roleNames: ["ADMIN"] }, undefined, "ADMIN role"],
    ["cloud-admin", { roleNames: ["cloud-admin"] }, undefined, "cloud-admin"],
    [
      "load-balancer_admin",
      { roleNames: ["load-balancer_admin"] },
      undefined,
      "load-balancer_admin",
    ],
    ["ResellerAdmin", { roleNames: ["ResellerAdmin"] }, undefined, "Reseller"],
    ["service", { roleNames: ["service"] }, undefined, "service role"],
    [
      "one bad role among good",
      { roleNames: ["member", "reader", "admin"] },
      undefined,
      "admin role",
    ],
    ["its admin project", { isAdminProject: true }, undefined, "admin project"],
    [
      "unrestricted",
      { isUnrestricted: true },
      undefined,
      "--unrestricted",
    ],
  ];

  test.each(ROWS)(
    "not %s",
    (
      _name: string,
      token: Partial<OpenStackToken>,
      pinned: string | undefined,
      says: string,
    ) => {
      expect(refusalOf(token, { pinned: pinned })).toContain(says);
    },
  );

  test("each refusal says nothing was written, apart from the two that cannot have got that far", () => {
    for (const row of ROWS) {
      const refusal: string = refusalOf(row[1], { pinned: row[2] }) as string;

      if (row[0] !== "no project scope") {
        expect(refusal).toMatch(/Nothing was written|Replace it|admin role/);
      }
    }
  });

  test("the cloud's own projects are refused by name, even with the right token", () => {
    for (const name of ["admin", "Admin", "service", "SERVICE"]) {
      expect(
        refusalOf({ projectName: name }, { expected: name }),
      ).toContain("the cloud's own");
    }
  });

  test("no project given is nothing to hold it to", () => {
    expect(refusalOf({}, { expected: "   " })).toContain("names no project");
  });

  test("a role's name is compared without case, and only as a word that means more", () => {
    for (const role of ["admin", "ADMIN", "project_admin", "service"]) {
      expect(isOpenStackRoleRefused(role)).toBe(true);
    }

    for (const role of ["member", "reader", "creator", "oneuptime_check"]) {
      expect(isOpenStackRoleRefused(role)).toBe(false);
    }
  });
});

/*
 * The guard's reads, held to what the rig really recorded. access/matrix-default-policy.json holds
 * what a plain reader on a project got from each read, on a real cloud with default policy.
 */
describe("the reads only an admin gets rows from, on every recording", () => {
  const releases: Array<string> = fs
    .readdirSync(FIXTURES_ROOT)
    .filter((release: string): boolean => {
      return fs.existsSync(
        path.join(
          FIXTURES_ROOT,
          release,
          "access",
          "matrix-default-policy.json",
        ),
      );
    });

  const READ_NAMES: Record<OpenStackCheckAdminRead["service"], string> = {
    identity: "projects",
    compute: "hypervisors",
    network: "agents",
  };

  test("there are recordings to hold this to", () => {
    expect(releases.length).toBeGreaterThanOrEqual(5);
    expect(OPENSTACK_CHECK_ADMIN_ONLY_READS).toHaveLength(3);
  });

  test.each(releases)(
    "%s: a project's reader gets no rows from any, and an admin gets rows from each",
    (release: string) => {
      const matrix: {
        reads: Array<{
          service: string;
          read: string;
          results: Record<
            string,
            { status: number; count: number | null } | undefined
          >;
        }>;
      } = JSON.parse(
        fs.readFileSync(
          path.join(
            FIXTURES_ROOT,
            release,
            "access",
            "matrix-default-policy.json",
          ),
          "utf8",
        ),
      );

      for (const read of OPENSTACK_CHECK_ADMIN_ONLY_READS) {
        const row = matrix.reads.find((candidate) => {
          return (
            candidate.service === read.service &&
            candidate.read === READ_NAMES[read.service]
          );
        });

        expect(row).toBeDefined();

        const reader = row?.results["reader"];
        const admin = row?.results["admin"];

        // Refused, or answered with nothing: either way, no rows.
        expect(reader?.count ?? 0).toBe(0);
        expect(admin?.status).toBe(200);
        expect(admin?.count ?? 0).toBeGreaterThan(0);
      }
    },
  );
});
