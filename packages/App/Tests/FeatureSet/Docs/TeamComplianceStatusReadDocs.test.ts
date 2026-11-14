import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import Team from "Common/Models/DatabaseModels/Team";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * A TEAM'S COMPLIANCE STATUS IS READ ONLY BY SOMEONE WHO MAY READ ITS
 * COMPLIANCE RULES (ee/Server/TeamCompliance/TeamComplianceAPI asks
 * CommonAPI.assertCanReadTable about TeamComplianceSetting before anything is
 * read as root).
 *
 * The upgrade note on it ("Other changes in 14") is held to the models it
 * describes: what it says reads the status is TeamComplianceSetting's read
 * list, the roles OneUptime ships that it says lose the page are outside that
 * list, the Settings roles it says read teams are on Team's, and anyone in the
 * project still lists a team's members through TeamMember's. Every
 * translation carries the note in the English note's place;
 * UpgradingDocsTranslations holds each one to the English note's code, links
 * and numbers, and its lead to a translation of its own.
 */

const NOTE_LEAD: string =
  "On the Enterprise Edition, a team's compliance status is read only by someone who may read its compliance rules.";

// The notes it sits between (SubscriberAndRunScopeDocs, OwnerAndCredentialSettingsDocs).
const PREVIOUS_LEAD: string =
  "What a subscription, a rule's Run Now, an LLM provider list and an AI plan's approval reach";
const NEXT_LEAD: string =
  "Who owns a resource, and a setting that holds credentials, are named";

const ROUTE: string = "GET /api/team/compliance-status/:teamId";

// The sentence that says what the page takes, ending before the blocks.
const TAKES: string = "now takes what reading the rules takes:";
const BLOCKS: string = "and no team block on them.";

// The roles the note names as losing the page.
const SETTINGS_ROLES: Array<Permission> = [
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
];
const PRODUCT_AREA_ROLES: Array<Permission> = [
  Permission.OnCallAdmin,
  Permission.MonitorViewer,
];

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// What a team can be granted in a project.
const TENANT_PERMISSIONS: Array<PermissionProps> =
  PermissionHelper.getTenantPermissionProps();

// What reads the rules on their CRUD endpoint, and so the status.
const READERS: Array<Permission> = new TeamComplianceSetting()
  .getReadPermissions()
  .filter((permission: Permission): boolean => {
    return TENANT_PERMISSIONS.some((props: PermissionProps): boolean => {
      return props.permission === permission;
    });
  });

// The roles OneUptime ships.
const ROLES: Array<Permission> = TENANT_PERMISSIONS.filter(
  (props: PermissionProps): boolean => {
    return props.isRolePermission;
  },
).map((props: PermissionProps): Permission => {
  return props.permission;
});

const NOTE: string = flattened(otherChangesItemAtEnglishPlace("en", NOTE_LEAD));

describe("Docs: a team's compliance status takes a read of its rules", () => {
  test("the English note is one of the 13 → 14 changes, once, between the notes on what a subscription reaches and on who owns a resource", () => {
    const items: Array<string> = otherChangesItems("en").map(flattened);
    const at: (lead: string) => number = (lead: string): number => {
      return items.findIndex((item: string): boolean => {
        return item.startsWith(`- **${lead}`);
      });
    };

    expect(
      items.filter((item: string): boolean => {
        return item.includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(at(PREVIOUS_LEAD)).toBeGreaterThanOrEqual(0);
    expect(at(NOTE_LEAD)).toBeGreaterThan(at(PREVIOUS_LEAD));
    expect(at(NEXT_LEAD)).toBeGreaterThan(at(NOTE_LEAD));
  });

  test("it names the route, and as what the page takes exactly TeamComplianceSetting's read list, blocks included", () => {
    expect(inlineCode(NOTE)).toContain(ROUTE);

    const takes: string = NOTE.slice(
      NOTE.indexOf(TAKES),
      NOTE.indexOf(BLOCKS) + BLOCKS.length,
    );

    expect(takes.startsWith(TAKES)).toBe(true);
    expect(takes.endsWith(BLOCKS)).toBe(true);
    expect(inlineCode(takes)).toEqual([...READERS].sort());
  });

  test("it says every other role OneUptime ships loses the page, and the ones it names are roles outside that list", () => {
    expect(NOTE).toContain("and is now refused with a `422`.");
    expect(NOTE).toContain(
      "Every other role OneUptime ships grants none of them:",
    );

    const code: Array<string> = inlineCode(NOTE);

    for (const role of [...SETTINGS_ROLES, ...PRODUCT_AREA_ROLES]) {
      expect({
        role,
        named: code.includes(role),
        shipped: ROLES.includes(role),
        reads: READERS.includes(role),
      }).toEqual({ role, named: true, shipped: true, reads: false });
    }
  });

  test("the Settings roles it says read teams do read them, and anyone in the project lists a team's members", () => {
    expect(NOTE).toContain("), which read teams,");
    expect(NOTE).toContain(
      "Anyone in the project still lists a team's members.",
    );

    for (const role of SETTINGS_ROLES) {
      expect({
        role,
        readsTeams: new Team().getReadPermissions().includes(role),
      }).toEqual({ role, readsTeams: true });
    }

    expect(new TeamMember().getReadPermissions()).toContain(
      Permission.ProjectUser,
    );
  });

  test.each(TRANSLATIONS)(
    "the %s upgrade guide carries the note in the English note's place",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, NOTE_LEAD),
      );

      expect([language, note.startsWith("- **")]).toEqual([language, true]);
      expect([language, inlineCode(note).includes(ROUTE)]).toEqual([
        language,
        true,
      ]);
    },
  );
});
