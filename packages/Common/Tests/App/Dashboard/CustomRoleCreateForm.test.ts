import { describe, expect, test } from "@jest/globals";
import {
  addPermissionsToCustomRole,
  buildCustomRolePermission,
  CUSTOM_ROLE_PERMISSIONS_FIELD_DESCRIPTION,
  CUSTOM_ROLE_PERMISSIONS_FIELD_KEY,
  getCustomRoleCreateFormFields,
  getCustomRoleStartingRoleOptions,
  getPickedRolePermissions,
  PermissionNotAdded,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleCreateForm";
import { getRoleCardSelectOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CUSTOM_ROLE_NAME_MAX_LENGTH } from "../../../Types/Team/CustomRole";
import { CardSelectOptionGroup } from "../../../UI/Components/CardSelect/CardSelect";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "../../../UI/Components/Dropdown/Dropdown";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { ADVANCED_FORM_SECTION_ID } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

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
      "The built-in roles this role bundles, for every resource in the project. Add single permissions, or limit one to owned or labelled resources, on the role's page.",
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
});

describe("the roles a new custom role can start with", () => {
  const groups: Array<DropdownOptionGroup> = getCustomRoleStartingRoleOptions();

  test("are Add Role's cards, in its groups and order, without Project Owner", () => {
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
      "You cannot grant AlertMember because your own access does not include that permission at an equal or broader scope.";
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
