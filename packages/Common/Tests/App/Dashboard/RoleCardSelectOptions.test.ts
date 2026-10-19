import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ROLE_CARD_SUMMARIES,
  ROLE_ICONS,
  getRoleCardSelectOption,
  getRoleCardSelectOptions,
  getRoleCardSummary,
  getRoleIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import IconProp from "../../../Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE } from "../../../Types/Team/CustomRole";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";

/*
 * The role cards every "Add Role" shows - a team's permissions, an API key's
 * permissions - and the roles the Access question of a new API key or team
 * offers (Dashboard/src/Components/Permission/RoleCardSelectOptions). One
 * list, so a role reads and looks the same wherever it is picked. It moved
 * out of the team permission table unchanged; these pin what it was.
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

  test("show the role's own title, and its one line", () => {
    for (const props of PermissionHelper.getRolePermissionProps()) {
      const option: CardSelectOption = getRoleCardSelectOption(props);

      expect(option.value).toBe(props.permission);
      expect(option.title).toBe(props.title);
      expect(option.description).toBe(ROLE_CARD_SUMMARIES[props.permission]);
      expect(option.description).toBe(getRoleCardSummary(props));
      expect(option.icon).toBe(getRoleIcon(props.permission));
    }
  });

  test("show the role's whole description when asked for it", () => {
    for (const props of PermissionHelper.getRolePermissionProps()) {
      expect(
        getRoleCardSelectOption(props, { fullDescription: true }).description,
      ).toBe(props.description);
    }

    const described: Array<CardSelectOption> = getRoleCardSelectOptions({
      fullDescriptions: true,
    }).flatMap((group: CardSelectOptionGroup): Array<CardSelectOption> => {
      return group.options;
    });

    expect(described.length).toBe(
      PermissionHelper.getRolePermissionProps().length,
    );

    for (const option of described) {
      expect(option.description).toBe(
        PermissionHelper.getRolePermissionProps().find(
          (props: PermissionProps): boolean => {
            return props.permission === option.value;
          },
        )?.description,
      );
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

/*
 * A role's card says what it is for in one line, not its full description
 * (a paragraph: Project Member's ran to twelve lines on its card), so Add
 * Role reads at a glance. The full description is still there to look up,
 * on the Built-in Roles card.
 */
describe("the role cards' one-line summaries", () => {
  const roles: Array<PermissionProps> =
    PermissionHelper.getRolePermissionProps();

  test("every role has one, and nothing that is not a role does", () => {
    const missing: Array<string> = roles
      .filter((props: PermissionProps): boolean => {
        return !ROLE_CARD_SUMMARIES[props.permission];
      })
      .map((props: PermissionProps): string => {
        return props.title;
      });

    expect(missing).toEqual([]);

    const roleValues: Array<string> = roles.map(
      (props: PermissionProps): string => {
        return props.permission;
      },
    );

    expect(
      Object.keys(ROLE_CARD_SUMMARIES).filter((permission: string) => {
        return !roleValues.includes(permission);
      }),
    ).toEqual([]);
  });

  test("each is one short line, shorter than the description it stands for", () => {
    for (const props of roles) {
      const summary: string = ROLE_CARD_SUMMARIES[props.permission] as string;

      expect(summary.length).toBeLessThanOrEqual(110);
      expect(summary.endsWith(".")).toBe(true);
      expect(summary).not.toContain("\n");
      // At most two sentences: "Read monitors. Change nothing."
      expect(summary.split(". ").length).toBeLessThanOrEqual(2);

      if (props.description.length > 110) {
        expect(summary.length).toBeLessThan(props.description.length);
      }
    }
  });

  test("a role that grants the same as another reads the same", () => {
    expect(ROLE_CARD_SUMMARIES[Permission.StatusPageMember]).toBe(
      ROLE_CARD_SUMMARIES[Permission.StatusPageAdmin],
    );
    expect(ROLE_CARD_SUMMARIES[Permission.OnCallMember]).toBe(
      ROLE_CARD_SUMMARIES[Permission.OnCallAdmin],
    );
  });

  test("the viewer roles say they change nothing, and read only", () => {
    for (const permission of [
      Permission.Viewer,
      Permission.IncidentViewer,
      Permission.AlertViewer,
      Permission.MonitorViewer,
      Permission.StatusPageViewer,
      Permission.OnCallViewer,
      Permission.ScheduledMaintenanceViewer,
      Permission.TelemetryViewer,
      Permission.SecurityViewer,
      Permission.SettingsViewer,
      Permission.BillingViewer,
      Permission.WorkflowViewer,
    ]) {
      const summary: string = ROLE_CARD_SUMMARIES[permission] as string;

      expect(summary.startsWith("Read ")).toBe(true);
      expect(summary.endsWith(" Change nothing.")).toBe(true);
    }

    // A runbook viewer cannot run one either, which is what sets it apart.
    expect(ROLE_CARD_SUMMARIES[Permission.RunbookViewer]).toBe(
      "Read runbooks and their runs. Run nothing.",
    );
  });

  test("the project's owner and admin differ by billing and deleting the project", () => {
    expect(ROLE_CARD_SUMMARIES[Permission.ProjectOwner]).toContain(
      "billing and deleting the project included",
    );
    expect(ROLE_CARD_SUMMARIES[Permission.ProjectAdmin]).toContain(
      "Billing and deleting the project are left out",
    );
  });

  test("are written out whole in the source, for the extractor", () => {
    const source: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "Permission",
        "RoleCardSelectOptions.ts",
      ),
      "utf8",
    );

    for (const summary of Object.values(ROLE_CARD_SUMMARIES)) {
      expect(source).toContain(`"${summary}"`);
    }
  });

  test("the Built-in Roles card asks for the whole descriptions", () => {
    const card: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "CustomRole",
        "BuiltInRolesCard.tsx",
      ),
      "utf8",
    );

    expect(card).toContain(
      "getRoleCardSelectOptions({ fullDescriptions: true })",
    );
  });
});

/*
 * A custom role's Add Role shows these cards without Project Owner, which no
 * role holds: left out of its group, and nothing else changes.
 */
describe("the role cards without some roles", () => {
  test("leave each one out of its group, and keep the rest in order", () => {
    const groups: Array<CardSelectOptionGroup> = getRoleCardSelectOptions({
      excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
    });
    const all: Array<CardSelectOptionGroup> = getRoleCardSelectOptions();

    expect(PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE).toEqual([
      Permission.ProjectOwner,
    ]);
    expect(valuesOf(groups[0]!)).toEqual([Permission.ProjectAdmin]);
    expect(
      groups.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(["Owner", "Project Roles", "Administration", "Domain Roles"]);
    for (let index: number = 1; index < all.length; index++) {
      expect(groups[index]).toEqual(all[index]);
    }
  });

  test("a group left with no role is not shown", () => {
    const groups: Array<CardSelectOptionGroup> = getRoleCardSelectOptions({
      excludeRoles: [Permission.ProjectOwner, Permission.ProjectAdmin],
    });

    expect(
      groups.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(["Project Roles", "Administration", "Domain Roles"]);
  });

  test("no filter, or an empty one, is every role", () => {
    expect(getRoleCardSelectOptions({ excludeRoles: [] })).toEqual(
      getRoleCardSelectOptions(),
    );
    expect(getRoleCardSelectOptions({})).toEqual(getRoleCardSelectOptions());
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

  test("a custom role's permissions, and the roles a new custom role starts with", () => {
    for (const file of [
      "Components/CustomRole/CustomRolePermissionTable.tsx",
      "Components/CustomRole/CustomRoleCreateForm.ts",
    ]) {
      // Read as one line, so a wrap the formatter picks does not matter.
      const source: string = fs
        .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
        .split(/\s+/)
        .join(" ");

      expect(source).toContain(
        "getRoleCardSelectOptions({ excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE, })",
      );
      expect(source).not.toContain("getRolePermissionProps");
    }
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
    ["a custom role's", "Components/CustomRole/CustomRolePermissionTable.tsx"],
  ])("%s Add Role is the same plain grid", (_name: string, file: string) => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, file),
      "utf8",
    );

    expect(source).toContain("FormFieldSchemaType.CardSelect");
    expect(source).not.toContain("cardSelectSearchable");
    expect(source).not.toContain("cardSelectCatalog");
  });

  test("the Access question of a new API key or team", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/Permission/RoleAccess.ts"),
      "utf8",
    );

    expect(source).toContain("getRoleIcon(Permission.ProjectAdmin)");
    expect(source).toContain("getRoleIcon(Permission.ProjectMember)");
    expect(source).toContain("getRoleIcon(Permission.Viewer)");

    // One Access question, shared: the key's own copy is gone.
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Components/ApiKey/ApiKeyAccess.ts"),
      ),
    ).toBe(false);
  });
});
