/**
 * @timezone America/New_York
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CREATE API KEY: what the form asks, what it starts with, and what Access
 * may offer (Dashboard/src/Components/ApiKey/ApiKeyCreateForm and
 * ApiKeyAccess):
 *
 *   - Name; Access (Project Admin, Project Member, Viewer, Choose
 *     permissions later - picked); and folded under Advanced the
 *     description and Expires, a year from today;
 *   - Access offers only the roles the user may hand on, and is left out
 *     for someone who may not give a key permissions or may give none;
 *   - a role becomes one allow row for the whole project, created through
 *     the API key permission endpoint.
 *
 * The timezone is pinned so "a year from today, at the start of that day"
 * is a fixed instant to compare with.
 */

let isMasterAdminForTest: boolean = false;
let projectPermissionsForTest: unknown = null;
let allPermissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
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
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import {
  API_KEY_ACCESS_FIELD_KEY,
  API_KEY_ACCESS_LATER,
  API_KEY_ACCESS_LATER_OPTION,
  API_KEY_ACCESS_ROLES,
  getApiKeyAccessOptions,
  getApiKeyAccessOptionsForCurrentUser,
  getApiKeyAccessRole,
  giveApiKeyAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyAccess";
import {
  getApiKeyCreateFormFields,
  getDefaultApiKeyExpiry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyCreateForm";
import { getRoleIcon } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import OneUptimeDate from "../../../Types/Date";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  ADVANCED_FORM_SECTION_ID,
  ADVANCED_FORM_SECTION_TITLE,
  isFormFieldValueSet,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000001",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000002",
);

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function values(options: Array<CardSelectOption>): Array<string> {
  return options.map((option: CardSelectOption): string => {
    return option.value;
  });
}

function keyOf(field: ModelField<ApiKey>): string {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || field.overrideField || {})[0] ||
    ""
  );
}

beforeEach(() => {
  isMasterAdminForTest = false;
  holding([]);
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the Access cards", () => {
  const anyRole: (permission: Permission) => boolean = (): boolean => {
    return true;
  };

  test("are Project Admin, Project Member and Viewer, then Choose permissions later", () => {
    const options: Array<CardSelectOption> = getApiKeyAccessOptions({
      canGrant: anyRole,
      canAddKeyPermissions: true,
    });

    expect(values(options)).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      API_KEY_ACCESS_LATER,
    ]);
    expect(
      options.map((option: CardSelectOption): string => {
        return option.title;
      }),
    ).toEqual([
      "Project Admin",
      "Project Member",
      "Viewer",
      "Choose permissions later",
    ]);
  });

  test("never offer Project Owner: that is added on the key's page, on purpose", () => {
    expect(API_KEY_ACCESS_ROLES).not.toContain(Permission.ProjectOwner);
  });

  test("say what the key can do, in plain words", () => {
    const options: Array<CardSelectOption> = getApiKeyAccessOptions({
      canGrant: anyRole,
      canAddKeyPermissions: true,
    });

    expect(options[0]!.description).toBe(
      "Create, change and delete anything in this project, its settings included. Cannot manage billing or delete the project.",
    );
    expect(options[1]!.description).toBe(
      "Create, change and delete monitors, incidents, status pages and other resources, as a project member can.",
    );
    expect(options[2]!.description).toBe(
      "Read everything in this project. Cannot create, change or delete anything.",
    );
    expect(options[3]!.description).toBe(
      "The key can do nothing until you add a role or permissions on its page. Pick a narrower role there, such as Incident Member.",
    );
  });

  test("show each role with the icon it has wherever roles are picked", () => {
    const options: Array<CardSelectOption> = getApiKeyAccessOptions({
      canGrant: anyRole,
      canAddKeyPermissions: true,
    });

    for (const option of options.slice(0, 3)) {
      expect(option.icon).toBe(getRoleIcon(option.value as Permission));
    }

    expect(API_KEY_ACCESS_LATER_OPTION.icon).toBe(IconProp.Clock);
  });

  test("offer only the roles the user may hand on", () => {
    expect(
      values(
        getApiKeyAccessOptions({
          canGrant: (permission: Permission): boolean => {
            return permission === Permission.ProjectAdmin;
          },
          canAddKeyPermissions: true,
        }),
      ),
    ).toEqual([Permission.ProjectAdmin, API_KEY_ACCESS_LATER]);
  });

  test("are not offered at all without the right to give a key permissions", () => {
    expect(
      getApiKeyAccessOptions({
        canGrant: anyRole,
        canAddKeyPermissions: false,
      }),
    ).toEqual([]);
  });

  test("are not offered when no role may be handed on: there is nothing to choose", () => {
    expect(
      getApiKeyAccessOptions({
        canGrant: (): boolean => {
          return false;
        },
        canAddKeyPermissions: true,
      }),
    ).toEqual([]);
  });
});

describe("the Access cards for the signed-in user", () => {
  test("a project owner gets every card", () => {
    holding([Permission.ProjectOwner]);

    expect(values(getApiKeyAccessOptionsForCurrentUser())).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      API_KEY_ACCESS_LATER,
    ]);
  });

  test("a project admin gets the role they hold, as the server would allow", () => {
    holding([Permission.ProjectAdmin]);

    expect(values(getApiKeyAccessOptionsForCurrentUser())).toEqual([
      Permission.ProjectAdmin,
      API_KEY_ACCESS_LATER,
    ]);
  });

  test("someone who may create keys but not give them permissions is not asked", () => {
    holding([Permission.CreateProjectApiKey, Permission.ReadProjectApiKey]);

    expect(getApiKeyAccessOptionsForCurrentUser()).toEqual([]);
  });

  test("a permission editor who holds no role is not asked either", () => {
    holding([
      Permission.EditProjectApiKeyPermissions,
      Permission.CreateProjectApiKey,
    ]);

    expect(getApiKeyAccessOptionsForCurrentUser()).toEqual([]);
  });

  test("a master admin gets every card", () => {
    isMasterAdminForTest = true;

    expect(values(getApiKeyAccessOptionsForCurrentUser())).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      API_KEY_ACCESS_LATER,
    ]);
  });
});

describe("what a submitted Access value asks for", () => {
  test("each role card asks for its role", () => {
    for (const role of API_KEY_ACCESS_ROLES) {
      expect(getApiKeyAccessRole(role)).toBe(role);
    }
  });

  test("Choose permissions later asks for nothing", () => {
    expect(getApiKeyAccessRole(API_KEY_ACCESS_LATER)).toBeNull();
  });

  test("anything the form never offered asks for nothing", () => {
    for (const value of [
      undefined,
      null,
      "",
      Permission.ProjectOwner,
      Permission.DeleteProject,
      ["ProjectAdmin"],
      { value: "ProjectAdmin" },
    ]) {
      expect(getApiKeyAccessRole(value)).toBeNull();
    }
  });
});

describe("giving a new key its access", () => {
  test("creates one allow row for the whole project, through the key permission endpoint", async () => {
    const created: Array<{ model: ApiKeyPermission; modelType: unknown }> = [];

    const modelAPI: typeof ModelAPI = {
      create: async (data: {
        model: ApiKeyPermission;
        modelType: unknown;
      }): Promise<unknown> => {
        created.push(data);
        return { data: {} };
      },
    } as unknown as typeof ModelAPI;

    await giveApiKeyAccess({
      apiKeyId: API_KEY_ID,
      projectId: PROJECT_ID,
      role: Permission.Viewer,
      modelAPI: modelAPI,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.modelType).toBe(ApiKeyPermission);

    const row: ApiKeyPermission = created[0]!.model;

    expect(row).toBeInstanceOf(ApiKeyPermission);
    expect(row.apiKeyId?.toString()).toBe(API_KEY_ID.toString());
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.permission).toBe(Permission.Viewer);
    expect(row.isBlockPermission).toBe(false);
    // No labels: the role reaches the whole project.
    expect(row.labels).toBeUndefined();
    expect(row.getCrudApiPath()?.toString()).toBe("/api-key-permission");
  });

  test("a refusal is the caller's to show", async () => {
    const modelAPI: typeof ModelAPI = {
      create: async (): Promise<never> => {
        throw new Error(
          "You cannot grant an API key permission beyond your own authority",
        );
      },
    } as unknown as typeof ModelAPI;

    await expect(
      giveApiKeyAccess({
        apiKeyId: API_KEY_ID,
        projectId: PROJECT_ID,
        role: Permission.ProjectAdmin,
        modelAPI: modelAPI,
      }),
    ).rejects.toThrow(
      "You cannot grant an API key permission beyond your own authority",
    );
  });
});

describe("the date a new key expires on", () => {
  test("is a year from today, at the start of that day in the user's timezone", () => {
    const now: Date = new Date("2026-10-03T15:45:00.000Z");

    // 2027-10-03 00:00 in New York (EDT, UTC-4).
    expect(getDefaultApiKeyExpiry(now).toISOString()).toBe(
      "2027-10-03T04:00:00.000Z",
    );
  });

  test("is the day the user is on, not the day UTC is on", () => {
    // 02:00 UTC on the 4th is still the 3rd in New York.
    const now: Date = new Date("2026-10-04T02:00:00.000Z");

    expect(
      OneUptimeDate.asDateForDatabaseQuery(getDefaultApiKeyExpiry(now)),
    ).toBe("2027-10-03");
  });

  test("is what picking that date in the date picker stores", () => {
    const now: Date = new Date("2026-10-03T15:45:00.000Z");

    expect(getDefaultApiKeyExpiry(now).getTime()).toBe(
      OneUptimeDate.fromDateTimeLocalString("2027-10-03").getTime(),
    );
  });

  test("stays the same all day, so an untouched date never reads as changed", () => {
    expect(
      getDefaultApiKeyExpiry(new Date("2026-10-03T04:30:00.000Z")).getTime(),
    ).toBe(
      getDefaultApiKeyExpiry(new Date("2026-10-04T03:30:00.000Z")).getTime(),
    );
  });

  test("a leap day rolls to the last day of February", () => {
    expect(
      OneUptimeDate.asDateForDatabaseQuery(
        getDefaultApiKeyExpiry(new Date("2028-02-29T15:00:00.000Z")),
      ),
    ).toBe("2029-02-28");
  });

  test("is in the future, as the form requires", () => {
    expect(OneUptimeDate.isInThePast(getDefaultApiKeyExpiry())).toBe(false);
  });
});

describe("the Create API Key form", () => {
  const accessOptions: Array<CardSelectOption> = getApiKeyAccessOptions({
    canGrant: (): boolean => {
      return true;
    },
    canAddKeyPermissions: true,
  });

  test("asks Name, Access, then the description and Expires", () => {
    const fields: Array<ModelField<ApiKey>> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    });

    expect(fields.map(keyOf)).toEqual([
      "name",
      API_KEY_ACCESS_FIELD_KEY,
      "description",
      "expiresAt",
    ]);
    expect(
      fields.map((field: ModelField<ApiKey>): string | undefined => {
        return field.title;
      }),
    ).toEqual(["Name", "Access", "Description", "Expires"]);
  });

  test("folds the description and Expires into one Advanced section, and nothing else", () => {
    const fields: Array<ModelField<ApiKey>> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    });

    expect(fields[0]!.collapsibleSection).toBeUndefined();
    expect(fields[1]!.collapsibleSection).toBeUndefined();

    const section: unknown = fields[2]!.collapsibleSection;

    expect(section).toBeDefined();
    expect(fields[3]!.collapsibleSection).toBe(section);
    expect(fields[2]!.collapsibleSection!.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(fields[2]!.collapsibleSection!.title).toBe(
      ADVANCED_FORM_SECTION_TITLE,
    );
    // Folded on create, saying "Configured" instead of opening.
    expect(fields[2]!.collapsibleSection!.openWhenConfigured).toBe(false);
  });

  test("has no steps to walk: three rows", () => {
    const fields: Array<ModelField<ApiKey>> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    });

    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("Access is a card for each choice, with Choose permissions later picked", () => {
    const access: ModelField<ApiKey> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    })[1]!;

    expect(access.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(access.cardSelectOptions).toBe(accessOptions);
    expect(access.cardSelectSingleColumn).toBe(true);
    expect(access.defaultValue).toBe(API_KEY_ACCESS_LATER);
    expect(access.required).toBe(true);
    expect(access.description).toBe(
      "What this key can do. You can change it on the key's page at any time.",
    );
  });

  test("Access is never sent with the key: it is not one of the key's columns", () => {
    const access: ModelField<ApiKey> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    })[1]!;

    expect(access.formOnly).toBe(true);
    expect(access.field).toBeUndefined();
    expect(access.overrideField).toEqual({ [API_KEY_ACCESS_FIELD_KEY]: true });
    expect(new ApiKey().hasColumn(API_KEY_ACCESS_FIELD_KEY)).toBe(false);
    // Shown although no column's permission covers it: the page decides.
    expect(access.showEvenIfPermissionDoesNotExist).toBe(true);
  });

  test("leaves Access out when there is nothing to choose", () => {
    const fields: Array<ModelField<ApiKey>> = getApiKeyCreateFormFields({
      accessOptions: [],
    });

    expect(fields.map(keyOf)).toEqual(["name", "description", "expiresAt"]);
  });

  test("Expires starts a year from today and must stay in the future", () => {
    const expires: ModelField<ApiKey> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    })[3]!;

    expect(expires.fieldType).toBe(FormFieldSchemaType.Date);
    expect(expires.required).toBe(true);
    expect(expires.validation?.dateShouldBeInTheFuture).toBe(true);
    expect(expires.getDefaultValue).toBeDefined();
    // Held as the date picker holds a picked date: its ISO string.
    expect(expires.getDefaultValue!({})).toBe(
      getDefaultApiKeyExpiry().toISOString(),
    );
    expect(expires.description).toBe(
      "The key stops working on this date. A year from today unless you pick another.",
    );
  });

  test("an untouched Expires does not make Advanced say Configured; another date does", () => {
    const expires: ModelField<ApiKey> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    })[3]!;

    expect(
      isFormFieldValueSet(expires, {
        expiresAt: expires.getDefaultValue!({}),
      } as never),
    ).toBe(false);

    // Picking the same day again stores exactly the same.
    const sameDayPicked: string = OneUptimeDate.toString(
      OneUptimeDate.fromDateTimeLocalString(
        OneUptimeDate.asDateForDatabaseQuery(getDefaultApiKeyExpiry()),
      ),
    );

    expect(
      isFormFieldValueSet(expires, {
        expiresAt: sameDayPicked,
      } as never),
    ).toBe(false);

    expect(
      isFormFieldValueSet(expires, {
        expiresAt: OneUptimeDate.toString(
          OneUptimeDate.fromDateTimeLocalString("2027-01-15"),
        ),
      } as never),
    ).toBe(true);
  });

  test("Name keeps what it asked before", () => {
    const name: ModelField<ApiKey> = getApiKeyCreateFormFields({
      accessOptions: accessOptions,
    })[0]!;

    expect(name.required).toBe(true);
    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.validation?.minLength).toBe(2);
    expect(name.placeholder).toBe("API Key Name");
  });
});
