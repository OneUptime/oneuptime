import { describe, expect, test } from "@jest/globals";
import {
  ROLE_ACCESS_FIELD_KEY,
  ROLE_ACCESS_LATER,
  RoleAccessHolder,
  getRoleAccessFormField,
  getRoleAccessOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess";
import {
  getNewTeamPage,
  getTeamCreateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamCreateForm";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Team from "../../../Models/DatabaseModels/Team";
import Permission from "../../../Types/Permission";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  ADVANCED_FORM_SECTION_ID,
  ADVANCED_FORM_SECTION_TITLE,
  isFormFieldValueSet,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * CREATE TEAM: what the form asks, what it starts with, and where a new team
 * opens (Dashboard/src/Components/Team/TeamCreateForm):
 *
 *   - Name; Access (Project Admin, Project Member, Viewer, Choose
 *     permissions later - picked), the question Create API Key asks; and,
 *     folded under Advanced, the description;
 *   - Access is left out for someone who may not add permissions to a team,
 *     or may hand on no role;
 *   - three rows, so no steps;
 *   - a team with a role opens on Members, one left for later on
 *     Permissions.
 */

const ACCESS_OPTIONS: Array<CardSelectOption> = getRoleAccessOptions({
  holder: RoleAccessHolder.Team,
  canGrant: (): boolean => {
    return true;
  },
  canAddPermissions: true,
});

function keyOf(field: ModelField<Team>): string {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || field.overrideField || {})[0] ||
    ""
  );
}

function fields(
  accessOptions: Array<CardSelectOption> = ACCESS_OPTIONS,
): Array<ModelField<Team>> {
  return getTeamCreateFormFields({ accessOptions: accessOptions });
}

describe("the Create Team form", () => {
  test("asks Name, Access, then the description", () => {
    expect(fields().map(keyOf)).toEqual([
      "name",
      ROLE_ACCESS_FIELD_KEY,
      "description",
    ]);
    expect(
      fields().map((field: ModelField<Team>): string | undefined => {
        return field.title;
      }),
    ).toEqual(["Name", "Access", "Description"]);
  });

  test("folds the description under Advanced, and nothing else", () => {
    const [name, access, description] = fields();

    expect(name!.collapsibleSection).toBeUndefined();
    expect(access!.collapsibleSection).toBeUndefined();

    expect(description!.collapsibleSection).toBeDefined();
    expect(description!.collapsibleSection!.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(description!.collapsibleSection!.title).toBe(
      ADVANCED_FORM_SECTION_TITLE,
    );
    // Folded on create; "Configured" says when something is typed in it.
    expect(description!.collapsibleSection!.openWhenConfigured).toBe(false);
    // The description is the user's own words: nothing to summarise.
    expect(description!.collapsibleSection!.getSummary).toBeUndefined();
  });

  test("the folded section says Configured once a description is typed", () => {
    const description: ModelField<Team> = fields()[2]!;

    expect(isFormFieldValueSet(description, {} as never)).toBe(false);
    expect(
      isFormFieldValueSet(description, {
        description: "Looks after payments.",
      } as never),
    ).toBe(true);
  });

  test("has no steps to walk: three rows", () => {
    for (const field of fields()) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("Access is the question Create API Key asks, in the team's words", () => {
    const access: ModelField<Team> = fields()[1]!;

    expect(access).toEqual(
      getRoleAccessFormField<Team>({
        holder: RoleAccessHolder.Team,
        accessOptions: ACCESS_OPTIONS,
      }),
    );
    expect(access.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(access.cardSelectOptions).toBe(ACCESS_OPTIONS);
    expect(access.defaultValue).toBe(ROLE_ACCESS_LATER);
    expect(access.required).toBe(true);
    expect(access.formOnly).toBe(true);
    expect(access.dataTestId).toBe("team-access");
    expect(access.description).toBe(
      "What the team's members can do. You can change it on the team's page at any time.",
    );
  });

  test("leaves Access out when there is nothing to choose", () => {
    expect(fields([]).map(keyOf)).toEqual(["name", "description"]);
  });

  test("offers exactly the cards it is given", () => {
    const onlyAdmin: Array<CardSelectOption> = getRoleAccessOptions({
      holder: RoleAccessHolder.Team,
      canGrant: (permission: Permission): boolean => {
        return permission === Permission.ProjectAdmin;
      },
      canAddPermissions: true,
    });

    // The Access cards are plain options: no groups.
    const offered: Array<CardSelectOption> = (fields(onlyAdmin)[1]!
      .cardSelectOptions || []) as Array<CardSelectOption>;

    expect(
      offered.map((option: CardSelectOption): string => {
        return option.value;
      }),
    ).toEqual([Permission.ProjectAdmin, ROLE_ACCESS_LATER]);
  });

  test("Name keeps what it asked before", () => {
    const name: ModelField<Team> = fields()[0]!;

    expect(name.required).toBe(true);
    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.validation?.minLength).toBe(2);
    expect(name.placeholder).toBe("Team Name");
  });

  test("the description stays optional and long", () => {
    const description: ModelField<Team> = fields()[2]!;

    expect(description.required).toBe(false);
    expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(description.placeholder).toBe("Team Description");
  });

  test("each form gets its own section and fields", () => {
    const first: Array<ModelField<Team>> = fields();
    const second: Array<ModelField<Team>> = fields();

    expect(first[2]!.collapsibleSection).not.toBe(
      second[2]!.collapsibleSection,
    );
    expect(first).toEqual(second);
  });
});

describe("where a new team opens", () => {
  test.each([
    [Permission.ProjectAdmin],
    [Permission.ProjectMember],
    [Permission.Viewer],
  ])(
    "with %s it can do something now: Members, to invite people",
    (role: Permission) => {
      expect(getNewTeamPage({ role: role, wasAccessAsked: true })).toBe(
        PageMap.TEAM_VIEW_MEMBERS,
      );
    },
  );

  test("with Choose permissions later: Permissions, where Add Role is", () => {
    expect(getNewTeamPage({ role: null, wasAccessAsked: true })).toBe(
      PageMap.TEAM_VIEW_PERMISSIONS,
    );
  });

  test("not asked at all (no right to add permissions): Members", () => {
    expect(getNewTeamPage({ role: null, wasAccessAsked: false })).toBe(
      PageMap.TEAM_VIEW_MEMBERS,
    );
  });
});
