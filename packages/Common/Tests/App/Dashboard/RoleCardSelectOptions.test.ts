import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ROLE_ICONS,
  getRoleCardSelectOption,
  getRoleCardSelectOptions,
  getRoleIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import IconProp from "../../../Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";

/*
 * The role cards every "Add Role" shows - a team's permissions, an API key's
 * permissions - and the roles a new API key's Access offers
 * (Dashboard/src/Components/Permission/RoleCardSelectOptions). One list, so a
 * role reads and looks the same wherever it is picked. It moved out of the
 * team permission table unchanged; these pin what it was.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function valuesOf(group: CardSelectOptionGroup): Array<string> {
  return group.options.map((option: CardSelectOption): string => {
    return option.value;
  });
}

describe("the role cards", () => {
  const groups: Array<CardSelectOptionGroup> = getRoleCardSelectOptions();

  test("come in four groups, widest first", () => {
    expect(
      groups.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(["Owner", "Project Roles", "Administration", "Domain Roles"]);
  });

  test("Owner holds the project's owner and admin", () => {
    expect(valuesOf(groups[0]!)).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });

  test("Project Roles holds the project's member and viewer", () => {
    expect(valuesOf(groups[1]!)).toEqual([
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
  });

  test("Administration holds the settings and billing roles", () => {
    expect(new Set(valuesOf(groups[2]!))).toEqual(
      new Set<string>([
        Permission.SettingsAdmin,
        Permission.SettingsMember,
        Permission.SettingsViewer,
        Permission.BillingAdmin,
        Permission.BillingMember,
        Permission.BillingViewer,
      ]),
    );
  });

  test("Domain Roles holds the product areas", () => {
    const domain: Array<string> = valuesOf(groups[3]!);

    for (const role of [
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.MonitorMember,
      Permission.StatusPageViewer,
      Permission.OnCallAdmin,
      Permission.TelemetryMember,
      Permission.WorkflowViewer,
      Permission.RunbookAdmin,
    ]) {
      expect(domain).toContain(role);
    }
  });

  test("hold every role exactly once, and nothing that is not a role", () => {
    const roles: Array<string> = PermissionHelper.getRolePermissionProps().map(
      (props: PermissionProps): string => {
        return props.permission;
      },
    );

    const offered: Array<string> = groups.flatMap(valuesOf);

    expect(offered.slice().sort()).toEqual(roles.slice().sort());
    expect(new Set(offered).size).toBe(offered.length);
  });

  test("show the role's own title and description", () => {
    for (const props of PermissionHelper.getRolePermissionProps()) {
      const option: CardSelectOption = getRoleCardSelectOption(props);

      expect(option.value).toBe(props.permission);
      expect(option.title).toBe(props.title);
      expect(option.description).toBe(props.description);
      expect(option.icon).toBe(getRoleIcon(props.permission));
    }
  });

  test("keep the icons they had: an area's icon for each of its roles", () => {
    expect(getRoleIcon(Permission.ProjectOwner)).toBe(IconProp.ShieldCheck);
    expect(getRoleIcon(Permission.ProjectAdmin)).toBe(IconProp.User);
    expect(getRoleIcon(Permission.ProjectMember)).toBe(IconProp.Team);
    expect(getRoleIcon(Permission.Viewer)).toBe(IconProp.Eye);
    expect(getRoleIcon(Permission.IncidentMember)).toBe(IconProp.Alert);
    expect(getRoleIcon(Permission.AlertViewer)).toBe(IconProp.BellAlert);
    expect(getRoleIcon(Permission.MonitorAdmin)).toBe(IconProp.Activity);
    expect(getRoleIcon(Permission.StatusPageMember)).toBe(IconProp.Globe);
    expect(getRoleIcon(Permission.OnCallViewer)).toBe(IconProp.Phone);
    expect(getRoleIcon(Permission.ScheduledMaintenanceAdmin)).toBe(
      IconProp.Calendar,
    );
    expect(getRoleIcon(Permission.TelemetryMember)).toBe(IconProp.ChartBar);
    expect(getRoleIcon(Permission.SecurityViewer)).toBe(
      IconProp.ShieldExclamation,
    );
    expect(getRoleIcon(Permission.SettingsAdmin)).toBe(IconProp.Settings);
    expect(getRoleIcon(Permission.BillingMember)).toBe(IconProp.CreditCard);
    expect(getRoleIcon(Permission.WorkflowAdmin)).toBe(IconProp.Workflow);
    expect(getRoleIcon(Permission.RunbookViewer)).toBe(IconProp.PlayCircle);
  });

  test("give a role with no icon of its own a lock, and every role an icon", () => {
    expect(getRoleIcon(Permission.CreateProjectMonitor)).toBe(IconProp.Lock);

    for (const props of PermissionHelper.getRolePermissionProps()) {
      expect(ROLE_ICONS[props.permission]).toBeDefined();
    }
  });
});

describe("every Add Role uses this one list", () => {
  test("a team's permissions", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/Team/TeamPermissionTable.tsx"),
      "utf8",
    );

    expect(source).toContain("getRoleCardSelectOptions()");
    // No list of its own left behind.
    expect(source).not.toContain("roleIconMap");
    expect(source).not.toContain("getRolePermissionProps");
  });

  test("an API key's permissions", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/ApiKey/ApiKeyPermissionTable.tsx"),
      "utf8",
    );

    expect(source).toContain("cardSelectOptions: getRoleCardSelectOptions()");
  });

  /*
   * The roles read the same wherever they are picked: a plain grid under
   * their four headings, which is how the maintainer keeps a team's
   * (App/Tests/Dashboard/MonitorTypePickerWiring: "team permission table
   * stays a plain grid"). A key's Add Role does not grow a search box or
   * folding of its own.
   */
  test.each([
    ["a team's", "Components/Team/TeamPermissionTable.tsx"],
    ["an API key's", "Components/ApiKey/ApiKeyPermissionTable.tsx"],
  ])("%s Add Role is the same plain grid", (_name: string, file: string) => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, file),
      "utf8",
    );

    expect(source).toContain("FormFieldSchemaType.CardSelect");
    expect(source).not.toContain("cardSelectSearchable");
    expect(source).not.toContain("cardSelectCollapsibleGroups");
  });

  test("a new API key's Access", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/ApiKey/ApiKeyAccess.ts"),
      "utf8",
    );

    expect(source).toContain("getRoleIcon(Permission.ProjectAdmin)");
    expect(source).toContain("getRoleIcon(Permission.ProjectMember)");
    expect(source).toContain("getRoleIcon(Permission.Viewer)");
  });
});
