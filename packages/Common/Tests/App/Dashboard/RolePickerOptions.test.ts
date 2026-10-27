import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getAreaRoleAtLevel,
  getRolePickerAreas,
  getRolePickerRoles,
  getRolePickerSearchTokens,
  getWholeProjectPickerRoles,
  ROLE_LEVEL_SEARCH_WORDS,
  ROLE_PICKER_FIELD_TITLE,
  ROLE_PICKER_LEVEL_LABEL,
  ROLE_PICKER_PICK_AN_AREA,
  ROLE_PICKER_PICK_AN_AREA_HINT,
  ROLE_PICKER_SEARCH_PLACEHOLDER,
  RolePickerArea,
  RolePickerRole,
  searchRolePickerRoles,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RolePickerOptions";
import {
  ROLE_CARD_SUMMARIES,
  getRoleIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import {
  ROLE_AREAS,
  RoleAreaId,
  RoleLevel,
  RoleReach,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCatalog";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE } from "../../../Types/Team/CustomRole";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * WHAT THE ROLE PICKER OFFERS AND HOW ITS SEARCH READS
 * (Dashboard/src/Components/Permission/RolePickerOptions), without
 * rendering anything: the rows of Whole project, the tiles of One area, the
 * role a tile picks at a level, and the ranked matches of a search - in
 * English and in the reader's language.
 */

const OPTIONS_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RolePickerOptions.ts",
  ),
  "utf8",
);

// English as it is: what an English reader's lookup returns.
const ENGLISH: (text: string) => string = (text: string): string => {
  return text;
};

function permissionsOf(roles: Array<RolePickerRole>): Array<Permission> {
  return roles.map((role: RolePickerRole): Permission => {
    return role.permission;
  });
}

function search(
  text: string,
  translate: (text: string) => string = ENGLISH,
  roles: Array<RolePickerRole> = getRolePickerRoles(),
): Array<Permission> {
  return permissionsOf(searchRolePickerRoles(roles, text, translate));
}

describe("the roles the picker offers", () => {
  test("are every built-in role, the whole project first, then each area's Admin, Member and Viewer", () => {
    const offered: Array<Permission> = permissionsOf(getRolePickerRoles());

    expect(offered).toHaveLength(
      PermissionHelper.getRolePermissionProps().length,
    );
    expect(offered.slice(0, 7)).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
    ]);
    expect(offered.slice(-3)).toEqual([
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ]);
  });

  test("each carries its own name, its one line and its icon", () => {
    for (const role of getRolePickerRoles()) {
      const props: PermissionProps | undefined =
        PermissionHelper.getRolePermissionProps().find(
          (candidate: PermissionProps): boolean => {
            return candidate.permission === role.permission;
          },
        );

      expect(role.title).toBe(props?.title);
      expect(role.summary).toBe(ROLE_CARD_SUMMARIES[role.permission]);
      expect(role.icon).toBe(getRoleIcon(role.permission));
      expect(role.place).not.toBeNull();
    }
  });

  test("leave out a role left out everywhere: no row, no tile level, no match", () => {
    const roles: Array<RolePickerRole> = getRolePickerRoles(
      PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
    );

    expect(permissionsOf(roles)).not.toContain(Permission.ProjectOwner);
    expect(permissionsOf(getWholeProjectPickerRoles(roles))).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
    expect(search("owner", ENGLISH, roles)).not.toContain(
      Permission.ProjectOwner,
    );
    expect(search("project owner")).toContain(Permission.ProjectOwner);
  });
});

describe("Whole project", () => {
  test("lists the four roles that reach the whole project, widest first", () => {
    expect(
      permissionsOf(getWholeProjectPickerRoles(getRolePickerRoles())),
    ).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
  });

  test("would list a role the catalog does not place yet, so it can still be picked", () => {
    const unplaced: RolePickerRole = {
      permission: Permission.ReadProjectIncident,
      title: "A role added later",
      summary: "Not placed yet.",
      icon: getRoleIcon(Permission.ReadProjectIncident),
      place: null,
    };

    expect(
      permissionsOf(
        getWholeProjectPickerRoles([...getRolePickerRoles(), unplaced]),
      ),
    ).toContain(Permission.ReadProjectIncident);
  });
});

describe("One area", () => {
  test("has a tile for each of the twelve areas, each at Admin, Member and Viewer", () => {
    const areas: Array<RolePickerArea> =
      getRolePickerAreas(getRolePickerRoles());

    expect(
      areas.map((entry: RolePickerArea): RoleAreaId => {
        return entry.area.id;
      }),
    ).toEqual(
      ROLE_AREAS.map((area: (typeof ROLE_AREAS)[number]): RoleAreaId => {
        return area.id;
      }),
    );

    for (const entry of areas) {
      expect(entry.levels).toEqual([
        RoleLevel.Admin,
        RoleLevel.Member,
        RoleLevel.Viewer,
      ]);
    }
  });

  test("a custom role's picker has every area: only Project Owner is left out", () => {
    expect(
      getRolePickerAreas(
        getRolePickerRoles(PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE),
      ),
    ).toHaveLength(12);
  });

  test("an area keeps only the levels on offer, and goes when none is", () => {
    const roles: Array<RolePickerRole> = getRolePickerRoles([
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
      Permission.SettingsAdmin,
    ]);
    const areas: Array<RolePickerArea> = getRolePickerAreas(roles);

    expect(
      areas.some((entry: RolePickerArea): boolean => {
        return entry.area.id === RoleAreaId.Billing;
      }),
    ).toBe(false);
    expect(
      areas.find((entry: RolePickerArea): boolean => {
        return entry.area.id === RoleAreaId.Settings;
      })?.levels,
    ).toEqual([RoleLevel.Member, RoleLevel.Viewer]);
  });

  test("a tile picks its role at the level chosen", () => {
    const areas: Array<RolePickerArea> =
      getRolePickerAreas(getRolePickerRoles());
    const incidents: RolePickerArea = areas[0]!;

    expect(getAreaRoleAtLevel(incidents, RoleLevel.Admin)).toEqual({
      permission: Permission.IncidentAdmin,
      level: RoleLevel.Admin,
    });
    expect(getAreaRoleAtLevel(incidents, RoleLevel.Member)).toEqual({
      permission: Permission.IncidentMember,
      level: RoleLevel.Member,
    });
    expect(getAreaRoleAtLevel(incidents, RoleLevel.Viewer)).toEqual({
      permission: Permission.IncidentViewer,
      level: RoleLevel.Viewer,
    });
  });

  test("a level not on offer falls back to Member, then Viewer, then Admin", () => {
    const areas: Array<RolePickerArea> = getRolePickerAreas(
      getRolePickerRoles([Permission.SettingsAdmin, Permission.BillingMember]),
    );
    const settings: RolePickerArea = areas.find(
      (entry: RolePickerArea): boolean => {
        return entry.area.id === RoleAreaId.Settings;
      },
    )!;
    const billing: RolePickerArea = areas.find(
      (entry: RolePickerArea): boolean => {
        return entry.area.id === RoleAreaId.Billing;
      },
    )!;

    expect(getAreaRoleAtLevel(settings, RoleLevel.Admin)).toEqual({
      permission: Permission.SettingsMember,
      level: RoleLevel.Member,
    });
    expect(getAreaRoleAtLevel(billing, RoleLevel.Member)).toEqual({
      permission: Permission.BillingViewer,
      level: RoleLevel.Viewer,
    });
    expect(
      getAreaRoleAtLevel(
        { area: settings.area, levels: [RoleLevel.Admin] },
        RoleLevel.Viewer,
      ),
    ).toEqual({ permission: Permission.SettingsAdmin, level: RoleLevel.Admin });
    expect(
      getAreaRoleAtLevel({ area: settings.area, levels: [] }, RoleLevel.Member),
    ).toBeNull();
  });
});

describe("the search", () => {
  test("reads the words typed, in lower case, whatever separates them", () => {
    expect(getRolePickerSearchTokens("  Incident\tVIEWER \n ")).toEqual([
      "incident",
      "viewer",
    ]);
    expect(getRolePickerSearchTokens("")).toEqual([]);
    expect(getRolePickerSearchTokens("   ")).toEqual([]);
  });

  test("finds nothing for nothing typed", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  test("puts a role named by every word first", () => {
    expect(search("incident viewer")[0]).toBe(Permission.IncidentViewer);
    expect(search("billing admin")[0]).toBe(Permission.BillingAdmin);
    expect(search("PROJECT member")[0]).toBe(Permission.ProjectMember);
  });

  test("finds an area's three roles by the area's name, in the area's order", () => {
    expect(search("billing").slice(0, 3)).toEqual([
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ]);
    expect(search("on-call").slice(0, 3)).toEqual([
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
    ]);
  });

  test("ranks a name above a line that only mentions the word", () => {
    const matches: Array<Permission> = search("billing");

    // Project Owner's line says "billing ... included": found, but after.
    expect(matches).toContain(Permission.ProjectOwner);
    expect(matches.indexOf(Permission.ProjectOwner)).toBeGreaterThan(
      matches.indexOf(Permission.BillingViewer),
    );
  });

  test("finds a level's roles by the level: every Viewer, and Read-only ones", () => {
    const viewers: Array<Permission> = search("viewer");

    expect(viewers).toContain(Permission.Viewer);
    expect(viewers).toContain(Permission.TelemetryViewer);
    expect(viewers).toContain(Permission.RunbookViewer);
    expect(viewers).not.toContain(Permission.TelemetryAdmin);

    const readOnly: Array<Permission> = search("read only");

    for (const permission of [
      Permission.IncidentViewer,
      Permission.AlertViewer,
      Permission.BillingViewer,
      Permission.WorkflowViewer,
    ]) {
      expect(readOnly).toContain(permission);
    }
    expect(readOnly).not.toContain(Permission.IncidentAdmin);
  });

  test("finds a role by what its line says it does", () => {
    // Telemetry's lines name logs; no role is called that.
    expect(search("logs").slice(0, 3)).toEqual([
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
    ]);
    expect(search("invoices")).toContain(Permission.BillingMember);
  });

  test("finds a role by its code name, as the API and Terraform write it", () => {
    expect(search("IncidentMember")[0]).toBe(Permission.IncidentMember);
    expect(search("scheduledmaintenanceviewer")[0]).toBe(
      Permission.ScheduledMaintenanceViewer,
    );
  });

  test("finds nothing when a word matches no role", () => {
    expect(search("incident zebra")).toEqual([]);
    expect(search("zzz")).toEqual([]);
  });

  test("reads the reader's language too: an area's, a level's and a line's words", () => {
    const german: Record<string, string> = {
      Incidents: "Vorfälle",
      Viewer: "Betrachter",
      "Read-only": "Nur Lesezugriff",
      "Read incidents. Change nothing.": "Vorfälle lesen. Nichts ändern.",
    };
    const translate: (text: string) => string = (text: string): string => {
      return german[text] || text;
    };

    expect(search("vorfälle betrachter", translate)[0]).toBe(
      Permission.IncidentViewer,
    );
    expect(search("vorfälle", translate).slice(0, 3)).toEqual([
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
    ]);
    expect(search("lesezugriff", translate)).toContain(
      Permission.MonitorViewer,
    );
    // English still finds them for a German reader.
    expect(search("incident viewer", translate)[0]).toBe(
      Permission.IncidentViewer,
    );
  });

  test("keeps the catalog's order between equally good matches", () => {
    const admins: Array<Permission> = search("admin");
    const areaAdmins: Array<Permission> = admins.filter(
      (permission: Permission): boolean => {
        return permission !== Permission.ProjectAdmin;
      },
    );

    expect(admins[0]).toBe(Permission.ProjectAdmin);
    expect(areaAdmins.slice(0, 3)).toEqual([
      Permission.IncidentAdmin,
      Permission.AlertAdmin,
      Permission.MonitorAdmin,
    ]);
  });

  /*
   * What is typed is matched with includes and startsWith, never a pattern,
   * so a search as long as a book takes no longer than reading it.
   */
  test("answers a 400,000-character search in well under two seconds", () => {
    const longSearch: string = `${"incident ".repeat(40000)}${"x".repeat(40000)}`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(search(longSearch)).toEqual([]);
        expect(search("a".repeat(400000))).toEqual([]);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the picker's own words", () => {
  test("are short, and written out whole in translationKey() for the extractor", () => {
    const words: Record<string, string> = {
      ROLE_PICKER_FIELD_TITLE,
      ROLE_PICKER_LEVEL_LABEL,
      ROLE_PICKER_SEARCH_PLACEHOLDER,
      ROLE_PICKER_PICK_AN_AREA,
      ROLE_PICKER_PICK_AN_AREA_HINT,
    };

    expect(words).toEqual({
      ROLE_PICKER_FIELD_TITLE: "Role",
      ROLE_PICKER_LEVEL_LABEL: "Access level",
      ROLE_PICKER_SEARCH_PLACEHOLDER: "Search roles",
      ROLE_PICKER_PICK_AN_AREA: "Pick an area",
      ROLE_PICKER_PICK_AN_AREA_HINT: "Then choose Admin, Member or Viewer.",
    });

    for (const text of [
      ...Object.values(words),
      ...ROLE_LEVEL_SEARCH_WORDS[RoleLevel.Viewer],
    ]) {
      const oneLine: string = OPTIONS_SOURCE.split(/\s+/).join(" ");

      expect({
        text,
        extracted:
          oneLine.includes(`translationKey("${text}")`) ||
          oneLine.includes(`translationKey( "${text}", )`),
      }).toEqual({ text, extracted: true });
    }
  });

  test("the hint names the levels as the level switch does", () => {
    expect(ROLE_PICKER_PICK_AN_AREA_HINT).toContain("Admin, Member or Viewer");
  });

  test("only Viewer answers to words beyond its name", () => {
    expect(ROLE_LEVEL_SEARCH_WORDS).toEqual({
      [RoleLevel.Admin]: [],
      [RoleLevel.Member]: [],
      [RoleLevel.Viewer]: ["Read-only"],
    });
  });

  test("whole-project roles answer to Whole project", () => {
    expect(search("whole project")).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
      ]),
    );
    for (const role of getRolePickerRoles()) {
      if (role.place?.reach === RoleReach.OneArea) {
        expect(search("whole project")).not.toContain(role.permission);
      }
    }
  });
});
