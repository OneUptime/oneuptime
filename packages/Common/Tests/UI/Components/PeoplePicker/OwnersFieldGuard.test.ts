import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  MIN_SCANNED_FORMS,
  SourceFileSystem,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "We have this owner's team and owner's user literally everywhere in the
 * project ... Instead of having two different dropdowns, can we make the UI
 * like we have in the incident ... owners page ... Wherever you find this
 * two-dropdown thing in the form, we have to replace that with that
 * particular field." - the maintainer, on the 'Owner - Teams' and 'Owner -
 * Users' dropdowns of the Create New Incident Template dialog.
 *
 * Every form that asks for owners now asks with one people picker
 * (getOwnersFormField, or OwnersPicker outside a form), and every page that
 * lists them shows one Owners card. This guard keeps it that way across the
 * frontends and Common's UI:
 *
 *   - no form has a field that writes an owner list (ownerTeams, ownerUsers,
 *     alertOwnerTeams, ownerTeamIds...) other than a people picker - so a
 *     teams dropdown and a users dropdown can never come back as a pair;
 *   - no page lists owners as an "Owners (Teams)" and an "Owners (Users)"
 *     table;
 *   - no form asks for one user plus one team as an assignee or owner - the
 *     "Default Assign To Team" and "Default Assign To User" pair grouping
 *     rules had, which filled an assignee nothing ever showed (now their
 *     Episode Owners picker);
 *   - the old labels are gone from the source.
 *
 * The detector is pinned on inline snippets first, then run over the real
 * tree with checks that it really read it.
 */

// packages/Common/Tests/UI/Components/PeoplePicker -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

// A form value holding a list of owner teams or owner users.
const OWNER_LIST_KEY: RegExp = /^(?:\w*O|o)wner(?:Team|User)(?:s|Ids)$/;

// The labels of the two-dropdown and two-table owners, in any surface.
const RETIRED_LABELS: Array<string> = [
  "Owner - Teams",
  "Owner - Users",
  "Owner Teams",
  "Owner Users",
  "Owners (Teams)",
  "Owners (Users)",
  "Alert Owner Teams",
  "Alert Owner Users",
  "Incident Owner Teams",
  "Incident Owner Users",
  // The grouping rules' assignee pair and its section.
  "Default Assign To Team",
  "Default Assign To User",
  "Default Assignees",
];

/*
 * A form value holding ONE user or ONE team that somebody is assigned to or
 * owns: defaultAssignToTeam, assignedToUserId, ownerTeam. Lists (ownerTeams,
 * episodeOwnerUsers) are OWNER_LIST_KEY's.
 */
const SINGLE_ASSIGNEE_KEY: RegExp =
  /^\w*?(?:[Aa]ssign|[Oo]wner)\w*?(User|Team)(?:Id)?$/;

// The same, said by a written title: "Default Assign To Team", "Owner User".
const ASSIGNEE_TITLE: RegExp = /\b(?:assign\w*|owner)\b/i;
const TEAM_WORD: RegExp = /\bteam\b/i;
const USER_WORD: RegExp = /\buser\b/i;

type AssigneeKind = "User" | "Team";

// The grouping rules' old pair, by key and by title.
const OLD_PAIR_KEY: RegExp = /defaultAssignTo/;
const OLD_PAIR_TITLE: RegExp = /Default Assign/i;

// A table of one owner junction model: half of the old two-table owners.
const OWNER_TABLE: RegExp = /<ModelTable<\s*\w+Owner(?:Team|User)\s*>/;

const OWNER_DROPDOWN_COMMENT_FREE: (code: string) => string = (
  code: string,
): string => {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, " ");
};

interface OwnerDropdown {
  form: FormFacts;
  field: FormFieldFacts;
}

// Fields that write an owner list without being a people picker.
function findOwnerDropdowns(forms: Array<FormFacts>): Array<OwnerDropdown> {
  const found: Array<OwnerDropdown> = [];

  for (const form of forms) {
    for (const field of form.fields) {
      if (field.isNeverShown) {
        continue;
      }

      if (
        OWNER_LIST_KEY.test(field.key) &&
        field.fieldType !== PEOPLE_PICKER_FIELD_TYPE
      ) {
        found.push({ form, field });
      }
    }
  }

  return found;
}

function describeDropdown(dropdown: OwnerDropdown): string {
  return `${dropdown.field.file}:${dropdown.field.line} ${dropdown.form.label} - "${dropdown.field.title}" (${dropdown.field.key}) is not the owners people picker`;
}

/*
 * What one field asks for: one user, one team, or neither. Read off its key
 * first, then off a written title that says assign or owner and names one
 * of the two. A people picker, and a registration that is never shown, ask
 * for nothing here.
 */
function singleAssigneeKind(field: FormFieldFacts): AssigneeKind | null {
  if (field.isNeverShown || field.fieldType === PEOPLE_PICKER_FIELD_TYPE) {
    return null;
  }

  const keyMatch: RegExpExecArray | null = SINGLE_ASSIGNEE_KEY.exec(field.key);

  if (keyMatch) {
    return keyMatch[1] as AssigneeKind;
  }

  for (const title of field.titleTexts || []) {
    if (!ASSIGNEE_TITLE.test(title)) {
      continue;
    }

    const saysTeam: boolean = TEAM_WORD.test(title);
    const saysUser: boolean = USER_WORD.test(title);

    if (saysTeam !== saysUser) {
      return saysTeam ? "Team" : "User";
    }
  }

  return null;
}

interface AssigneePair {
  form: FormFacts;
  team: FormFieldFacts;
  user: FormFieldFacts;
}

/*
 * Forms that ask who is responsible with two controls - one for a team, one
 * for a user - where one people picker asks it once. A single person-or-team
 * question on its own is left alone.
 */
function findAssigneePairs(forms: Array<FormFacts>): Array<AssigneePair> {
  const found: Array<AssigneePair> = [];

  for (const form of forms) {
    const team: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return singleAssigneeKind(field) === "Team";
      },
    );
    const user: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return singleAssigneeKind(field) === "User";
      },
    );

    if (team && user) {
      found.push({ form, team, user });
    }
  }

  return found;
}

function describeAssigneePair(pair: AssigneePair): string {
  return `${pair.form.file}:${pair.form.line} ${pair.form.label} - "${pair.team.title}" (${pair.team.key}) and "${pair.user.title}" (${pair.user.key}) ask for one team and one user: ask once, with the owners people picker (getOwnersFormField)`;
}

function peoplePickers(forms: Array<FormFacts>): Array<FormFieldFacts> {
  return forms.flatMap((form: FormFacts): Array<FormFieldFacts> => {
    return form.fields.filter((field: FormFieldFacts): boolean => {
      return field.fieldType === PEOPLE_PICKER_FIELD_TYPE;
    });
  });
}

const VIRTUAL_ROOT: string = "/repo";

function virtualFileSystem(files: Record<string, string>): SourceFileSystem {
  return {
    readFile: (filePath: string): string | null => {
      const relative: string = path
        .relative(VIRTUAL_ROOT, filePath)
        .split(path.sep)
        .join("/");

      return Object.prototype.hasOwnProperty.call(files, relative)
        ? (files[relative] as string)
        : null;
    },
  };
}

function only(files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

const OWNERS_HELPER: string = `
  export const OWNERS_FORM_FIELD_KEY = "owners";
  const getOwnersFormField = (options) => {
    const { fieldKey, teamsKey, usersKey, ...rest } = options;
    return {
      title: "Owners",
      required: false,
      ...rest,
      field: { [fieldKey || OWNERS_FORM_FIELD_KEY]: true },
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getOwnersPeoplePickerConfig({ teamsKey, usersKey }),
      formOnly: true,
    };
  };
  export default getOwnersFormField;`;

const STEPS: string = `[{ title: "Rule", id: "rule" }, { title: "Owners", id: "owners" }]`;

describe("the owner dropdown detector", () => {
  test("finds the old pair of owner dropdowns on a rule", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <RuleTable name="Settings > Monitor Owner Rules" formSteps={${STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          { field: { ownerTeams: true }, title: "Owner Teams", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown, dropdownModal: { type: Team, labelField: "name", valueField: "_id" } },
          { field: { ownerUsers: true }, title: "Owner Users", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ]} />;`,
    });

    expect(
      findOwnerDropdowns([form]).map((dropdown: OwnerDropdown): string => {
        return dropdown.field.key;
      }),
    ).toEqual(["ownerTeams", "ownerUsers"]);
    expect(describeDropdown(findOwnerDropdowns([form])[0]!)).toContain(
      '"Owner Teams" (ownerTeams) is not the owners people picker',
    );
  });

  test("finds owners sent as misc data through an overrideFieldKey", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelTable name="Settings > Incident Templates" formSteps={${STEPS}} formFields={[
          { field: { templateName: true }, title: "Template Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          { overrideField: { ownerTeams: true }, overrideFieldKey: "ownerTeams", showEvenIfPermissionDoesNotExist: true, title: "Owner - Teams", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown },
          { overrideField: { ownerUsers: true }, overrideFieldKey: "ownerUsers", showEvenIfPermissionDoesNotExist: true, title: "Owner - Users", stepId: "owners", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ]} />;`,
    });

    expect(
      findOwnerDropdowns([form]).map((dropdown: OwnerDropdown): string => {
        return dropdown.field.title;
      }),
    ).toEqual(["Owner - Teams", "Owner - Users"]);
  });

  test("finds every spelling of an owner list: prefixed, and as ids", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <BasicFormModal title="Edit Settings" formProps={{ fields: [
          { field: { alertOwnerTeams: true }, title: "Alert Owner Teams", fieldType: FormFieldSchemaType.MultiSelectDropdown },
          { field: { ownerUserIds: true }, title: "Owner Users", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ] }} />;`,
    });

    expect(
      findOwnerDropdowns([form]).map((dropdown: OwnerDropdown): string => {
        return dropdown.field.key;
      }),
    ).toEqual(["alertOwnerTeams", "ownerUserIds"]);
  });

  test("a single owner dropdown is one too: owners are people and teams", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelFormModal title="Owners" formProps={{ fields: [
          { field: { ownerTeams: true }, title: "Teams", fieldType: FormFieldSchemaType.MultiSelectDropdown },
        ] }} />;`,
    });

    expect(findOwnerDropdowns([form])).toHaveLength(1);
  });

  test("leaves the owners people picker alone, on its step", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./OwnersFormField";
        const Page = () => <RuleTable name="Settings > Monitor Owner Rules" formSteps={${STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          getOwnersFormField({ stepId: "owners", description: "Who owns it." }),
        ]} />;`,
      "OwnersFormField.ts": OWNERS_HELPER,
    });

    expect(findOwnerDropdowns([form])).toEqual([]);

    const pickers: Array<FormFieldFacts> = peoplePickers([form]);

    expect(pickers).toHaveLength(1);
    expect(pickers[0]?.stepId).toBe("owners");
    expect(pickers[0]?.title).toBe("Owners");
  });

  test("leaves a picker that keeps owners under other names alone", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./OwnersFormField";
        const Page = () => <ModelTable name="SLO > Burn Rate Rules" formSteps={${STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "rule", fieldType: FormFieldSchemaType.Text },
          getOwnersFormField({ fieldKey: "alertOwners", usersKey: "alertOwnerUsers", teamsKey: "alertOwnerTeams", title: "Alert Owners", stepId: "owners" }),
        ]} />;`,
      "OwnersFormField.ts": OWNERS_HELPER,
    });

    expect(findOwnerDropdowns([form])).toEqual([]);
    expect(peoplePickers([form])[0]?.title).toBe("Alert Owners");
  });

  test("leaves a registration that is never shown alone", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelForm id="form" fields={[
          { field: { title: true }, title: "Title", fieldType: FormFieldSchemaType.Text },
          { field: { ownerTeams: true }, title: "", fieldType: FormFieldSchemaType.Text, showIf: () => { return false; } },
        ]} />;`,
    });

    expect(findOwnerDropdowns([form])).toEqual([]);
  });
});

const OWNERSHIP_STEPS: string = `[{ title: "Grouping", id: "grouping" }, { title: "On-Call & Ownership", id: "on-call-ownership" }]`;

describe("the one-team-plus-one-user detector", () => {
  test("finds the grouping rules' old Default Assign To pair", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelTable name="Settings > Incident Grouping Rules" formSteps={${OWNERSHIP_STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "grouping", fieldType: FormFieldSchemaType.Text },
          { field: { defaultAssignToTeam: true }, title: "Default Assign To Team", stepId: "on-call-ownership", sectionTitle: "Default Assignees", fieldType: FormFieldSchemaType.Dropdown, dropdownModal: { type: Team, labelField: "name", valueField: "_id" } },
          { field: { defaultAssignToUser: true }, title: "Default Assign To User", stepId: "on-call-ownership", fieldType: FormFieldSchemaType.Dropdown, fetchDropdownOptions: async () => { return []; } },
        ]} />;`,
    });

    const pairs: Array<AssigneePair> = findAssigneePairs([form]);

    expect(
      pairs.map((pair: AssigneePair): Array<string> => {
        return [pair.team.key, pair.user.key];
      }),
    ).toEqual([["defaultAssignToTeam", "defaultAssignToUser"]]);
    expect(describeAssigneePair(pairs[0]!)).toContain(
      '"Default Assign To Team" (defaultAssignToTeam) and "Default Assign To User" (defaultAssignToUser) ask for one team and one user',
    );
  });

  test("finds the pair written as ids, and as an owner instead of an assignee", () => {
    const byIds: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelFormModal title="Assign" formProps={{ fields: [
          { field: { assignedToTeamId: true }, title: "Team", fieldType: FormFieldSchemaType.Dropdown },
          { field: { assignedToUserId: true }, title: "User", fieldType: FormFieldSchemaType.Dropdown },
        ] }} />;`,
    });
    const asOwner: FormFacts = only({
      "Page.tsx": `
        const Page = () => <BasicFormModal title="Owner" formProps={{ fields: [
          { field: { ownerTeam: true }, title: "Team", fieldType: FormFieldSchemaType.Dropdown },
          { field: { ownerUserId: true }, title: "User", fieldType: FormFieldSchemaType.Dropdown },
        ] }} />;`,
    });

    expect(findAssigneePairs([byIds, asOwner])).toHaveLength(2);
  });

  test("finds the pair by its titles when the keys do not say it", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelFormModal title="Routing" formProps={{ fields: [
          { field: { teamId: true }, title: "Assign To Team", fieldType: FormFieldSchemaType.Dropdown },
          { field: { userId: true }, title: "Assign To User", fieldType: FormFieldSchemaType.Dropdown },
        ] }} />;`,
    });

    expect(
      findAssigneePairs([form]).map((pair: AssigneePair): string => {
        return `${pair.team.title} + ${pair.user.title}`;
      }),
    ).toEqual(["Assign To Team + Assign To User"]);
  });

  test("leaves the people picker that replaced the pair alone, and the registrations the form reads the old pair with", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./OwnersFormField";
        const Page = () => <ModelTable name="Settings > Incident Grouping Rules" formSteps={${OWNERSHIP_STEPS}} formFields={[
          { field: { name: true }, title: "Name", stepId: "grouping", fieldType: FormFieldSchemaType.Text },
          getOwnersFormField({ fieldKey: "episodeOwners", usersKey: "episodeOwnerUsers", teamsKey: "episodeOwnerTeams", title: "Episode Owners", stepId: "on-call-ownership" }),
          { field: { defaultAssignToTeamId: true }, title: "Default Assign To Team ID", stepId: "on-call-ownership", fieldType: FormFieldSchemaType.ObjectID, showIf: () => { return false; } },
          { field: { defaultAssignToUserId: true }, title: "Default Assign To User ID", stepId: "on-call-ownership", fieldType: FormFieldSchemaType.ObjectID, showIf: () => { return false; } },
        ]} />;`,
      "OwnersFormField.ts": OWNERS_HELPER,
    });

    expect(findAssigneePairs([form])).toEqual([]);
    expect(findOwnerDropdowns([form])).toEqual([]);
    expect(peoplePickers([form])[0]?.title).toBe("Episode Owners");
  });

  test("leaves one person question on its own alone, and a team and a user that are nobody's assignee", () => {
    const onePerson: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelFormModal title="Assign" formProps={{ fields: [
          { field: { title: true }, title: "Title", fieldType: FormFieldSchemaType.Text },
          { field: { assignedToUserId: true }, title: "Assign To User", fieldType: FormFieldSchemaType.Dropdown },
        ] }} />;`,
    });
    const membership: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelFormModal title="Add Member" formProps={{ fields: [
          { field: { teamId: true }, title: "Team", fieldType: FormFieldSchemaType.Dropdown },
          { field: { userId: true }, title: "User", fieldType: FormFieldSchemaType.Dropdown },
        ] }} />;`,
    });

    expect(findAssigneePairs([onePerson, membership])).toEqual([]);
  });

  test("reads a key for one team or user, never a list", () => {
    expect(SINGLE_ASSIGNEE_KEY.exec("defaultAssignToTeam")?.[1]).toBe("Team");
    expect(SINGLE_ASSIGNEE_KEY.exec("defaultAssignToUserId")?.[1]).toBe("User");
    expect(SINGLE_ASSIGNEE_KEY.exec("assignedToTeamId")?.[1]).toBe("Team");
    expect(SINGLE_ASSIGNEE_KEY.exec("ownerUser")?.[1]).toBe("User");
    expect(SINGLE_ASSIGNEE_KEY.test("episodeOwnerUsers")).toBe(false);
    expect(SINGLE_ASSIGNEE_KEY.test("ownerTeams")).toBe(false);
    expect(SINGLE_ASSIGNEE_KEY.test("ownerUserIds")).toBe(false);
    expect(SINGLE_ASSIGNEE_KEY.test("teamId")).toBe(false);
    expect(SINGLE_ASSIGNEE_KEY.test("userId")).toBe(false);
  });
});

describe("the project's forms", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read, owner pickers included", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
    /*
     * 30 owner rule forms, the two templates, scheduling maintenance, alert
     * episodes, the two owner pickers of a burn rate rule, the Forms On
     * Submit settings and the two grouping rules' Episode Owners.
     */
    expect(peoplePickers(forms).length).toBeGreaterThanOrEqual(39);
  });

  test("ask for owners only with the owners people picker", () => {
    expect(findOwnerDropdowns(forms).map(describeDropdown)).toEqual([]);
  });

  test("never ask for one team plus one user as an assignee or owner", () => {
    expect(findAssigneePairs(forms).map(describeAssigneePair)).toEqual([]);
  });

  /*
   * Their On-Call & Ownership step asked "Default Assign To Team" and
   * "Default Assign To User", which filled an assignee no page shows. It asks
   * for the episodes' owners instead, with one picker, and reads the old
   * pair only to say a rule still has it.
   */
  test.each([
    ["Incidents/Settings/IncidentGroupingRules.tsx"],
    ["Alerts/Settings/AlertGroupingRules.tsx"],
  ])(
    "the grouping rule form in %s asks for its episodes' owners with one picker, on On-Call & Ownership",
    (file: string) => {
      const form: FormFacts | undefined = forms.find(
        (candidate: FormFacts): boolean => {
          return (
            candidate.file.endsWith(`Pages/${file}`) &&
            candidate.host === "ModelTable"
          );
        },
      );

      expect(form).toBeDefined();

      expect(
        peoplePickers([form!]).map((field: FormFieldFacts): string => {
          return `${field.title} on ${field.stepId}`;
        }),
      ).toEqual(["GROUPING_RULE_COPY.episodeOwnersTitle on on-call-ownership"]);

      // Nothing on the form asks for the old pair any more.
      expect(
        form!.fields
          .filter((field: FormFieldFacts): boolean => {
            return (
              !field.isNeverShown &&
              (OLD_PAIR_KEY.test(field.key) ||
                (field.titleTexts || []).some((title: string): boolean => {
                  return OLD_PAIR_TITLE.test(title);
                }))
            );
          })
          .map((field: FormFieldFacts): string => {
            return field.title;
          }),
      ).toEqual([]);
    },
  );

  test("every owner rule form asks for its owners with one picker, on its Owners step", () => {
    const ownerRulesLabel: RegExp = / Owner Rules$/;
    const ownerRuleForms: Array<FormFacts> = forms.filter(
      (form: FormFacts): boolean => {
        return ownerRulesLabel.test(form.label);
      },
    );

    expect(ownerRuleForms.length).toBeGreaterThanOrEqual(30);

    for (const form of ownerRuleForms) {
      const pickers: Array<FormFieldFacts> = peoplePickers([form]);

      expect({
        form: `${form.file} ${form.label}`,
        pickers: pickers.map((field: FormFieldFacts): string => {
          return `${field.title} on ${field.stepId}`;
        }),
      }).toEqual({
        form: `${form.file} ${form.label}`,
        pickers: ["Owners on owners"],
      });
    }
  });

  /*
   * The template's owners used to walk an Owners step of their own; with
   * labels-not-a-step they fold under Advanced at the end of Incident
   * Details, beside the labels, as a maintenance template's do on Event.
   */
  test("the incident template asks for owners with one picker, folded on Incident Details", () => {
    const template: FormFacts | undefined = forms.find(
      (form: FormFacts): boolean => {
        return (
          form.file.endsWith(
            "Pages/Incidents/Settings/IncidentTemplates.tsx",
          ) && form.host === "ModelTable"
        );
      },
    );

    expect(template).toBeDefined();

    expect(
      peoplePickers([template!]).map((field: FormFieldFacts): string => {
        return `${field.title}: ${field.fieldType} on ${field.stepId}, folded: ${field.collapsibleSection !== undefined}`;
      }),
    ).toEqual([
      `Owners: ${PEOPLE_PICKER_FIELD_TYPE} on incident-details, folded: true`,
    ]);
    expect(
      (template!.steps || []).map((step: FormStepFacts): string | null => {
        return step.id;
      }),
    ).not.toContain("owners");
  });
});

describe("the project's source", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Array<{ file: string; code: string }> = files.map(
    (file: string) => {
      return {
        file: path.relative(REPOSITORY_ROOT, file),
        code: OWNER_DROPDOWN_COMMENT_FREE(fs.readFileSync(file, "utf8")),
      };
    },
  );

  test("says none of the retired owner labels", () => {
    const hits: Array<string> = [];

    for (const label of RETIRED_LABELS) {
      const quoted: RegExp = new RegExp(
        `(["'\`>])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'\`<])`,
      );

      for (const source of sources) {
        if (quoted.test(source.code)) {
          hits.push(`${source.file}: "${label}"`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  test("lists owners in one Owners card, never in a table per kind", () => {
    expect(
      sources
        .filter((source: { file: string; code: string }): boolean => {
          return OWNER_TABLE.test(source.code);
        })
        .map((source: { file: string; code: string }): string => {
          return source.file;
        }),
    ).toEqual([]);
  });

  test("the guards themselves tell a hit from a miss", () => {
    expect(OWNER_TABLE.test("<ModelTable<ProbeOwnerTeam>")).toBe(true);
    expect(OWNER_TABLE.test("<ModelTable<ProbeOwnerRule>")).toBe(false);
    expect(OWNER_LIST_KEY.test("ownerTeams")).toBe(true);
    expect(OWNER_LIST_KEY.test("incidentOwnerUsers")).toBe(true);
    expect(OWNER_LIST_KEY.test("ownerTeamIds")).toBe(true);
    expect(OWNER_LIST_KEY.test("owners")).toBe(false);
    expect(OWNER_LIST_KEY.test("defaultAssignToTeam")).toBe(false);
    expect(OWNER_LIST_KEY.test("ownerTeam")).toBe(false);
  });
});
