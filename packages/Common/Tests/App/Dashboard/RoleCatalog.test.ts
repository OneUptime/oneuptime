import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_ROLE_LEVEL,
  getRoleArea,
  getRolePlace,
  ROLE_AREAS,
  ROLE_LEVEL_TITLES,
  ROLE_LEVELS,
  ROLE_REACH_TITLES,
  ROLE_REACHES,
  RoleArea,
  RoleAreaId,
  RoleLevel,
  RolePlace,
  RoleReach,
  WHOLE_PROJECT_ROLES,
  WholeProjectRole,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCatalog";
import IconProp from "../../../Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

/*
 * THE ROLE CATALOG (Dashboard/src/Components/Permission/RoleCatalog): every
 * built-in role as the answer to two questions - how far it reaches (the
 * whole project, or one area of it) and, for an area, how much (Admin,
 * Member or Viewer). The Add a Role dialog asks those two questions
 * (RolePicker) instead of showing forty look-alike cards, and the lists of
 * roles group them the same way (RoleCardSelectOptions).
 *
 * What is pinned here is what the picker cannot do without: every role
 * placed exactly once, so none goes missing from Add Role when Permission
 * grows; each area's three roles really being that area at those levels;
 * and the words in the source, where the string extractor finds them.
 */

const CATALOG_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCatalog.ts",
  ),
  "utf8",
);

const ROLES: Array<PermissionProps> = PermissionHelper.getRolePermissionProps();

// Every place the catalog gives a role: the whole project, or an area's level.
function catalogPlaces(): Array<Permission> {
  return [
    ...WHOLE_PROJECT_ROLES.map((role: WholeProjectRole): Permission => {
      return role.permission;
    }),
    ...ROLE_AREAS.flatMap((area: RoleArea): Array<Permission> => {
      return ROLE_LEVELS.map((level: RoleLevel): Permission => {
        return area.roles[level];
      });
    }),
  ];
}

describe("every built-in role has one place in the catalog", () => {
  test("each role of Permission is placed, and placed once", () => {
    const places: Array<Permission> = catalogPlaces();

    const missing: Array<string> = ROLES.filter(
      (props: PermissionProps): boolean => {
        return !places.includes(props.permission);
      },
    ).map((props: PermissionProps): string => {
      return props.title;
    });

    // A role added to Permission must get a place, or Add Role hides it.
    expect(missing).toEqual([]);
    expect(new Set(places).size).toBe(places.length);
  });

  test("nothing that is not a role has a place", () => {
    const roleValues: Array<string> = ROLES.map(
      (props: PermissionProps): string => {
        return props.permission;
      },
    );

    expect(
      catalogPlaces().filter((permission: Permission): boolean => {
        return !roleValues.includes(permission);
      }),
    ).toEqual([]);
  });

  test("there are as many places as roles: four for the whole project, three for each of twelve areas", () => {
    expect(WHOLE_PROJECT_ROLES).toHaveLength(4);
    expect(ROLE_AREAS).toHaveLength(12);
    expect(catalogPlaces()).toHaveLength(ROLES.length);
    expect(ROLES.length).toBe(4 + 12 * 3);
  });
});

describe("the whole project", () => {
  test("is Project Owner, Project Admin, Project Member and Viewer, widest first", () => {
    expect(
      WHOLE_PROJECT_ROLES.map((role: WholeProjectRole): Permission => {
        return role.permission;
      }),
    ).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
  });

  test("keeps the icons the role cards and the Access cards always gave them", () => {
    expect(
      WHOLE_PROJECT_ROLES.map((role: WholeProjectRole): IconProp => {
        return role.icon;
      }),
    ).toEqual([
      IconProp.ShieldCheck,
      IconProp.User,
      IconProp.Team,
      IconProp.Eye,
    ]);
  });

  test("each of them reaches the whole project, with no area and no level", () => {
    for (const role of WHOLE_PROJECT_ROLES) {
      expect(getRolePlace(role.permission)).toEqual({
        reach: RoleReach.WholeProject,
        area: null,
        level: null,
      });
    }
  });
});

describe("the areas", () => {
  test("come in the order people meet them: responding, then observing and securing, automation, then the project's settings and billing", () => {
    expect(
      ROLE_AREAS.map((area: RoleArea): RoleAreaId => {
        return area.id;
      }),
    ).toEqual([
      RoleAreaId.Incidents,
      RoleAreaId.Alerts,
      RoleAreaId.Monitors,
      RoleAreaId.StatusPages,
      RoleAreaId.OnCall,
      RoleAreaId.ScheduledMaintenance,
      RoleAreaId.Telemetry,
      RoleAreaId.Security,
      RoleAreaId.Workflows,
      RoleAreaId.Runbooks,
      RoleAreaId.Settings,
      RoleAreaId.Billing,
    ]);
  });

  test("are called by the products' own names", () => {
    expect(
      ROLE_AREAS.map((area: RoleArea): string => {
        return area.title;
      }),
    ).toEqual([
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

  /*
   * The icon each product wears in the Products menu (Utils/
   * NavigationItems), so the Incidents tile looks like Incidents. Telemetry
   * and Billing have no single product there: a chart and a card.
   */
  test("wear the icon their product wears in the Products menu", () => {
    const icons: Record<string, IconProp> = {};

    for (const area of ROLE_AREAS) {
      icons[area.id] = area.icon;
    }

    expect(icons).toEqual({
      [RoleAreaId.Incidents]: IconProp.Alert,
      [RoleAreaId.Alerts]: IconProp.ExclaimationCircle,
      [RoleAreaId.Monitors]: IconProp.AltGlobe,
      [RoleAreaId.StatusPages]: IconProp.CheckCircle,
      [RoleAreaId.OnCall]: IconProp.Call,
      [RoleAreaId.ScheduledMaintenance]: IconProp.Clock,
      [RoleAreaId.Telemetry]: IconProp.ChartBar,
      [RoleAreaId.Security]: IconProp.ShieldExclamation,
      [RoleAreaId.Workflows]: IconProp.FlowDiagram,
      [RoleAreaId.Runbooks]: IconProp.BookOpen,
      [RoleAreaId.Settings]: IconProp.Settings,
      [RoleAreaId.Billing]: IconProp.CreditCard,
    });
  });

  test("the icons are the Products menu's, read from it", () => {
    const navigation: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx",
      ),
      "utf8",
    );

    for (const icon of [
      "IconProp.Alert,",
      "IconProp.ExclaimationCircle,",
      "IconProp.AltGlobe,",
      "IconProp.CheckCircle,",
      "IconProp.Call,",
      "IconProp.Clock,",
      "IconProp.ShieldExclamation,",
      "IconProp.FlowDiagram,",
      "IconProp.BookOpen,",
      "IconProp.Settings,",
    ]) {
      expect({ icon, inMenu: navigation.includes(`icon: ${icon}`) }).toEqual({
        icon,
        inMenu: true,
      });
    }
  });

  /*
   * An area's roles really are that area at those levels: Incident Admin,
   * Incident Member and Incident Viewer - one name, the level last - so the
   * level switch never turns one area's role into another area's.
   */
  test.each(
    ROLE_AREAS.map((area: RoleArea): [string, RoleArea] => {
      return [area.title, area];
    }),
  )(
    "%s holds one name at Admin, Member and Viewer",
    (_title: string, area: RoleArea) => {
      const titles: Array<string> = ROLE_LEVELS.map(
        (level: RoleLevel): string => {
          return PermissionHelper.getTitle(area.roles[level]);
        },
      );

      const stems: Array<string> = ROLE_LEVELS.map(
        (level: RoleLevel, index: number): string => {
          const title: string = titles[index] as string;
          const suffix: string = ` ${level}`;

          expect({ title, endsWithLevel: title.endsWith(suffix) }).toEqual({
            title,
            endsWithLevel: true,
          });

          return title.slice(0, title.length - suffix.length);
        },
      );

      expect(new Set(stems).size).toBe(1);
    },
  );

  test("each role of an area is placed at its area and level", () => {
    for (const area of ROLE_AREAS) {
      for (const level of ROLE_LEVELS) {
        const place: RolePlace | null = getRolePlace(area.roles[level]);

        expect(place?.reach).toBe(RoleReach.OneArea);
        expect(place?.area?.id).toBe(area.id);
        expect(place?.level).toBe(level);
      }
    }
  });

  test("an area is found by its id, and nothing by another", () => {
    for (const area of ROLE_AREAS) {
      expect(getRoleArea(area.id)).toBe(area);
    }

    expect(getRoleArea("Dashboards")).toBeNull();
    expect(getRoleArea("")).toBeNull();
    expect(getRoleArea(undefined)).toBeNull();
    expect(getRoleArea(null)).toBeNull();
  });

  /*
   * Settings and Billing are project-wide by definition - a role of
   * theirs takes no scope (PermissionHelper.isScopeApplicable) - and every
   * other area's roles take one. The More fields line of Add a Role shows
   * the Scope for exactly those.
   */
  test("the Settings and Billing roles take no scope; every other area's do", () => {
    for (const area of ROLE_AREAS) {
      const takesScope: boolean =
        area.id !== RoleAreaId.Settings && area.id !== RoleAreaId.Billing;

      for (const level of ROLE_LEVELS) {
        expect({
          role: area.roles[level],
          takesScope: PermissionHelper.isScopeApplicable(area.roles[level]),
        }).toEqual({ role: area.roles[level], takesScope });
      }
    }
  });
});

describe("where a role is placed", () => {
  test("is nothing for an empty pick, a single permission or an unknown value", () => {
    for (const value of [
      undefined,
      null,
      "",
      "NotARole",
      Permission.ReadProjectIncident,
      Permission.CreateProjectMonitor,
      Permission.ProjectUser,
    ]) {
      expect(getRolePlace(value)).toBeNull();
    }
  });

  test("a stored value reads the same as the enum", () => {
    expect(getRolePlace("IncidentMember")).toEqual(
      getRolePlace(Permission.IncidentMember),
    );
    expect(getRolePlace("BillingViewer")?.area?.id).toBe(RoleAreaId.Billing);
    expect(getRolePlace("BillingViewer")?.level).toBe(RoleLevel.Viewer);
  });
});

describe("the two questions' words", () => {
  test("Whole project and One area, in that order", () => {
    expect(ROLE_REACHES).toEqual([RoleReach.WholeProject, RoleReach.OneArea]);
    expect(ROLE_REACH_TITLES).toEqual({
      [RoleReach.WholeProject]: "Whole project",
      [RoleReach.OneArea]: "One area",
    });
  });

  test("Admin, Member and Viewer, most first, starting on Member", () => {
    expect(ROLE_LEVELS).toEqual([
      RoleLevel.Admin,
      RoleLevel.Member,
      RoleLevel.Viewer,
    ]);
    expect(ROLE_LEVEL_TITLES).toEqual({
      [RoleLevel.Admin]: "Admin",
      [RoleLevel.Member]: "Member",
      [RoleLevel.Viewer]: "Viewer",
    });
    // An area's day-to-day work: what most people given an area's role do.
    expect(DEFAULT_ROLE_LEVEL).toBe(RoleLevel.Member);
  });

  test("are written out whole in translationKey(), for the extractor", () => {
    for (const words of [
      ...Object.values(ROLE_REACH_TITLES),
      ...Object.values(ROLE_LEVEL_TITLES),
      ...ROLE_AREAS.map((area: RoleArea): string => {
        return area.title;
      }),
    ]) {
      expect({
        words,
        extracted: CATALOG_SOURCE.includes(`translationKey("${words}")`),
      }).toEqual({
        words,
        extracted: true,
      });
    }
  });
});
