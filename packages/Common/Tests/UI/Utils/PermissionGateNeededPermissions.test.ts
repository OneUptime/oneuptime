import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a lock says it would take, in as few names as tell the reader what to
 * ask for (#5262's follow-up: "a locked owner kind's reason repeats
 * PermissionGate's whole permission list - shorten that wording
 * product-wide").
 *
 * A model's list of what may do an operation names the built-in roles that
 * may (Project Owner, Project Admin, Project Member, Incident Admin, Incident
 * Member) and, in all but a few lists, one permission of its own (Create
 * Incident Team Owner). Every lock used to recite the whole list. A lock now
 * names the list's own permissions, and the roles only when the list has
 * nothing else to name - in one shared sentence (getNeededPermissionsSentence)
 * that every lock the gate words ends with.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import i18next from "i18next";
import PermissionGate, {
  ModelAction,
  NEEDS_ONE_OF_PERMISSIONS_TEMPLATE,
  NEEDS_ONE_OF_ROLES_TEMPLATE,
  NEEDS_PERMISSION_TEMPLATE,
  NEEDS_ROLE_TEMPLATE,
  PermissionCheckableModel,
  PermissionGateResult,
  PermissionsToName,
} from "../../../UI/Utils/PermissionGate";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import { WORKFLOW_RUN_PERMISSIONS } from "../../../Types/Workflow/WorkflowRunPermissions";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

type Locale = Record<string, string>;

const readLocale: (code: string) => Locale = (code: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${code}.json`), "utf-8"),
  ) as Locale;
};

// A model whose only list is the one an operation is gated on.
const modelWith: (data: {
  singularName: string;
  permissions: Array<Permission>;
}) => PermissionCheckableModel = (data: {
  singularName: string;
  permissions: Array<Permission>;
}): PermissionCheckableModel => {
  const list: () => Array<Permission> = (): Array<Permission> => {
    return data.permissions;
  };
  const no: () => boolean = (): boolean => {
    return false;
  };

  return {
    singularName: data.singularName,
    hasCreatePermissions: no,
    hasReadPermissions: no,
    hasUpdatePermissions: no,
    hasDeletePermissions: no,
    getCreatePermissions: list,
    getReadPermissions: list,
    getUpdatePermissions: list,
    getDeletePermissions: list,
  };
};

const ROLE_TITLES: Array<string> = PermissionHelper.getRolePermissionProps().map(
  (props: PermissionProps): string => {
    return props.title;
  },
);

const isRoleTitle: (title: string) => boolean = (title: string): boolean => {
  return ROLE_TITLES.includes(title);
};

beforeEach(() => {
  permissionsForTest = [Permission.Viewer];
  PermissionGate.clearPermissionPropsCache();
});

describe("what a lock names (getPermissionsToName)", () => {
  test("roles and one permission of its own: the permission alone", () => {
    const list: Array<Permission> = new IncidentOwnerTeam().getCreatePermissions();

    // The list as the model writes it: five roles before the permission.
    expect(PermissionGate.getPermissionTitles(list)).toEqual([
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Incident Admin",
      "Incident Member",
      "Create Incident Team Owner",
    ]);

    expect(PermissionGate.getPermissionsToName(list)).toEqual({
      titles: ["Create Incident Team Owner"],
      areRoles: false,
    } as PermissionsToName);
  });

  test("two permissions of its own: both, in the list's order, and no role", () => {
    const list: Array<Permission> = new Project().getUpdatePermissions();

    expect(PermissionGate.getPermissionTitles(list)).toEqual([
      "Project Owner",
      "Project Admin",
      "Billing Admin",
      "Billing Member",
      "Manage Billing",
      "Edit Project",
    ]);
    expect(PermissionGate.getPermissionsToName(list)).toEqual({
      titles: ["Manage Billing", "Edit Project"],
      areRoles: false,
    });
  });

  test("roles only: the roles, as they are all there is to ask for", () => {
    expect(
      PermissionGate.getPermissionsToName(
        new ExternalMcpServer().getCreatePermissions(),
      ),
    ).toEqual({ titles: ["Project Owner", "Project Admin"], areRoles: true });
    expect(
      PermissionGate.getPermissionsToName(
        new ProjectSCIM().getCreatePermissions(),
      ),
    ).toEqual({ titles: ["Project Owner"], areRoles: true });
  });

  test("Public and Logged in User are never what to ask for: a role beside them is named instead", () => {
    expect(
      PermissionGate.getPermissionsToName([
        Permission.Public,
        Permission.ProjectOwner,
      ]),
    ).toEqual({ titles: ["Project Owner"], areRoles: true });
    expect(
      PermissionGate.getPermissionsToName([
        Permission.CurrentUser,
        Permission.EditProject,
      ]),
    ).toEqual({ titles: ["Edit Project"], areRoles: false });
  });

  test("a list of nothing a team can be given still names what it has, as before", () => {
    expect(
      PermissionGate.getPermissionsToName([
        Permission.CurrentUser,
        Permission.Public,
      ]),
    ).toEqual({ titles: ["Logged in User", "Public"], areRoles: false });
  });

  test("a permission it does not know is skipped, never a reason to name nothing", () => {
    expect(
      PermissionGate.getPermissionsToName([
        "NotAPermissionAnyMore" as Permission,
        Permission.ProjectAdmin,
        Permission.EditProject,
      ]),
    ).toEqual({ titles: ["Edit Project"], areRoles: false });
    expect(PermissionGate.getPermissionsToName([])).toEqual({
      titles: [],
      areRoles: false,
    });
  });
});

describe("the sentence every lock ends with (getNeededPermissionsSentence)", () => {
  test("one permission", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new IncidentOwnerTeam().getCreatePermissions(),
      ),
    ).toBe("You need this permission: Create Incident Team Owner.");
  });

  test("several permissions", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new Project().getUpdatePermissions(),
      ),
    ).toBe("You need one of these permissions: Manage Billing, Edit Project.");
  });

  test("one role, and several", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new ProjectSCIM().getCreatePermissions(),
      ),
    ).toBe("You need this role: Project Owner.");
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new ExternalMcpServer().getCreatePermissions(),
      ),
    ).toBe("You need one of these roles: Project Owner, Project Admin.");
  });

  test("nothing to name, nothing said", () => {
    expect(PermissionGate.getNeededPermissionsSentence([])).toBe("");
    expect(
      PermissionGate.getNeededPermissionsSentence([
        "NotAPermissionAnyMore" as Permission,
      ]),
    ).toBe("");
  });

  test("the four templates are the sentence's own keys", () => {
    expect(NEEDS_PERMISSION_TEMPLATE).toBe(
      "You need this permission: {{permission}}.",
    );
    expect(NEEDS_ONE_OF_PERMISSIONS_TEMPLATE).toBe(
      "You need one of these permissions: {{permissions}}.",
    );
    expect(NEEDS_ROLE_TEMPLATE).toBe("You need this role: {{role}}.");
    expect(NEEDS_ONE_OF_ROLES_TEMPLATE).toBe(
      "You need one of these roles: {{roles}}.",
    );
  });
});

describe("the locks the gate words end with it", () => {
  test("the Add owners list's locked Teams: the permission, not the five roles before it", () => {
    const gate: PermissionGateResult = PermissionGate.check(
      new IncidentOwnerTeam(),
      ModelAction.Create,
      { sentence: "You do not have permission to add teams as owners." },
    );

    expect(gate).toEqual({
      isAllowed: false,
      disabledReason:
        "You do not have permission to add teams as owners. You need this permission: Create Incident Team Owner.",
    });
  });

  test("a model's own words, when the operation takes a role alone", () => {
    expect(
      PermissionGate.check(new ExternalMcpServer(), ModelAction.Create)
        .disabledReason,
    ).toBe(
      "You do not have permission to create this External MCP Server. You need one of these roles: Project Owner, Project Admin.",
    );
  });

  test("a hand-picked list (checkPermissions) is named the same way", () => {
    expect(
      PermissionGate.checkPermissions([...WORKFLOW_RUN_PERMISSIONS], {
        sentence: "Running this workflow takes permission to run it.",
      }).disabledReason,
    ).toBe(
      "Running this workflow takes permission to run it. You need this permission: Edit Workflow.",
    );
  });

  test("a team's block still says what it blocks, and nothing else", () => {
    const held: HeldPermissions = {
      allowed: [Permission.ProjectMember],
      allowedProjectWide: [Permission.ProjectMember],
      blocked: [Permission.ProjectMember],
      blockedForSomeLabels: [],
    };

    expect(
      PermissionGate.check(new IncidentOwnerTeam(), ModelAction.Create, {
        held: held,
        sentence: "You do not have permission to add teams as owners.",
      }).disabledReason,
    ).toBe(
      "You do not have permission to add teams as owners. A team you are on blocks Project Member.",
    );
  });
});

describe("a gate of the caller's own (getRefusalReason)", () => {
  test("the caller's sentence, then what would allow it", () => {
    expect(
      PermissionGate.getRefusalReason({
        sentence: "You do not have permission to reset this webhook URL.",
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditWorkflow,
          Permission.WorkflowAdmin,
        ],
      }),
    ).toBe(
      "You do not have permission to reset this webhook URL. You need this permission: Edit Workflow.",
    );
  });

  test("a team's block, read from the snapshot handed in", () => {
    expect(
      PermissionGate.getRefusalReason({
        sentence: "You do not have permission to change these settings.",
        permissions: [Permission.ProjectOwner, Permission.ManageProjectBilling],
        options: {
          held: {
            allowed: [Permission.ManageProjectBilling],
            allowedProjectWide: [Permission.ManageProjectBilling],
            blocked: [Permission.ManageProjectBilling],
            blockedForSomeLabels: [],
          },
        },
      }),
    ).toBe(
      "You do not have permission to change these settings. A team you are on blocks Manage Billing.",
    );
  });

  test("with nothing to name, the sentence alone", () => {
    expect(
      PermissionGate.getRefusalReason({
        sentence: "You do not have permission to reset this email address.",
        permissions: [],
      }),
    ).toBe("You do not have permission to reset this email address.");
  });
});

/*
 * The rule held across the product: every database model's create, read,
 * update and delete list. A lock never names a built-in role beside a
 * permission of the list's own, and names every role only when the list
 * has nothing else.
 */
describe("every database model's lists", () => {
  interface ListCase {
    model: string;
    action: ModelAction;
    list: Array<Permission>;
  }

  const lists: Array<ListCase> = [];

  for (const ModelType of DatabaseModels) {
    const model: BaseModel = new ModelType();

    for (const action of [
      ModelAction.Create,
      ModelAction.Read,
      ModelAction.Update,
      ModelAction.Delete,
    ]) {
      const list: Array<Permission> = PermissionGate.getModelPermissions(
        model,
        action,
      );

      if (PermissionGate.getPermissionTitles(list).length > 0) {
        lists.push({ model: model.tableName || "", action, list });
      }
    }
  }

  test("there are lists to read, and most of them name roles beside a permission of their own", () => {
    const mixed: Array<ListCase> = lists.filter((item: ListCase): boolean => {
      const titles: Array<string> = PermissionGate.getPermissionTitles(
        item.list,
      );

      return titles.some(isRoleTitle) && !titles.every(isRoleTitle);
    });

    expect(lists.length).toBeGreaterThan(1000);
    // The lists the old wording recited in full, roles first.
    expect(mixed.length).toBeGreaterThan(1000);
  });

  test("a list with a permission of its own names no role", () => {
    const offending: Array<string> = [];

    for (const item of lists) {
      const named: PermissionsToName = PermissionGate.getPermissionsToName(
        item.list,
      );

      if (!named.areRoles && named.titles.some(isRoleTitle)) {
        offending.push(`${item.model} ${item.action}: ${named.titles}`);
      }
    }

    expect(offending).toEqual([]);
  });

  test("a list of roles alone names every one of them, and only them", () => {
    for (const item of lists.filter((entry: ListCase): boolean => {
      return PermissionGate.getPermissionsToName(entry.list).areRoles;
    })) {
      const titles: Array<string> = PermissionGate.getPermissionTitles(
        item.list,
      ).filter(isRoleTitle);

      expect({
        model: item.model,
        action: item.action,
        named: PermissionGate.getPermissionsToName(item.list).titles,
      }).toEqual({ model: item.model, action: item.action, named: titles });
    }
  });

  test("what a lock names is always part of what the list allows, never more", () => {
    for (const item of lists) {
      const all: Array<string> = PermissionGate.getPermissionTitles(item.list);
      const named: Array<string> = PermissionGate.getPermissionsToName(
        item.list,
      ).titles;

      expect(named.length).toBeGreaterThan(0);

      for (const title of named) {
        expect(all).toContain(title);
      }
    }
  });
});

/*
 * Every Dashboard language words the four sentences, keeping the name's
 * place, and a German reader reads one German sentence: the role names
 * looked up as the role picker draws them, a permission's own title as
 * it is (the permission picker keeps them in English).
 */
describe("in the reader's language", () => {
  const LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];

  test.each(LANGUAGES)("%s translates the four sentences", (code: string) => {
    const locale: Locale = readLocale(code);

    for (const [template, placeholder] of [
      [NEEDS_PERMISSION_TEMPLATE, "{{permission}}"],
      [NEEDS_ONE_OF_PERMISSIONS_TEMPLATE, "{{permissions}}"],
      [NEEDS_ROLE_TEMPLATE, "{{role}}"],
      [NEEDS_ONE_OF_ROLES_TEMPLATE, "{{roles}}"],
    ] as Array<[string, string]>) {
      const value: string | undefined = locale[template];

      expect({ code, template, translated: Boolean(value) }).toEqual({
        code,
        template,
        translated: true,
      });
      expect(value).not.toBe(template);
      expect(value).toContain(placeholder);
    }
  });

  test("in German, from the Dashboard's own locale", async () => {
    const german: Locale = readLocale("de");

    await i18next.init({
      lng: "de",
      resources: { de: { translation: german } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    try {
      expect(
        PermissionGate.getNeededPermissionsSentence(
          new IncidentOwnerTeam().getCreatePermissions(),
        ),
      ).toBe("Sie benötigen diese Berechtigung: Create Incident Team Owner.");
      expect(
        PermissionGate.getNeededPermissionsSentence(
          new ExternalMcpServer().getCreatePermissions(),
        ),
      ).toBe(
        "Sie benötigen eine dieser Rollen: Projektinhaber, Projektadministrator.",
      );
      expect(
        PermissionGate.getNeededPermissionsSentence(
          new ProjectSCIM().getCreatePermissions(),
        ),
      ).toBe("Sie benötigen diese Rolle: Projektinhaber.");
      expect(
        PermissionGate.getRefusalReason({
          sentence: "You do not have permission to change these settings.",
          permissions: new Project().getUpdatePermissions(),
        }),
      ).toBe(
        "Sie haben keine Berechtigung, diese Einstellungen zu ändern. Sie benötigen eine dieser Berechtigungen: Manage Billing, Edit Project.",
      );
    } finally {
      await i18next.changeLanguage("en");
    }
  });
});
