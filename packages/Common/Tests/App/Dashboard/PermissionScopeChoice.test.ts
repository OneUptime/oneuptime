import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PERMISSION_LABELS_FIELD_TITLE,
  PERMISSION_SCOPE_ANSWERS,
  PERMISSION_SCOPE_DESCRIPTIONS,
  PERMISSION_SCOPE_FIELD_DESCRIPTION,
  PERMISSION_SCOPE_FIELD_TITLE,
  PERMISSION_SCOPE_TITLES,
  getOfferedPermissionScopeChoices,
  getPermissionScopeCell,
  getPermissionScopeChoices,
  getPermissionScopeFields,
  getPermissionScopes,
  getRoleScopes,
  getScopeKeptOnPermissionChange,
  holdsPermissionLabels,
  isLabelsScopePicked,
  isScopeShownFor,
  isScopeShownForPermission,
  readPermissionScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/PermissionScopeChoice";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import Label from "../../../Models/DatabaseModels/Label";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import type { RadioButton } from "../../../UI/Components/RadioButtons/GroupRadioButtons";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { FOLDED_SECTION_LINE } from "../../../UI/Components/FoldedSection/FoldedSectionVariant";

/*
 * HOW FAR A PERMISSION REACHES (Dashboard/src/Components/Permission/
 * PermissionScopeChoice): the Scope of a team's permission and of a custom
 * role's permission, as three plain answers with a line each, All first -
 * and the Scope cell of the team, custom role and API key tables.
 *
 * The stored values are PermissionScope's (All, Owned, Labels), as the API
 * and Terraform write them. What a cell says follows the server: a row is
 * narrowed by its labels whenever it has some, whatever its scope, and a
 * labels row with none reaches every resource.
 *
 * Both fields wait folded under the dialog's More fields line: All is what
 * most teams want, so Add a Role and Add a Permission ask for the role or
 * the permission alone.
 */

type Values = FormValues<TeamPermission>;

// What a field hands its new values to.
type SetNewFormValuesMock = ReturnType<
  typeof jest.fn<(values: Values) => void>
>;

function values(record: Record<string, unknown>): Values {
  return record as unknown as Values;
}

function label(name: string): Label {
  const result: Label = new Label();

  result.name = name;

  return result;
}

const SCOPE_SHOWN: (values: Values) => boolean = (): boolean => {
  return true;
};

const SCOPE_HIDDEN: (values: Values) => boolean = (): boolean => {
  return false;
};

function fieldsFor(
  isScopeShown: (values: Values) => boolean,
): [ModelField<TeamPermission>, ModelField<TeamPermission>] {
  return getPermissionScopeFields<TeamPermission>({ isScopeShown }) as [
    ModelField<TeamPermission>,
    ModelField<TeamPermission>,
  ];
}

describe("the answers", () => {
  test("are All, Owned and Labels, the default first and the narrowest last", () => {
    expect([...PERMISSION_SCOPE_ANSWERS]).toEqual([
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
    ]);
  });

  test("say what they reach in plain words, with no answer calling itself advanced", () => {
    expect(PERMISSION_SCOPE_TITLES).toEqual({
      [PermissionScope.All]: "All resources in the project",
      [PermissionScope.Owned]: "Only resources they own",
      [PermissionScope.Labels]: "Only resources with certain labels",
    });

    for (const title of Object.values(PERMISSION_SCOPE_TITLES)) {
      expect(title).not.toMatch(/advanced|restrict/i);
    }
  });

  test("each has one line under it, ownership read from the person and the team the permission is given to", () => {
    expect(PERMISSION_SCOPE_DESCRIPTIONS[PermissionScope.All]).toBe(
      "Recommended for most teams.",
    );
    /*
     * The server reads ownership from the person acting, and from the team
     * the permission is given to - not from the person's other teams.
     */
    expect(PERMISSION_SCOPE_DESCRIPTIONS[PermissionScope.Owned]).toBe(
      "Resources the person, or the team given this permission, owns.",
    );
    expect(PERMISSION_SCOPE_DESCRIPTIONS[PermissionScope.Labels]).toBe(
      "Resources that carry one of the labels you pick.",
    );

    for (const description of Object.values(PERMISSION_SCOPE_DESCRIPTIONS)) {
      expect(description).toMatch(/^[A-Z][^.]*\.$/);
    }
  });

  test("are offered as radio answers, in that order", () => {
    const choices: Array<RadioButton> = getPermissionScopeChoices();

    expect(choices).toEqual(
      PERMISSION_SCOPE_ANSWERS.map((scope: PermissionScope) => {
        return {
          value: scope,
          title: PERMISSION_SCOPE_TITLES[scope],
          description: PERMISSION_SCOPE_DESCRIPTIONS[scope],
        };
      }),
    );
    // A new list each time: one form cannot change another's.
    expect(getPermissionScopeChoices()).not.toBe(choices);
  });

  test("are written out whole in the source, for the extractor", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Permission/PermissionScopeChoice.ts",
      ),
      "utf8",
    );

    for (const text of [
      ...Object.values(PERMISSION_SCOPE_TITLES),
      ...Object.values(PERMISSION_SCOPE_DESCRIPTIONS),
      PERMISSION_SCOPE_FIELD_TITLE,
      PERMISSION_SCOPE_FIELD_DESCRIPTION,
      PERMISSION_LABELS_FIELD_TITLE,
    ]) {
      expect(source).toMatch(
        new RegExp(`translationKey\\(\\s*"${escapeRegExp(text)}"`),
      );
    }
  });
});

describe("the scope a row holds", () => {
  test("is the stored one, and All for none or anything else, as the server reads it", () => {
    expect(readPermissionScope(PermissionScope.Owned)).toBe(
      PermissionScope.Owned,
    );
    expect(readPermissionScope(PermissionScope.Labels)).toBe(
      PermissionScope.Labels,
    );
    expect(readPermissionScope(PermissionScope.All)).toBe(PermissionScope.All);

    for (const unknownValue of [undefined, null, "", "Everything", 3]) {
      expect(readPermissionScope(unknownValue)).toBe(PermissionScope.All);
    }
  });
});

describe("what a Scope cell says", () => {
  const ops: Label = label("Ops");
  const prod: Label = label("Production");

  test("All without labels: every resource", () => {
    expect(getPermissionScopeCell({ scope: PermissionScope.All })).toEqual({
      title: "All resources in the project",
      labels: [],
    });
    expect(getPermissionScopeCell({})).toEqual({
      title: "All resources in the project",
      labels: [],
    });
  });

  test("labels narrow the row whatever its stored scope, as the server narrows it", () => {
    expect(
      getPermissionScopeCell({ scope: PermissionScope.All, labels: [ops] }),
    ).toEqual({ title: "Only resources with certain labels", labels: [ops] });
    expect(
      getPermissionScopeCell({
        scope: PermissionScope.Labels,
        labels: [ops, prod],
      }),
    ).toEqual({
      title: "Only resources with certain labels",
      labels: [ops, prod],
    });
  });

  test("a labels row with no label reaches everything, and says so", () => {
    for (const labels of [[], null, undefined]) {
      expect(
        getPermissionScopeCell({ scope: PermissionScope.Labels, labels }),
      ).toEqual({ title: "All resources in the project", labels: [] });
    }
  });

  test("Owned keeps its words, with any labels that also narrow it under them", () => {
    expect(getPermissionScopeCell({ scope: PermissionScope.Owned })).toEqual({
      title: "Only resources they own",
      labels: [],
    });
    expect(
      getPermissionScopeCell({ scope: PermissionScope.Owned, labels: [prod] }),
    ).toEqual({ title: "Only resources they own", labels: [prod] });
  });
});

describe("what the form holds", () => {
  test("labels: some picked or stored, never an empty list or none", () => {
    expect(holdsPermissionLabels({ labels: ["a"] })).toBe(true);
    expect(holdsPermissionLabels({ labels: [] })).toBe(false);
    expect(holdsPermissionLabels({})).toBe(false);
    expect(holdsPermissionLabels(null)).toBe(false);
    expect(holdsPermissionLabels({ labels: "a" })).toBe(false);
  });

  test("the third answer: only resources with labels", () => {
    expect(isLabelsScopePicked({ scope: PermissionScope.Labels })).toBe(true);
    expect(isLabelsScopePicked({ scope: PermissionScope.Owned })).toBe(false);
    expect(isLabelsScopePicked({})).toBe(false);
    expect(isLabelsScopePicked(undefined)).toBe(false);
  });
});

describe("the Scope field", () => {
  test("is the three answers, starting on All, required, with its one line", () => {
    const [scope] = fieldsFor(SCOPE_SHOWN);

    expect(Object.keys(scope.field || {})).toEqual(["scope"]);
    expect(scope.title).toBe("Scope");
    expect(scope.description).toBe("Which resources it reaches.");
    expect(scope.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(scope.radioButtonOptions).toEqual(getPermissionScopeChoices());
    expect(scope.defaultValue).toBe(PermissionScope.All);
    expect(scope.required).toBe(true);
  });

  test("is drawn only where the permission takes a scope", () => {
    expect(fieldsFor(SCOPE_SHOWN)[0].showIf!(values({}))).toBe(true);
    expect(fieldsFor(SCOPE_HIDDEN)[0].showIf!(values({}))).toBe(false);
  });

  test("picking All or Owned clears labels a row held, which would otherwise narrow it unseen", () => {
    const [scope] = fieldsFor(SCOPE_SHOWN);
    const setNewFormValues: SetNewFormValuesMock =
      jest.fn<(values: Values) => void>();

    for (const picked of [PermissionScope.All, PermissionScope.Owned]) {
      setNewFormValues.mockClear();

      scope.onChange!(
        picked,
        values({ permission: "ReadIncident", scope: picked, labels: ["a"] }),
        setNewFormValues,
      );

      expect(setNewFormValues).toHaveBeenCalledTimes(1);
      expect(setNewFormValues).toHaveBeenCalledWith({
        permission: "ReadIncident",
        scope: picked,
        labels: [],
      });
    }
  });

  test("picking the third answer keeps the labels, and nothing is written when there are none", () => {
    const [scope] = fieldsFor(SCOPE_SHOWN);
    const setNewFormValues: SetNewFormValuesMock =
      jest.fn<(values: Values) => void>();

    scope.onChange!(
      PermissionScope.Labels,
      values({ scope: PermissionScope.Labels, labels: ["a"] }),
      setNewFormValues,
    );
    scope.onChange!(
      PermissionScope.All,
      values({ scope: PermissionScope.All, labels: [] }),
      setNewFormValues,
    );
    scope.onChange!(
      PermissionScope.Owned,
      values({ scope: PermissionScope.Owned }),
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});

describe("the Labels field", () => {
  test("asks for labels with no line of its own: the answer above says what they do", () => {
    const [, labels] = fieldsFor(SCOPE_SHOWN);

    expect(Object.keys(labels.field || {})).toEqual(["labels"]);
    expect(labels.title).toBe("Labels");
    expect(labels.description).toBeUndefined();
    expect(labels.hideColumnDescription).toBe(true);
    expect(labels.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(labels.dropdownModal?.type).toBe(Label);
  });

  test("is drawn, and required, once the third answer is picked", () => {
    const [, labels] = fieldsFor(SCOPE_SHOWN);
    const required: (values: Values) => boolean = labels.required as (
      values: Values,
    ) => boolean;
    const picked: Values = values({ scope: PermissionScope.Labels });

    expect(labels.showIf!(picked)).toBe(true);
    expect(required(picked)).toBe(true);

    for (const scope of [PermissionScope.All, PermissionScope.Owned]) {
      expect(labels.showIf!(values({ scope }))).toBe(false);
      expect(required(values({ scope }))).toBe(false);
    }
  });

  test("is drawn for a row stored with labels under another answer, so the form never hides what narrows it", () => {
    const [, labels] = fieldsFor(SCOPE_SHOWN);
    const required: (values: Values) => boolean = labels.required as (
      values: Values,
    ) => boolean;
    const stored: Values = values({
      scope: PermissionScope.All,
      labels: ["a"],
    });

    expect(labels.showIf!(stored)).toBe(true);
    // Not required there: the answer picked does not ask for labels.
    expect(required(stored)).toBe(false);
  });

  test("is never drawn or required where the permission takes no scope", () => {
    const [, labels] = fieldsFor(SCOPE_HIDDEN);
    const required: (values: Values) => boolean = labels.required as (
      values: Values,
    ) => boolean;
    const picked: Values = values({
      scope: PermissionScope.Labels,
      labels: ["a"],
    });

    expect(labels.showIf!(picked)).toBe(false);
    expect(required(picked)).toBe(false);
  });
});

describe("folded under More fields", () => {
  test("both fields wait in one fold: the form's More fields line", () => {
    const [scope, labels] = fieldsFor(SCOPE_SHOWN);

    expect(scope.collapsibleSection).toBeDefined();
    expect(labels.collapsibleSection).toBe(scope.collapsibleSection);
    expect(scope.collapsibleSection?.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(scope.collapsibleSection?.title).toBe(MORE_FIELDS_SECTION_TITLE);
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(scope.collapsibleSection?.variant).toBe(FOLDED_SECTION_LINE);
  });

  test("folded on Create and on Edit alike, its line naming the Scope - and what a narrower one is set to", () => {
    const [scope] = fieldsFor(SCOPE_SHOWN);

    expect(scope.collapsibleSection?.openWhenConfigured).toBe(false);
    expect(scope.collapsibleSection?.listFieldsWhileFolded).toBe(true);
  });

  test("says nothing more under the line: All needs no sentence", () => {
    const [scope] = fieldsFor(SCOPE_SHOWN);

    expect(scope.collapsibleSection?.getSummary).toBeUndefined();
    expect(scope.collapsibleSection?.description).toBeUndefined();
  });

  test("the fold is written into each field, where the form-steps scan reads it", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Permission/PermissionScopeChoice.ts",
      ),
      "utf8",
    );

    expect(source.split("collapsibleSection: moreFields,").length - 1).toBe(2);
    expect(source).toContain("getAdvancedFormSection<TEntity>()");
  });

  test("a permission that takes no scope folds nothing away: no More fields line", () => {
    const [scope, labels] = fieldsFor(SCOPE_HIDDEN);

    expect(scope.showIf!(values({}))).toBe(false);
    expect(labels.showIf!(values({ labels: [label("Production")] }))).toBe(
      false,
    );
  });
});

/*
 * Whether the form holds a role (or permission) that takes a scope: what a
 * team's and a custom role's Add Role ask both for their Scope and for the
 * room the role picker keeps under itself while the Scope is not shown.
 */
describe("whether a pick takes a scope", () => {
  test("nothing picked yet: no Scope, so the picker keeps its room", () => {
    for (const empty of [undefined, null, ""]) {
      expect(isScopeShownFor(empty)).toBe(false);
    }
  });

  test("the roles that reach the whole project by definition take none", () => {
    for (const role of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.BillingAdmin,
      Permission.BillingMember,
      Permission.BillingViewer,
    ]) {
      expect({ role, shown: isScopeShownFor(role) }).toEqual({
        role,
        shown: false,
      });
    }
  });

  test("every other role takes one: Project Member, Viewer and each area's", () => {
    const scoped: Array<Permission> = PermissionHelper.getRolePermissionProps()
      .map((props: { permission: Permission }): Permission => {
        return props.permission;
      })
      .filter((role: Permission): boolean => {
        return PermissionHelper.isScopeApplicable(role);
      });

    expect(scoped).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.IncidentMember,
        Permission.TelemetryViewer,
      ]),
    );
    // 40 roles, 8 of them without a scope.
    expect(scoped).toHaveLength(32);

    for (const role of scoped) {
      expect({ role, shown: isScopeShownFor(role) }).toEqual({
        role,
        shown: true,
      });
    }
  });
});

describe("one Scope for every permission table", () => {
  const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
  const COMPONENTS: string = path.join(
    REPOSITORY_ROOT,
    "packages/App/FeatureSet/Dashboard/src/Components",
  );

  interface PermissionTable {
    name: string;
    file: string;
    model: string;
    // How the table imports the shared Scope cell from where it lives.
    scopeCellImport: string;
  }

  const TEAM: PermissionTable = {
    name: "Team/TeamPermissionTable.tsx",
    file: path.join(COMPONENTS, "Team/TeamPermissionTable.tsx"),
    model: "TeamPermission",
    scopeCellImport: "../Permission/PermissionScopeCell",
  };
  const API_KEY: PermissionTable = {
    name: "ApiKey/ApiKeyPermissionTable.tsx",
    file: path.join(COMPONENTS, "ApiKey/ApiKeyPermissionTable.tsx"),
    model: "ApiKeyPermission",
    scopeCellImport: "../Permission/PermissionScopeCell",
  };
  /*
   * Custom roles are the Enterprise Edition's since #5216, so their table
   * lives in ee/ and reaches the Dashboard by its alias. Common Test removes
   * ee/ before it runs; the Enterprise Edition workflow runs this suite with
   * ee/ present, so the table is checked there.
   */
  const CUSTOM_ROLE: PermissionTable = {
    name: "ee CustomRoles/CustomRolePermissionTable.tsx",
    file: path.join(
      REPOSITORY_ROOT,
      "ee/Dashboard/CustomRoles/CustomRolePermissionTable.tsx",
    ),
    model: "CustomRolePermission",
    scopeCellImport:
      "@oneuptime/dashboard/Components/Permission/PermissionScopeCell",
  };
  const isEnterprisePresent: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee"),
  );
  const ROLE_TABLES: Array<PermissionTable> = isEnterprisePresent
    ? [TEAM, CUSTOM_ROLE]
    : [TEAM];

  const sourceOf: (table: PermissionTable) => string = (
    table: PermissionTable,
  ): string => {
    return fs.readFileSync(table.file, "utf8");
  };

  /*
   * One answer to "does this pick take a scope", asked for the Scope field
   * and for the room the role picker keeps while it is not shown - so the
   * room is there exactly while the More fields line is not.
   */
  test.each(ROLE_TABLES)(
    "$name asks one question for the Scope and for the picker's room",
    (table: PermissionTable) => {
      const source: string = sourceOf(table);

      expect(source).toContain("isMoreFieldsShownFor: isScopeShownFor,");
      expect(source).toContain('return isScopeShownFor(values["permission"]);');
    },
  );

  test.each(ROLE_TABLES)(
    "$name asks with the shared fields",
    (table: PermissionTable) => {
      const source: string = sourceOf(table);

      expect(source).toContain(`getPermissionScopeFields<${table.model}>({`);
      expect(source).not.toContain("Owned by this team or its members");
      expect(source).not.toContain("Restrict by labels (advanced)");
    },
  );

  test.each([...ROLE_TABLES, API_KEY])(
    "$name draws the shared Scope cell",
    (table: PermissionTable) => {
      const source: string = sourceOf(table);

      expect(source).toContain(
        `import PermissionScopeCell from "${table.scopeCellImport}";`,
      );
      expect(source).toContain("<PermissionScopeCell");
      expect(source).not.toContain(
        "No restrictions has been applied to this permission.",
      );
    },
  );
});

/*
 * ONE PERMISSION IS OFFERED THE ANSWERS THAT NARROW IT (issue #5602). A
 * role reaches records of many kinds and keeps all three answers; one
 * permission is offered All, then Owned where owners narrow it and Labels
 * where labels do (PermissionScopeNarrowing) - and a block, which the
 * server reads by its labels alone, never Owned.
 */
describe("one permission's Scope", () => {
  // One permission from each of PermissionScopeNarrowing's lists, and one from none.
  const BOTH: Permission = Permission.CreateWorkflow;
  const LABELS_ONLY: Permission = Permission.ReadWorkflowOwnerTeam;
  const OWNERS_ONLY: Permission = Permission.ReadSecurityCaseNote;
  const NEITHER: Permission = Permission.CreateProjectTeam;

  test("the answers can be some of the three, always in the form's order", () => {
    expect(
      getPermissionScopeChoices([
        PermissionScope.Labels,
        PermissionScope.All,
      ]).map((choice: RadioButton): string => {
        return choice.value as string;
      }),
    ).toEqual([PermissionScope.All, PermissionScope.Labels]);
    expect(getPermissionScopeChoices()).toHaveLength(3);
    expect(getPermissionScopeChoices([])).toEqual([]);
  });

  test("takes a Scope where a scope narrows the permission: Create Workflow, the issue's, and an override's", () => {
    for (const permission of [
      BOTH,
      LABELS_ONLY,
      OWNERS_ONLY,
      Permission.CreateOnCallDutyPolicyUserOverride,
      Permission.DeleteOnCallDutyPolicyUserOverride,
    ]) {
      expect({
        permission,
        shown: isScopeShownForPermission(permission),
      }).toEqual({ permission, shown: true });
    }
  });

  test("takes none where no scope narrows the permission, nothing is picked, or the role reaches the whole project", () => {
    for (const permission of [
      NEITHER,
      Permission.ReadNetworkSiteType,
      Permission.ProjectOwner,
      Permission.SettingsAdmin,
      undefined,
      null,
      "",
    ]) {
      expect({
        permission,
        shown: isScopeShownForPermission(permission),
      }).toEqual({ permission, shown: false });
    }
  });

  test.each([
    [
      "labels and owners",
      BOTH,
      [PermissionScope.All, PermissionScope.Owned, PermissionScope.Labels],
    ],
    ["labels only", LABELS_ONLY, [PermissionScope.All, PermissionScope.Labels]],
    ["owners only", OWNERS_ONLY, [PermissionScope.All, PermissionScope.Owned]],
    ["nothing", NEITHER, [PermissionScope.All]],
    ["nothing yet: no permission picked", undefined, [PermissionScope.All]],
  ])(
    "a permission narrowed by %s is offered just those answers, All first",
    (_kind: string, permission: unknown, expected: Array<PermissionScope>) => {
      expect(getPermissionScopes(permission)).toEqual(expected);
    },
  );

  test("a block is never offered Owned: the server reads a block by its labels alone", () => {
    expect(getPermissionScopes(BOTH, { isBlock: true })).toEqual([
      PermissionScope.All,
      PermissionScope.Labels,
    ]);
    expect(getPermissionScopes(OWNERS_ONLY, { isBlock: true })).toEqual([
      PermissionScope.All,
    ]);
    expect(getRoleScopes({ isBlock: true })).toEqual([
      PermissionScope.All,
      PermissionScope.Labels,
    ]);
  });

  test("a role keeps all three answers: it reaches records of many kinds", () => {
    expect(getRoleScopes()).toEqual([...PERMISSION_SCOPE_ANSWERS]);
    expect(getRoleScopes({ isBlock: false })).toEqual([
      ...PERMISSION_SCOPE_ANSWERS,
    ]);
  });

  test("changing the permission keeps an answer the new one offers, and puts any other back to All", () => {
    // From Create Workflow, Owned, to another permission owners narrow.
    expect(
      getScopeKeptOnPermissionChange({
        permission: OWNERS_ONLY,
        heldScope: PermissionScope.Owned,
      }),
    ).toBe(PermissionScope.Owned);

    // To one owners narrow nothing of: Owned would reach everything.
    expect(
      getScopeKeptOnPermissionChange({
        permission: LABELS_ONLY,
        heldScope: PermissionScope.Owned,
      }),
    ).toBe(PermissionScope.All);
    expect(
      getScopeKeptOnPermissionChange({
        permission: OWNERS_ONLY,
        heldScope: PermissionScope.Labels,
      }),
    ).toBe(PermissionScope.All);
    expect(
      getScopeKeptOnPermissionChange({
        permission: NEITHER,
        heldScope: PermissionScope.Labels,
      }),
    ).toBe(PermissionScope.All);

    // On a block, Owned is never kept.
    expect(
      getScopeKeptOnPermissionChange({
        permission: BOTH,
        heldScope: PermissionScope.Owned,
        options: { isBlock: true },
      }),
    ).toBe(PermissionScope.All);

    // Nothing held, or something that is no scope: All.
    expect(
      getScopeKeptOnPermissionChange({
        permission: BOTH,
        heldScope: undefined,
      }),
    ).toBe(PermissionScope.All);
    expect(
      getScopeKeptOnPermissionChange({ permission: BOTH, heldScope: "Mine" }),
    ).toBe(PermissionScope.All);
  });

  test("the answers shown add the one a row holds when it is not offered, so Edit never hides what the row says", () => {
    const offered: Array<PermissionScope> = [
      PermissionScope.All,
      PermissionScope.Labels,
    ];

    const valuesOf: (heldScope: unknown) => Array<string> = (
      heldScope: unknown,
    ): Array<string> => {
      return getOfferedPermissionScopeChoices({
        scopes: offered,
        heldScope,
      }).map((choice: RadioButton): string => {
        return choice.value as string;
      });
    };

    // An API or Terraform caller saved it with Owned: shown, in its place.
    expect(valuesOf(PermissionScope.Owned)).toEqual([
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
    ]);
    // Offered already, or nothing held: just the answers offered.
    expect(valuesOf(PermissionScope.Labels)).toEqual(offered);
    expect(valuesOf(undefined)).toEqual(offered);
    expect(valuesOf("Mine")).toEqual(offered);
  });

  test("the Scope field offers the answers for what the form holds, and keeps all three as its whole list", () => {
    const [scope] = getPermissionScopeFields<TeamPermission>({
      isScopeShown: SCOPE_SHOWN,
      getScopes: (formValues: Values): Array<PermissionScope> => {
        return getPermissionScopes(formValues["permission"]);
      },
    }) as [ModelField<TeamPermission>, ModelField<TeamPermission>];

    // Its defaults are checked against the whole list, and a folded line reads it.
    expect(scope.radioButtonOptions).toEqual(getPermissionScopeChoices());

    const offeredFor: (record: Record<string, unknown>) => Array<string> = (
      record: Record<string, unknown>,
    ): Array<string> => {
      return scope.getRadioButtonOptions!(values(record)).map(
        (choice: RadioButton): string => {
          return choice.value as string;
        },
      );
    };

    expect(offeredFor({ permission: BOTH })).toEqual([
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
    ]);
    expect(offeredFor({ permission: LABELS_ONLY })).toEqual([
      PermissionScope.All,
      PermissionScope.Labels,
    ]);
    expect(
      offeredFor({ permission: LABELS_ONLY, scope: PermissionScope.Owned }),
    ).toEqual([
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
    ]);
  });

  test("without getScopes the Scope field offers its whole list, as before", () => {
    const [scope] = fieldsFor(SCOPE_SHOWN);

    expect(scope.getRadioButtonOptions).toBeUndefined();
    expect(scope.radioButtonOptions).toEqual(getPermissionScopeChoices());
  });

  test("hundreds of permissions get a Scope that the flag the dialog read gave none", () => {
    const newlyScoped: Array<Permission> =
      PermissionHelper.getTenantPermissionProps()
        .map((props: { permission: Permission }): Permission => {
          return props.permission;
        })
        .filter((permission: Permission): boolean => {
          return (
            isScopeShownForPermission(permission) &&
            !PermissionHelper.isAccessControlPermission(permission)
          );
        });

    expect(newlyScoped).toContain(Permission.CreateWorkflow);
    expect(newlyScoped).toContain(
      Permission.CreateOnCallDutyPolicyUserOverride,
    );
    expect(newlyScoped.length).toBeGreaterThan(500);
  });
});

describe("one permission's Scope in every permission table", () => {
  const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

  const read: (relative: string) => string = (relative: string): string => {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8");
  };

  const TEAM_TABLE: string =
    "packages/App/FeatureSet/Dashboard/src/Components/Team/TeamPermissionTable.tsx";
  const API_KEY_TABLE: string =
    "packages/App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyPermissionTable.tsx";
  const CUSTOM_ROLE_TABLE: string =
    "ee/Dashboard/CustomRoles/CustomRolePermissionTable.tsx";

  test("no table decides from the legacy flag, which marks little more than a resource's own read, edit and delete", () => {
    for (const table of [TEAM_TABLE, API_KEY_TABLE]) {
      expect({
        table,
        readsFlag: read(table).includes("isAccessControlPermission"),
      }).toEqual({
        table,
        readsFlag: false,
      });
    }
  });

  test("a team's Add Permission asks what narrows the permission, for the Scope and for its answers", () => {
    const source: string = read(TEAM_TABLE);

    expect(source).toContain(
      'return isScopeShownForPermission(values["permission"]);',
    );
    expect(source).toContain(
      'return getPermissionScopes(values["permission"], {',
    );
    // A block is never offered Owned, a role's as much as a permission's.
    expect(source).toContain("return getRoleScopes({ isBlock: isBlock });");
  });

  test("an API key's Add Permission asks for labels wherever labels narrow the permission", () => {
    expect(read(API_KEY_TABLE)).toContain(
      "PermissionScopeNarrowing.isNarrowedByLabels(",
    );
  });

  // The Enterprise Edition's table: checked where ee/ is present.
  const customRoleTest: typeof test = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee"),
  )
    ? test
    : test.skip;

  customRoleTest(
    "a custom role's Add Permission asks the same, and a role keeps its three answers",
    () => {
      const source: string = read(CUSTOM_ROLE_TABLE);

      expect(source).toContain(
        'return isScopeShownForPermission(values["permission"]);',
      );
      expect(source).toContain(
        'return getPermissionScopes(values["permission"]);',
      );
      expect(source).toContain("return getRoleScopes();");
    },
  );
});
