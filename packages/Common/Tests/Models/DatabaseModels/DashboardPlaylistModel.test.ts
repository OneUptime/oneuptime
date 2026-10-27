import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardPlaylist from "../../../Models/DatabaseModels/DashboardPlaylist";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS } from "../../../Types/Dashboard/DashboardPlaylist";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A dashboard playlist (issue #5235): the dashboards a screen shows one
 * after another, and how long each is shown. Who may make, change, play and
 * delete one is the model's to say, as a dashboard's is: project owners and
 * admins, or the playlist permission; everyone who reads the project's
 * dashboards by their role sees and plays playlists. These tests pin it.
 */

const playlist: DashboardPlaylist = new DashboardPlaylist();
const access: Dictionary<ColumnAccessControl> =
  playlist.getColumnAccessControlForAllColumns();
const columns: Dictionary<TableColumnMetadata> = getTableColumns(playlist);

const CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateDashboardPlaylist,
];

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditDashboardPlaylist,
];

const DELETERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteDashboardPlaylist,
];

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadDashboardPlaylist,
];

// What the people who set a playlist up write, and everyone who reads it sees.
const SETTINGS: Array<string> = ["name", "dashboards", "intervalInSeconds"];

function accessOf(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | undefined = access[column];

  expect({ column, defined: control !== undefined }).toEqual({
    column,
    defined: true,
  });

  return control!;
}

function columnOf(column: string): TableColumnMetadata {
  const metadata: TableColumnMetadata | undefined = columns[column];

  expect({ column, defined: metadata !== undefined }).toEqual({
    column,
    defined: true,
  });

  return metadata!;
}

function databaseColumnOf(propertyName: string): ColumnMetadataArgs {
  const found: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs): boolean => {
      return (
        args.target === DashboardPlaylist && args.propertyName === propertyName
      );
    })
    .pop();

  expect({ propertyName, found: Boolean(found) }).toEqual({
    propertyName,
    found: true,
  });

  return found!;
}

describe("DashboardPlaylist: what it is", () => {
  test("its table, its names and its icon", () => {
    expect(playlist.tableName).toBe("DashboardPlaylist");
    expect(playlist.singularName).toBe("Dashboard Playlist");
    expect(playlist.pluralName).toBe("Dashboard Playlists");
    expect(playlist.icon).toBe(IconProp.QueueList);
    expect(playlist.tableDescription).toBeTruthy();
  });

  test("its API lives at /dashboard-playlist and is documented", () => {
    expect(playlist.getCrudApiPath()?.toString()).toBe("/dashboard-playlist");
    expect(playlist.enableDocumentation).toBe(true);
  });

  test("it is one of the database's models", () => {
    expect(
      (AllModelTypes as Array<{ new (): BaseModel }>).includes(
        DashboardPlaylist,
      ),
    ).toBe(true);
  });

  test("a playlist is a project's: the tenant column is projectId", () => {
    expect(playlist.getTenantColumn()).toBe("projectId");
  });

  test("like a dashboard, it is on every plan, and not on MCP or in workflows", () => {
    expect(playlist.getCreateBillingPlan()).toBeFalsy();
    expect(playlist.getReadBillingPlan()).toBeFalsy();
    expect(playlist.getUpdateBillingPlan()).toBeFalsy();
    expect(playlist.getDeleteBillingPlan()).toBeFalsy();
    expect(Boolean(playlist.enableMCP)).toBe(false);
  });

  test("its permissions are its own, so no label or owner scope of a dashboard permission reaches it", () => {
    expect(Boolean(playlist.isOperationalResource)).toBe(false);
    expect(playlist.getAccessControlColumn()).toBeFalsy();
    // A dashboard is both: its labels and its owners narrow who reads it.
    expect(new Dashboard().getAccessControlColumn()).toBe("labels");
    expect(new Dashboard().isOperationalResource).toBe(true);
  });
});

describe("DashboardPlaylist: who makes, plays, changes and deletes one", () => {
  test("project owners and admins, or the playlist permission, make, change and delete playlists", () => {
    expect(playlist.getCreatePermissions()).toEqual(CREATORS);
    expect(playlist.getUpdatePermissions()).toEqual(EDITORS);
    expect(playlist.getDeletePermissions()).toEqual(DELETERS);
  });

  test("everyone who reads the project's dashboards by their role reads and plays playlists", () => {
    expect(playlist.getReadPermissions()).toEqual(READERS);
  });

  test("the four permissions are in the catalogue, under Settings with the dashboard ones, and grantable to a team", () => {
    for (const permission of [
      Permission.CreateDashboardPlaylist,
      Permission.ReadDashboardPlaylist,
      Permission.EditDashboardPlaylist,
      Permission.DeleteDashboardPlaylist,
    ]) {
      const props: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (candidate: PermissionProps): boolean => {
            return candidate.permission === permission;
          },
        );

      expect({ permission, found: Boolean(props) }).toEqual({
        permission,
        found: true,
      });
      expect(props!.group).toBe(PermissionGroup.Settings);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isRolePermission).toBe(false);
      // Not limited by labels: a playlist carries none.
      expect(props!.isAccessControlPermission).toBe(false);
      expect(props!.title).toMatch(/Dashboard Playlist$/);
    }
  });

  test("the permission values read as their names", () => {
    expect(Permission.CreateDashboardPlaylist).toBe("CreateDashboardPlaylist");
    expect(Permission.ReadDashboardPlaylist).toBe("ReadDashboardPlaylist");
    expect(Permission.EditDashboardPlaylist).toBe("EditDashboardPlaylist");
    expect(Permission.DeleteDashboardPlaylist).toBe("DeleteDashboardPlaylist");
  });

  test("its settings are written by the people who make and change playlists, and read by every reader", () => {
    for (const column of SETTINGS) {
      const control: ColumnAccessControl = accessOf(column);

      expect({ column, create: control.create }).toEqual({
        column,
        create: CREATORS,
      });
      expect({ column, update: control.update }).toEqual({
        column,
        update: EDITORS,
      });
      expect({ column, read: control.read }).toEqual({
        column,
        read: READERS,
      });
    }
  });

  test("the project is set once, and who created or deleted it is OneUptime's to write", () => {
    expect(accessOf("projectId").update).toEqual([]);
    expect(accessOf("project").update).toEqual([]);

    for (const column of [
      "createdByUser",
      "createdByUserId",
      "deletedByUser",
      "deletedByUserId",
    ]) {
      expect({ column, create: accessOf(column).create }).toEqual({
        column,
        create: [],
      });
      expect({ column, update: accessOf(column).update }).toEqual({
        column,
        update: [],
      });
      expect({ column, read: accessOf(column).read }).toEqual({
        column,
        read: READERS,
      });
    }
  });
});

describe("DashboardPlaylist: its columns", () => {
  test("a name, required, unique in its project", () => {
    const name: TableColumnMetadata = columnOf("name");

    expect(name.required).toBe(true);
    expect(name.type).toBe(TableColumnType.ShortText);
    expect(getUniqueColumnBy(playlist, "name")).toBe("projectId");
  });

  test("its dashboards: one ordered JSON list, which may be left out", () => {
    const dashboards: TableColumnMetadata = columnOf("dashboards");

    expect(dashboards.type).toBe(TableColumnType.JSON);
    expect(Boolean(dashboards.required)).toBe(false);
    expect(dashboards.example).toEqual([
      { dashboardId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e" },
    ]);
    expect(databaseColumnOf("dashboards").options.nullable).toBe(true);
  });

  test("how long each is shown: required, a minute when a create leaves it out - in the API reference and in the database alike", () => {
    const interval: TableColumnMetadata = columnOf("intervalInSeconds");

    expect(interval.type).toBe(TableColumnType.Number);
    expect(interval.required).toBe(true);
    expect(interval.isDefaultValueColumn).toBe(true);
    expect(interval.defaultValue).toBe(
      DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
    );

    const stored: ColumnMetadataArgs = databaseColumnOf("intervalInSeconds");

    expect(stored.options.nullable).toBe(false);
    expect(stored.options.default).toBe(60);
  });

  test("no description: a playlist's name says what it is for", () => {
    expect(columns["description"]).toBeUndefined();
  });

  test("every column a form or the API reference shows has a short description", () => {
    for (const column of Object.keys(columns)) {
      const description: string = columnOf(column).description || "";

      expect({ column, short: description.length <= 150 }).toEqual({
        column,
        short: true,
      });
    }
  });
});
