import { describe, expect, test } from "@jest/globals";
import {
  addPermissionsToCustomRole,
  buildCustomRolePermission,
  CUSTOM_ROLE_DESCRIPTION_FIELD_DESCRIPTION,
  CUSTOM_ROLE_NAME_FIELD_DESCRIPTION,
  CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION,
  CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION_SOME_LEFT_OUT,
  CUSTOM_ROLE_PERMISSIONS_FIELD_KEY,
  getCustomRoleCreateFormFields,
  getCustomRoleEditFormFields,
  getCustomRoleStartingRoleOptions,
  getPermissionNotAddedReason,
  getPickedRolePermissions,
  PermissionNotAdded,
} from "../../../Dashboard/CustomRoles/CustomRoleCreateForm";
import { getRoleCardSelectOptions } from "@oneuptime/dashboard/Components/Permission/RoleCardSelectOptions";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CUSTOM_ROLE_NAME_MAX_LENGTH } from "Common/Types/Team/CustomRole";
import { CardSelectOptionGroup } from "Common/UI/Components/CardSelect/CardSelect";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ADVANCED_FORM_SECTION_ID } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE CUSTOM ROLE (Dashboard/src/Components/CustomRole/CustomRoleCreateForm).
 *
 * The customer's words: "group a couple of permissions I like into some role
 * like 'Incident responder', 'Team Lead'". So the form asks a name and the
 * built-in roles the new role bundles - Incident Member, Alert Member - and
 * folds the description away. The picks are not sent with the role: once it
 * exists each one is added through the endpoint the role's own Permissions
 * card uses, so the server weighs each as it weighs any other.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000001",
);
const ROLE_ID: ObjectID = new ObjectID("0c000000-0000-4000-8000-000000000002");

interface CreateCall {
  model: CustomRolePermission;
  modelType: unknown;
}

function fieldKey(field: ModelField<CustomRole>): string {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || {})[0] ||
    ""
  ).toString();
}

function optionValues(groups: Array<DropdownOptionGroup>): Array<string> {
  return groups.flatMap((group: DropdownOptionGroup): Array<string> => {
    return group.options.map((option: DropdownOption): string => {
      return String(option.value);
    });
  });
}

describe("the Create Custom Role form", () => {
  const fields: Array<ModelField<CustomRole>> = getCustomRoleCreateFormFields();

  test("asks the name and the roles it bundles; the description is folded", () => {
    expect(fields.map(fieldKey)).toEqual([
      "name",
      CUSTOM_ROLE_PERMISSIONS_FIELD_KEY,
      "description",
    ]);
    expect(fields[0]!.collapsibleSection).toBeUndefined();
    expect(fields[1]!.collapsibleSection).toBeUndefined();
    expect(fields[2]!.collapsibleSection?.id).toBe(ADVANCED_FORM_SECTION_ID);
    // Three rows: no steps.
    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("the name is required, and no longer than a role's name may be", () => {
    const name: ModelField<CustomRole> = fields[0]!;

    expect(name.title).toBe("Name");
    expect(name.required).toBe(true);
    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.placeholder).toBe("Incident Responder");
    expect(name.validation?.maxLength).toBe(CUSTOM_ROLE_NAME_MAX_LENGTH);
    expect(CUSTOM_ROLE_NAME_MAX_LENGTH).toBe(100);
  });

  test("Permissions is optional, never sent with the role, and says what a pick gives", () => {
    const permissions: ModelField<CustomRole> = fields[1]!;

    expect(permissions.title).toBe("Permissions");
    expect(permissions.required).toBe(false);
    expect(permissions.formOnly).toBe(true);
    expect(permissions.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(permissions.description).toBe(
      CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION,
    );
    expect(CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION).toBe(
      "The built-in roles it bundles, for every resource in the project. Add single permissions on the role's page.",
    );
    expect(new CustomRole().hasColumn(CUSTOM_ROLE_PERMISSIONS_FIELD_KEY)).toBe(
      false,
    );
    expect(permissions.dataTestId).toBe("custom-role-starting-permissions");
  });

  test("a new set of fields each time, so one form cannot change another's", () => {
    const again: Array<ModelField<CustomRole>> =
      getCustomRoleCreateFormFields();

    expect(again).not.toBe(fields);
    expect(again[1]).not.toBe(fields[1]);
  });

  /*
   * Left without help of its own, a form shows the column's API description
   * - English only, written for the API ("Friendly globally unique name for
   * your object").
   */
  test("the name and the description say what they are for, in the Dashboard's words", () => {
    expect(fields[0]!.description).toBe(CUSTOM_ROLE_NAME_FIELD_DESCRIPTION);
    expect(CUSTOM_ROLE_NAME_FIELD_DESCRIPTION).toBe(
      "Shown on every team you give the role to.",
    );
    expect(fields[2]!.description).toBe(
      CUSTOM_ROLE_DESCRIPTION_FIELD_DESCRIPTION,
    );
    expect(CUSTOM_ROLE_DESCRIPTION_FIELD_DESCRIPTION).toBe(
      "What the role is for, in a sentence or two.",
    );
  });
});

describe("Edit on a role's page", () => {
  const editFields: Array<ModelField<CustomRole>> =
    getCustomRoleEditFormFields();
  const createFields: Array<ModelField<CustomRole>> =
    getCustomRoleCreateFormFields();

  test("asks the name and the description, with Create's help, nothing folded", () => {
    expect(editFields.map(fieldKey)).toEqual(["name", "description"]);

    for (const field of editFields) {
      expect(field.collapsibleSection).toBeUndefined();
      expect(field.stepId).toBeUndefined();
    }

    expect(editFields[0]!.description).toBe(createFields[0]!.description);
    expect(editFields[1]!.description).toBe(createFields[2]!.description);
  });

  test("holds the name to the same rules as Create", () => {
    const name: ModelField<CustomRole> = editFields[0]!;

    expect(name.title).toBe("Name");
    expect(name.required).toBe(true);
    expect(name.validation).toEqual(createFields[0]!.validation);
    expect(name.placeholder).toBe(createFields[0]!.placeholder);
  });
});

describe("the roles offered to someone who can't give every one", () => {
  // Someone who holds Incident Member and Alert Member, and nothing wider.
  const canGrant: (permission: Permission) => boolean = (
    permission: Permission,
  ): boolean => {
    return [Permission.IncidentMember, Permission.AlertMember].includes(
      permission,
    );
  };

  test("are only the roles they could put into a role, in Add Role's order", () => {
    const groups: Array<DropdownOptionGroup> =
      getCustomRoleStartingRoleOptions(canGrant);

    expect(optionValues(groups)).toEqual([
      Permission.IncidentMember,
      Permission.AlertMember,
    ]);
    // A group with nothing left in it is left out, heading and all.
    expect(
      groups.map((group: DropdownOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(["Incidents", "Alerts"]);
  });

  test("and the field says why the list is shorter than Add Role's", () => {
    const permissions: ModelField<CustomRole> = getCustomRoleCreateFormFields({
      canGrant: canGrant,
    })[1]!;

    expect(permissions.title).toBe("Permissions");
    expect(
      optionValues(permissions.dropdownOptions as Array<DropdownOptionGroup>),
    ).toEqual([Permission.IncidentMember, Permission.AlertMember]);
    expect(permissions.description).toBe(
      CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION_SOME_LEFT_OUT,
    );
    expect(CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION_SOME_LEFT_OUT).toBe(
      "The built-in roles it bundles, for every resource in the project. Roles you don't hold yourself are not listed.",
    );
  });

  test("someone who may give every role sees every role but Project Owner, and the usual help", () => {
    const permissions: ModelField<CustomRole> = getCustomRoleCreateFormFields({
      canGrant: (): boolean => {
        return true;
      },
    })[1]!;

    expect(
      optionValues(permissions.dropdownOptions as Array<DropdownOptionGroup>),
    ).toHaveLength(39);
    expect(permissions.description).toBe(
      CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION,
    );
  });

  test("someone who could give none is not asked: the role starts empty", () => {
    const fields: Array<ModelField<CustomRole>> = getCustomRoleCreateFormFields(
      {
        canGrant: (): boolean => {
          return false;
        },
      },
    );

    expect(fields.map(fieldKey)).toEqual(["name", "description"]);
  });

  test("Project Owner is never asked about: no role holds it", () => {
    const asked: Array<Permission> = [];

    getCustomRoleStartingRoleOptions((permission: Permission): boolean => {
      asked.push(permission);
      return true;
    });

    expect(asked).not.toContain(Permission.ProjectOwner);
    expect(asked).toHaveLength(39);
  });
});

describe("the roles a new custom role can start with", () => {
  const groups: Array<DropdownOptionGroup> = getCustomRoleStartingRoleOptions();

  test("are the role list's entries, in its groups and order - the whole project, then each area - without Project Owner", () => {
    const cards: Array<CardSelectOptionGroup> = getRoleCardSelectOptions({
      excludeRoles: [Permission.ProjectOwner],
    });

    expect(
      groups.map((group: DropdownOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(
      cards.map((group: CardSelectOptionGroup): string => {
        return group.label;
      }),
    );
    expect(optionValues(groups)).not.toContain(Permission.ProjectOwner);
    expect(optionValues(groups)).toContain(Permission.ProjectAdmin);
    expect(optionValues(groups)).toContain(Permission.IncidentMember);
    expect(optionValues(groups)).toHaveLength(39);

    // Searched by an area's name, the dropdown finds that area's three roles.
    expect(groups[0]!.label).toBe("Whole project");
    expect(groups[1]!.label).toBe("Incidents");
    expect(
      groups[1]!.options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
    ]);
  });

  test("keep each role's title and what it can do", () => {
    const incidentMember: DropdownOption | undefined = groups
      .flatMap((group: DropdownOptionGroup): Array<DropdownOption> => {
        return group.options;
      })
      .find((option: DropdownOption): boolean => {
        return option.value === Permission.IncidentMember;
      });

    expect(incidentMember?.label).toBe("Incident Member");
    expect(incidentMember?.description).toBeTruthy();
  });

  test("are the Permissions field's options", () => {
    expect(getCustomRoleCreateFormFields()[1]!.dropdownOptions).toEqual(groups);
  });
});

describe("what a submitted Permissions value asks for", () => {
  test("each role once, in the order picked, from values or picker options", () => {
    expect(
      getPickedRolePermissions([
        Permission.IncidentMember,
        { value: Permission.AlertMember, label: "Alert Member" },
        Permission.IncidentMember,
        { value: Permission.AlertMember, label: "Alert Member" },
      ]),
    ).toEqual([Permission.IncidentMember, Permission.AlertMember]);
  });

  test("a single pick is a list of one", () => {
    expect(getPickedRolePermissions(Permission.Viewer)).toEqual([
      Permission.Viewer,
    ]);
  });

  test("nothing picked is nothing", () => {
    for (const value of [undefined, null, "", []]) {
      expect(getPickedRolePermissions(value)).toEqual([]);
    }
  });

  test("leaves out Project Owner and anything that is not a permission", () => {
    expect(
      getPickedRolePermissions([
        Permission.ProjectOwner,
        { value: Permission.ProjectOwner },
        "NotAPermission",
        42,
        null,
        { label: "Alert Member" },
        [Permission.AlertMember],
        Permission.OnCallViewer,
      ]),
    ).toEqual([Permission.OnCallViewer]);
  });
});

describe("a pick, once the role exists", () => {
  test("becomes a permission of the role for every resource in the project", () => {
    const row: CustomRolePermission = buildCustomRolePermission({
      customRoleId: ROLE_ID,
      projectId: PROJECT_ID,
      permission: Permission.IncidentMember,
    });

    expect(row).toBeInstanceOf(CustomRolePermission);
    expect(row.customRoleId?.toString()).toBe(ROLE_ID.toString());
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.permission).toBe(Permission.IncidentMember);
    expect(row.scope).toBe(PermissionScope.All);
    expect(row.labels).toBeUndefined();
    expect(row.getCrudApiPath()?.toString()).toBe("/custom-role-permission");
  });

  test("each is added on its own, in order, through the role's permission endpoint", async () => {
    const created: Array<CreateCall> = [];
    const modelAPI: typeof ModelAPI = {
      create: async (data: CreateCall): Promise<unknown> => {
        created.push(data);
        return { data: {} };
      },
    } as unknown as typeof ModelAPI;

    const notAdded: Array<PermissionNotAdded> =
      await addPermissionsToCustomRole({
        customRoleId: ROLE_ID,
        projectId: PROJECT_ID,
        permissions: [Permission.IncidentMember, Permission.AlertMember],
        modelAPI: modelAPI,
      });

    expect(notAdded).toEqual([]);
    expect(
      created.map((call: CreateCall): string => {
        return String(call.model.permission);
      }),
    ).toEqual([Permission.IncidentMember, Permission.AlertMember]);
    for (const call of created) {
      expect(call.modelType).toBe(CustomRolePermission);
      expect(call.model.scope).toBe(PermissionScope.All);
      expect(call.model.customRoleId?.toString()).toBe(ROLE_ID.toString());
    }
  });

  test("one the server refuses does not stop the others, and comes back in the server's words", async () => {
    const refusal: string =
      "You cannot grant Alert Member because your own access does not include that permission at an equal or broader scope.";
    const created: Array<string> = [];
    const modelAPI: typeof ModelAPI = {
      create: async (data: CreateCall): Promise<unknown> => {
        if (data.model.permission === Permission.AlertMember) {
          throw new Error(refusal);
        }

        created.push(String(data.model.permission));
        return { data: {} };
      },
    } as unknown as typeof ModelAPI;

    const notAdded: Array<PermissionNotAdded> =
      await addPermissionsToCustomRole({
        customRoleId: ROLE_ID,
        projectId: PROJECT_ID,
        permissions: [
          Permission.IncidentMember,
          Permission.AlertMember,
          Permission.OnCallViewer,
        ],
        modelAPI: modelAPI,
      });

    expect(created).toEqual([
      Permission.IncidentMember,
      Permission.OnCallViewer,
    ]);
    expect(notAdded).toEqual([
      { permission: Permission.AlertMember, error: refusal },
    ]);
  });

  test("nothing picked sends nothing", async () => {
    let calls: number = 0;
    const modelAPI: typeof ModelAPI = {
      create: async (): Promise<unknown> => {
        calls++;
        return { data: {} };
      },
    } as unknown as typeof ModelAPI;

    expect(
      await addPermissionsToCustomRole({
        customRoleId: ROLE_ID,
        projectId: PROJECT_ID,
        permissions: [],
        modelAPI: modelAPI,
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("why a pick is missing, as the notice says it", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("the server's refusal, which names the role itself, is said once", () => {
    const refusal: string =
      "You cannot grant Alert Member because your own access does not include that permission at an equal or broader scope.";

    expect(
      getPermissionNotAddedReason(english, {
        permission: Permission.AlertMember,
        error: refusal,
      }),
    ).toBe(refusal);
  });

  test("any other failure is told apart by the role's name", () => {
    expect(
      getPermissionNotAddedReason(english, {
        permission: Permission.AlertMember,
        error: "Network error.",
      }),
    ).toBe("Alert Member: Network error.");
  });

  test("the name is in the reader's language when the failure doesn't name it", () => {
    const german: Translator = createTranslator(
      (text: string | undefined): string | undefined => {
        return text === "Alert Member" ? "Alarmmitglied" : text;
      },
      "de",
    );

    expect(
      getPermissionNotAddedReason(german, {
        permission: Permission.AlertMember,
        error: "Netzwerkfehler.",
      }),
    ).toBe("Alarmmitglied: Netzwerkfehler.");
  });
});
