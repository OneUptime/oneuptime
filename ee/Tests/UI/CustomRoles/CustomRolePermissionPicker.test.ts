import { describe, expect, test } from "@jest/globals";
import {
  CUSTOM_ROLE_PERMISSION_DIALOG_WORDS,
  CustomRolePermissionPickerType,
  getCustomRolePermissionPickerType,
  SINGLE_PERMISSION_FIELD_DESCRIPTION,
} from "../../../Dashboard/CustomRoles/CustomRolePermissionPicker";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE TWO PICKERS OF A CUSTOM ROLE'S PERMISSIONS CARD
 * (Dashboard/src/Components/CustomRole/CustomRolePermissionPicker).
 *
 * Add Role opens the role picker (the whole project or one area, then a
 * level), Add Permission the full list of permissions. Found in the UI
 * review:
 *
 *   - both dialogs were called "Add New Permission", with an "Add
 *     Permission" button, even behind Add Role;
 *   - Edit opened whichever picker was opened last, so editing a single
 *     permission ("Read Telemetry Service Log") showed the role cards with
 *     nothing picked;
 *   - Add Permission's help was the API's: "A built-in role, such as
 *     IncidentMember, or a single permission, such as ReadProjectIncident".
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

// A code name such as IncidentMember: a capital, lower case, a capital.
const CAMEL_CASE_WORD: RegExp = /[A-Z][a-z]+[A-Z]/;

describe("the picker a row is edited with", () => {
  test("is the role picker for every built-in role", () => {
    const roles: Array<PermissionProps> =
      PermissionHelper.getRolePermissionProps();

    expect(roles.length).toBeGreaterThan(30);

    for (const role of roles) {
      expect(getCustomRolePermissionPickerType(role.permission)).toBe(
        CustomRolePermissionPickerType.Role,
      );
    }
  });

  test("is the full list for a single permission", () => {
    for (const permission of [
      Permission.ReadTelemetryServiceLog,
      Permission.ReadProjectIncident,
      Permission.CreateProjectMonitor,
    ]) {
      expect(getCustomRolePermissionPickerType(permission)).toBe(
        CustomRolePermissionPickerType.SinglePermission,
      );
    }
  });

  test("is the full list for anything it does not know, which no role picker could show as picked", () => {
    for (const value of [undefined, null, "", "NotAPermission"]) {
      expect(getCustomRolePermissionPickerType(value)).toBe(
        CustomRolePermissionPickerType.SinglePermission,
      );
    }
  });
});

describe("what each Add dialog is called", () => {
  test("Add Role adds a role, to the role named in its title", () => {
    const words: (typeof CUSTOM_ROLE_PERMISSION_DIALOG_WORDS)[CustomRolePermissionPickerType.Role] =
      CUSTOM_ROLE_PERMISSION_DIALOG_WORDS[CustomRolePermissionPickerType.Role];

    expect(
      ENGLISH.translateTemplate(words.titleWithRole, {
        role: "Incident Responder",
      }),
    ).toBe("Add a Role to Incident Responder");
    expect(words.title).toBe("Add a Role");
    expect(words.submitButtonText).toBe("Add Role");
  });

  test("Add Permission adds a single permission", () => {
    const words: (typeof CUSTOM_ROLE_PERMISSION_DIALOG_WORDS)[CustomRolePermissionPickerType.SinglePermission] =
      CUSTOM_ROLE_PERMISSION_DIALOG_WORDS[
        CustomRolePermissionPickerType.SinglePermission
      ];

    expect(
      ENGLISH.translateTemplate(words.titleWithRole, {
        role: "Incident Responder",
      }),
    ).toBe("Add a Permission to Incident Responder");
    expect(words.title).toBe("Add a Permission");
    expect(words.submitButtonText).toBe("Add Permission");
  });

  test("a role's name is put in as typed, never looked up", () => {
    // A reader whose language words the sentence and also has a word for the name.
    const german: Translator = createTranslator(
      (text: string | undefined): string | undefined => {
        if (text === "Add a Role to {{role}}") {
          return "Eine Rolle zu {{role}} hinzufügen";
        }

        if (text === "Incident Responder") {
          return "Vorfallbearbeiter";
        }

        return text;
      },
      "de",
    );

    expect(
      german.translateTemplate(
        CUSTOM_ROLE_PERMISSION_DIALOG_WORDS[CustomRolePermissionPickerType.Role]
          .titleWithRole,
        { role: "Incident Responder" },
      ),
    ).toBe("Eine Rolle zu Incident Responder hinzufügen");
  });
});

describe("the help under a single permission's picker", () => {
  test("says what it is for in the Dashboard's words, not the API's", () => {
    expect(SINGLE_PERMISSION_FIELD_DESCRIPTION).toBe(
      "A single permission, for exactly what the role needs.",
    );

    // No permission's code name ("IncidentMember"), as the API's had.
    expect(SINGLE_PERMISSION_FIELD_DESCRIPTION).not.toMatch(CAMEL_CASE_WORD);
    expect(
      PermissionHelper.getAllPermissionProps().some(
        (props: PermissionProps): boolean => {
          return SINGLE_PERMISSION_FIELD_DESCRIPTION.includes(
            ` ${props.permission} `,
          );
        },
      ),
    ).toBe(false);
  });
});
