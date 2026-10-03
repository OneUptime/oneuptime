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
  isSwitchFieldType,
  scanFormFiles,
  SourceFileSystem,
} from "../../../Helpers/FormStepsScan";

/*
 * Settings that are only switches save when they are flipped.
 *
 * OneSwitchCardsGuard turns a card whose Edit dialog held ONE switch into a
 * switch. This is its twin for a card whose dialog held SEVERAL and nothing
 * else: the AI settings pages' "Investigate new incidents", "Draft a
 * postmortem when an incident resolves" and the rest, AI Insights' three
 * switches, Linked Alerts' two. Each yes or no took Edit, flip, Save (and a
 * wizard, once there were enough of them), and a card that writes every
 * field it holds saved them all together.
 *
 * Such a card is a ModelSwitchesCard (Common/UI/Components/ModelSwitch):
 * one row per switch, each saving its own column the moment it is flipped,
 * saying "Saved", moving back with the reason when the server refuses,
 * locking by its own column's permissions, naming the plan it needs, and
 * asking first where its definition says so.
 *
 * This guard reads every CardModelDetail in the frontends (FormStepsScan)
 * and fails on a card whose form is two or more switches and nothing else,
 * unless it is in SWITCH_CARDS_LEFT with why it is better as a form. It
 * also fails on an entry that is no longer such a card, so the list never
 * outlives what it lists.
 *
 * Tables are not judged here: a table row's edit form edits one row of
 * many. One-switch cards are OneSwitchCardsGuard's.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

export interface SwitchCardLeft {
  // Repository-relative, with "/".
  file: string;
  // The card's label: see getFormLabel in FormStepsScan.ts.
  form: string;
  // Why it stays a form.
  reason: string;
}

export const SWITCH_CARDS_LEFT: Array<SwitchCardLeft> = [
  {
    file: `${DASHBOARD}/Pages/Incidents/View/Settings.tsx`,
    form: "CardModelDetail: Incident Settings",
    reason:
      "Publishing an incident (Visible on Status Page) can send its 'created' notification to status page subscribers in the same save: the checkbox shown with it is what that one save does, not a setting, and Private Incident hides it from status pages again. The three are one decision about who hears of the incident, so they are saved together (event-and-runbook-switches-save-on-flip kept this card a form on purpose).",
  },
];

// The fields a card's form can show: every one but a never-shown registration.
function visibleFields(form: FormFacts): Array<FormFieldFacts> {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return !field.isNeverShown;
  });
}

/*
 * Two or more fields, every one of them a switch (a Toggle or a Checkbox),
 * on a card. A form whose fields cannot all be followed is not judged.
 */
export function isSwitchesOnlyCard(form: FormFacts): boolean {
  if (form.host !== "CardModelDetail" || form.uncountableReasons.length > 0) {
    return false;
  }

  const fields: Array<FormFieldFacts> = visibleFields(form);

  return (
    fields.length >= 2 &&
    fields.every((field: FormFieldFacts): boolean => {
      return isSwitchFieldType(field.fieldType);
    })
  );
}

function describeCard(form: FormFacts): string {
  return `${form.file}:${form.line} ${form.label} (${visibleFields(form)
    .map((field: FormFieldFacts): string => {
      return field.key;
    })
    .join(", ")})`;
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

function only(source: string): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem({ "Page.tsx": source }),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

const TOGGLE_A: string = `{ field: { isEnabled: true }, title: "Enabled", fieldType: FormFieldSchemaType.Toggle, required: false }`;
const TOGGLE_B: string = `{ field: { isPrivate: true }, title: "Private", fieldType: FormFieldSchemaType.Toggle, required: false }`;
const CHECKBOX: string = `{ field: { notify: true }, title: "Notify", fieldType: FormFieldSchemaType.Checkbox }`;
const NUMBER: string = `{ field: { limit: true }, title: "Limit", fieldType: FormFieldSchemaType.Number }`;

describe("the switches-only card detector", () => {
  test("a card whose form is two switches is switches only", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE_A}, ${TOGGLE_B}]} />;`,
        ),
      ),
    ).toBe(true);
  });

  test("so is one of switches and checkboxes", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE_A}, ${CHECKBOX}]} />;`,
        ),
      ),
    ).toBe(true);
  });

  test("a switch beside a number is a form", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE_A}, ${NUMBER}]} />;`,
        ),
      ),
    ).toBe(false);
  });

  test("one switch is OneSwitchCardsGuard's, not this guard's", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE_A}]} />;`,
        ),
      ),
    ).toBe(false);
  });

  test("a registration that is never shown does not count", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = () => <CardModelDetail name="Settings" formFields={[${TOGGLE_A}, ${TOGGLE_B}, { field: { projectId: true }, title: "Project", fieldType: FormFieldSchemaType.Text, showIf: () => { return false; } }]} />;`,
        ),
      ),
    ).toBe(true);
  });

  test("fields kept in a constant are followed", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const FIELDS = [${TOGGLE_A}, ${TOGGLE_B}];
           const Page = () => <CardModelDetail name="Settings" formFields={FIELDS} />;`,
        ),
      ),
    ).toBe(true);
  });

  test("a table row's form of switches is not a card", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = () => <ModelTable name="Rows" isEditable={true} formFields={[${TOGGLE_A}, ${TOGGLE_B}]} />;`,
        ),
      ),
    ).toBe(false);
  });

  test("fields it cannot follow are not judged", () => {
    expect(
      isSwitchesOnlyCard(
        only(
          `const Page = (props) => <CardModelDetail name="Settings" formFields={props.fields} />;`,
        ),
      ),
    ).toBe(false);
  });
});

describe("switches-only cards in the frontends", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  const cards: Array<FormFacts> = forms.filter(isSwitchesOnlyCard);

  const isListed: (form: FormFacts) => boolean = (form: FormFacts): boolean => {
    return SWITCH_CARDS_LEFT.some((entry: SwitchCardLeft): boolean => {
      return entry.file === form.file && entry.form === form.label;
    });
  };

  /*
   * A broken walk must not pass by finding nothing. The floors are about
   * half of what CI finds (it runs without ee/), so simplifying more cards
   * never trips them; that the detector really finds a card of switches is
   * pinned by the snippets above, not by one being left in the product.
   */
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(
      forms.filter((form: FormFacts): boolean => {
        return form.host === "CardModelDetail";
      }).length,
    ).toBeGreaterThan(100);
  });

  test("every card that is only switches saves them on flip, or is listed with why", () => {
    /*
     * A card whose Edit dialog holds nothing but switches. Draw it as a
     * ModelSwitchesCard (Common/UI/Components/ModelSwitch/
     * ModelSwitchesCard): each switch saves when it is flipped. Only if
     * its switches must be saved together, list it in SWITCH_CARDS_LEFT
     * with why.
     */
    expect(
      cards
        .filter((form: FormFacts): boolean => {
          return !isListed(form);
        })
        .map(describeCard),
    ).toEqual([]);
  });

  test("every listed card is still only switches: a converted card leaves the list", () => {
    expect(
      SWITCH_CARDS_LEFT.filter((entry: SwitchCardLeft): boolean => {
        return !cards.some((form: FormFacts): boolean => {
          return entry.file === form.file && entry.form === form.label;
        });
      }).map((entry: SwitchCardLeft): string => {
        return `${entry.file}: ${entry.form}`;
      }),
    ).toEqual([]);
  });

  test("each listed card is listed once, with a reason", () => {
    const keys: Array<string> = SWITCH_CARDS_LEFT.map(
      (entry: SwitchCardLeft): string => {
        return `${entry.file}::${entry.form}`;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);

    for (const entry of SWITCH_CARDS_LEFT) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  /*
   * The pages converted with this guard: every AI behaviour, and Linked
   * Alerts. Each draws the shared switch card and no card of switches.
   */
  test.each([
    [`${DASHBOARD}/Pages/Incidents/Settings/IncidentAISettings.tsx`],
    [`${DASHBOARD}/Pages/Alerts/Settings/AlertAISettings.tsx`],
    [`${DASHBOARD}/Pages/AIInsights/Settings.tsx`],
    [`${DASHBOARD}/Pages/Settings/AIFeatures.tsx`],
    [`${DASHBOARD}/Pages/Incidents/Settings/IncidentLinkedAlertsSettings.tsx`],
  ])("%s draws its switches as switches", (file: string) => {
    const switchCards: Array<string> = forms
      .filter((form: FormFacts): boolean => {
        return (
          form.file === file &&
          form.host === "CardModelDetail" &&
          visibleFields(form).some((field: FormFieldFacts): boolean => {
            return isSwitchFieldType(field.fieldType);
          })
        );
      })
      .map(describeCard);

    expect(switchCards).toEqual([]);

    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );

    expect([
      file,
      /<ModelSwitchesCard<|<ModelSwitchCard<|<ProjectAiSwitchesCard\b/.test(
        source,
      ),
    ]).toEqual([file, true]);
  });
});
