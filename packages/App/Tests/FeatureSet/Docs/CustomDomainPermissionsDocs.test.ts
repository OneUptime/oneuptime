import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Who may press a custom domain's Check now, order its certificate or
 * reissue it - whoever may edit the domain - as the English guides say it,
 * held to the permissions the server checks: every permission and role on
 * the domain table's update list is named, and none of the read-only roles
 * the guides mention is on it. Read-only API keys lose these actions, and
 * the guides say so with the routes' names.
 *
 * And the workflow guide's line on Edit and Delete Workflow, held to the
 * workflow's update list.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

function section(page: string, from: string, to: string): string {
  const text: string = read(page);
  const start: number = text.indexOf(from);
  const end: number = text.indexOf(to, start + 1);

  expect([from, start]).not.toEqual([from, -1]);
  expect([to, end]).not.toEqual([to, -1]);

  return text.slice(start, end);
}

type Guide = {
  page: string;
  from: string;
  to: string;
  updatePermissions: Array<Permission>;
  readPermission: Permission;
  readOnlyRoles: Array<Permission>;
  apiPath: string;
};

const GUIDES: Array<[string, Guide]> = [
  [
    "status page custom domains",
    {
      page: "status-pages/branding-and-domains.md",
      from: "## Who can check and reissue",
      to: "## Powered by OneUptime",
      updatePermissions: new StatusPageDomain().getUpdatePermissions(),
      readPermission: Permission.ReadStatusPageDomain,
      readOnlyRoles: [Permission.Viewer, Permission.StatusPageViewer],
      apiPath: "/status-page-domain",
    },
  ],
  [
    "dashboard custom domains",
    {
      page: "dashboards/sharing.md",
      from: "### Who can check and reissue",
      to: "## Branding",
      updatePermissions: new DashboardDomain().getUpdatePermissions(),
      readPermission: Permission.ReadDashboardDomain,
      readOnlyRoles: [Permission.Viewer, Permission.SettingsViewer],
      apiPath: "/dashboard-domain",
    },
  ],
];

describe.each(GUIDES)(
  "who can check and reissue %s",
  (_label: string, guide: Guide) => {
    const text: string = section(guide.page, guide.from, guide.to);

    it("names every permission and role that may edit the domain", () => {
      for (const permission of guide.updatePermissions) {
        const title: string = PermissionHelper.getTitle(permission);

        expect([title, text.includes(title)]).toEqual([title, true]);
      }
    });

    it("names read-only roles that are not on the domain's update list", () => {
      for (const role of guide.readOnlyRoles) {
        const title: string = PermissionHelper.getTitle(role);

        expect([title, text.includes(title)]).toEqual([title, true]);
        expect([title, guide.updatePermissions.includes(role)]).toEqual([
          title,
          false,
        ]);
      }
    });

    it("says Check now and Reissue SSL are locked for them, and OneUptime keeps checking on its own", () => {
      expect(text).toContain("**Check now**");
      expect(text).toContain("**Reissue SSL**");
      expect(text).toContain("are locked");
      expect(text).toContain("on its own either way");
    });

    it("says read-only API keys lose the three routes, and what to grant instead", () => {
      for (const route of ["verify-cname", "order-ssl", "reissue-ssl"]) {
        expect(text).toContain(`\`${route}\``);
      }

      expect(text).toContain(`\`${guide.apiPath}\``);
      expect(text).toContain(
        `**${PermissionHelper.getTitle(guide.readPermission)}**`,
      );
    });
  },
);

describe("the workflow guide's permissions", () => {
  const text: string = section(
    "workflows/configuration.md",
    "## Permissions",
    "## Plan limits",
  );

  it("says changing a workflow takes Edit Workflow, and Delete Workflow only deletes", () => {
    expect(text).toContain(
      "Changing a workflow, including turning it on or off and archiving it, takes **Edit Workflow**; **Delete Workflow** only deletes.",
    );

    const updateList: Array<Permission> = new Workflow().getUpdatePermissions();

    expect(updateList).toContain(Permission.EditWorkflow);
    expect(updateList).not.toContain(Permission.DeleteWorkflow);
  });
});
