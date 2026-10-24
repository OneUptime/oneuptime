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
import {
  ROLE_AREAS,
  RoleArea,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCatalog";
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
 * The roles as cards and list entries (Dashboard/src/Components/Permission/
 * RoleCardSelectOptions): each role's icon and one line, read by the role
 * picker of every Add Role, the roles a new custom role starts with, the
 * Built-in Roles card and the Access question of a new API key or team.
 * One list, so a role reads and looks the same wherever it is met, grouped
 * as the role catalog arranges the roles (RoleCatalog): the whole project,
 * then one group per area - where Add Role's picker finds them too.
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

  test("come in the catalog's groups: the whole project, then one per area", () => {
    expect(
      groups.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    ).toEqual([
      "Whole project",
      "Incidents",
      "Alerts",
      "Monitors",
      "Status Pages",
      "On-Call",
      "Scheduled Maintenance",
      "Telemetry",
      "Security",
      "Workflows",
      "Runbooks",
      "Settings",
      "Billing",
    ]);
  });

  test("Whole project holds Project Owner, Project Admin, Project Member and Viewer, widest first", () => {
    expect(valuesOf(groups[0]!)).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
  });

  test("each area's group holds its Admin, Member and Viewer, in that order", () => {
    ROLE_AREAS.forEach((area: RoleArea, index: number): void => {
      const group: CardSelectOptionGroup = groups[index + 1]!;

      expect(group.label).toBe(area.title);
      expect(valuesOf(group)).toEqual([
        area.roles.Admin,
        area.roles.Member,
        area.roles.Viewer,
      ]);
    });

    expect(valuesOf(groups[1]!)).toEqual([
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
    ]);
    expect(valuesOf(groups[12]!)).toEqual([
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ]);
  });

  test("the old headings are gone: no Owner, Project Roles, Administration or Domain Roles", () => {
    const labels: Array<string> = groups.map(
      (group: CardSelectOptionGroup): string => {
        return group.label;
      },
    );

    for (const old of [
      "Owner",
      "Project Roles",
      "Administration",
      "Domain Roles",
    ]) {
      expect(labels).not.toContain(old);
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

  /*
   * A whole-project role keeps its own icon. An area's roles wear their
   * area's, which is the icon its product wears in the Products menu
   * (RoleCatalog): Alerts the exclamation in a circle, Monitors the globe,
   * not the bell and the pulse line the old cards drew.
   */
  test("show a whole-project role's own icon, and an area's role its product's", () => {
    expect(getRoleIcon(Permission.ProjectOwner)).toBe(IconProp.ShieldCheck);
    expect(getRoleIcon(Permission.ProjectAdmin)).toBe(IconProp.User);
    expect(getRoleIcon(Permission.ProjectMember)).toBe(IconProp.Team);
    expect(getRoleIcon(Permission.Viewer)).toBe(IconProp.Eye);
    expect(getRoleIcon(Permission.IncidentMember)).toBe(IconProp.Alert);
    expect(getRoleIcon(Permission.AlertViewer)).toBe(
      IconProp.ExclaimationCircle,
    );
    expect(getRoleIcon(Permission.MonitorAdmin)).toBe(IconProp.AltGlobe);
    expect(getRoleIcon(Permission.StatusPageMember)).toBe(IconProp.CheckCircle);
    expect(getRoleIcon(Permission.OnCallViewer)).toBe(IconProp.Call);
    expect(getRoleIcon(Permission.ScheduledMaintenanceAdmin)).toBe(
      IconProp.Clock,
    );
    expect(getRoleIcon(Permission.TelemetryMember)).toBe(IconProp.ChartBar);
    expect(getRoleIcon(Permission.SecurityViewer)).toBe(
      IconProp.ShieldExclamation,
    );
    expect(getRoleIcon(Permission.SettingsAdmin)).toBe(IconProp.Settings);
    expect(getRoleIcon(Permission.BillingMember)).toBe(IconProp.CreditCard);
    expect(getRoleIcon(Permission.WorkflowAdmin)).toBe(IconProp.FlowDiagram);
    expect(getRoleIcon(Permission.RunbookViewer)).toBe(IconProp.BookOpen);

    // Every role of an area wears the same icon.
    for (const area of ROLE_AREAS) {
      expect(getRoleIcon(area.roles.Admin)).toBe(area.icon);
      expect(getRoleIcon(area.roles.Member)).toBe(area.icon);
      expect(getRoleIcon(area.roles.Viewer)).toBe(area.icon);
    }
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
 * A new custom role's starting roles leave out Project Owner, which no role
 * holds: left out of its group, and nothing else changes.
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
    expect(valuesOf(groups[0]!)).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
    expect(
      groups.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(
      all.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    );
    for (let index: number = 1; index < all.length; index++) {
      expect(groups[index]).toEqual(all[index]);
    }
  });

  test("a group left with no role is not shown", () => {
    const groups: Array<CardSelectOptionGroup> = getRoleCardSelectOptions({
      excludeRoles: [
        Permission.BillingAdmin,
        Permission.BillingMember,
        Permission.BillingViewer,
      ],
    });
    const labels: Array<string> = groups.map(
      (group: CardSelectOptionGroup): string => {
        return group.label;
      },
    );

    expect(labels).not.toContain("Billing");
    expect(labels).toHaveLength(12);
    expect(labels[labels.length - 1]).toBe("Settings");
  });

  test("no filter, or an empty one, is every role", () => {
    expect(getRoleCardSelectOptions({ excludeRoles: [] })).toEqual(
      getRoleCardSelectOptions(),
    );
    expect(getRoleCardSelectOptions({})).toEqual(getRoleCardSelectOptions());
  });
});

describe("every place roles are offered reads them from here", () => {
  /*
   * Add Role - a team's, an API key's, a custom role's - is the role
   * picker (Components/Permission/RolePicker), which reads its roles, their
   * lines and their icons from here and the catalog. None of them draws a
   * grid of cards of its own any more: the forty look-alike cards the
   * maintainer found "very confusing". A custom role's Add Role and the
   * roles a new custom role starts with are Enterprise screens
   * (ee/Dashboard/CustomRoles), held to the same rules by
   * ee/Tests/UI/CustomRoles/CustomRolesWiring.test.ts.
   */
  test.each([
    ["a team's", "Components/Team/TeamPermissionTable.tsx", "TeamPermission"],
    [
      "an API key's",
      "Components/ApiKey/ApiKeyPermissionTable.tsx",
      "ApiKeyPermission",
    ],
  ])(
    "%s Add Role is the role picker, not a grid of cards",
    (_name: string, file: string, model: string) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, file),
        "utf8",
      );

      expect(source).toContain(`getRolePickerFormField<${model}>(`);
      expect(source).not.toContain("FormFieldSchemaType.CardSelect");
      expect(source).not.toContain("getRoleCardSelectOptions");
      // No list of its own left behind.
      expect(source).not.toContain("roleIconMap");
      expect(source).not.toContain("getRolePermissionProps");
    },
  );

  test("the list is built from Permission's own roles", () => {
    const source: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components/Permission/RoleCardSelectOptions.ts",
      ),
      "utf8",
    );

    expect(source).toContain("PermissionHelper.getRolePermissionProps()");
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
