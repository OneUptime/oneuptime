import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  DESCRIPTION_KINDS,
  DescriptionKind,
  DescriptionScanner,
  FoundDescription,
  memoryReader,
  scanProductDescriptions,
} from "./DescriptionScan";

/*
 * Every description a person reads while setting something up is short.
 *
 * "The description is too long as well, so can you please optimise that?
 * Please also do that for other places in the project where the description
 * is long. Can you please audit the entire software to make it as simple as
 * possible to use?" (the maintainer, on a switch whose five-line
 * description explained both of its states)
 *
 * Fields, switches, cards, dialogs and empty lists across the product had
 * grown descriptions of three to six lines: every edge case, every
 * exception, how it works inside. Each now says what the setting does in a
 * short sentence (for a switch, what "on" does), and this guard keeps it so
 * in every frontend: the Dashboard, the Admin Dashboard, the Status Page,
 * Accounts, the Public Dashboard, Common's UI components and, where ee/ is
 * checked out, the Enterprise dashboards. DescriptionScan reads their
 * syntax, follows a constant, a copy object, a translationKey() or a nested
 * locale key to the words it holds, and sorts each description by where it
 * is drawn. Each kind has a limit:
 *
 *   - under a label (a form field, a switch, a dialog, an empty list, a
 *     folded section, a choice, a detail row, a page header): LINE_LIMIT,
 *     two short lines in the column it sits in;
 *   - a card's description, which runs across the page beside its title:
 *     CARD_LIMIT, two lines there.
 *
 * A form field with no description of its own shows its model column's
 * (BasicModelForm), written for the API reference: that is held to
 * LINE_LIMIT too. Give the field a short description of its own rather
 * than cutting the column's.
 *
 * Help that waits to be asked for - an (i) tooltip, a table's help dialog
 * (helpContent), a setup guide, the docs - is not measured: that is where
 * the detail a description leaves out belongs. A description that has to
 * stay longer goes in ALLOWED with the reason.
 */

// Two short lines under a label.
const LINE_LIMIT: number = 150;
// Two lines across the page, beside a card's title.
const CARD_LIMIT: number = 210;

const LIMITS: Record<DescriptionKind, number> = {
  field: LINE_LIMIT,
  column: LINE_LIMIT,
  detail: LINE_LIMIT,
  section: LINE_LIMIT,
  option: LINE_LIMIT,
  switch: LINE_LIMIT,
  card: CARD_LIMIT,
  dialog: LINE_LIMIT,
  empty: LINE_LIMIT,
  page: LINE_LIMIT,
};

interface AllowedDescription {
  kind: DescriptionKind;
  text: string;
  reason: string;
}

/*
 * Descriptions allowed past their limit, each with the reason. Empty: none
 * needs it. An entry that no longer appears, or fits, is reported, so the
 * list cannot outlive its reasons.
 */
const ALLOWED: ReadonlyArray<AllowedDescription> = [];

function isAllowed(
  item: FoundDescription,
  allowed: ReadonlyArray<AllowedDescription>,
): boolean {
  return allowed.some((entry: AllowedDescription): boolean => {
    return entry.kind === item.kind && entry.text === item.text;
  });
}

// The descriptions past their kind's limit, as a reader can find them.
function tooLong(
  found: ReadonlyArray<FoundDescription>,
  allowed: ReadonlyArray<AllowedDescription>,
): Array<string> {
  return found
    .filter((item: FoundDescription): boolean => {
      return item.text.length > LIMITS[item.kind] && !isAllowed(item, allowed);
    })
    .map((item: FoundDescription): string => {
      const written: string = item.writtenAt
        ? ` (written at ${item.writtenAt})`
        : "";

      return `${item.where}${written} [${item.kind}, ${item.text.length} > ${LIMITS[item.kind]}]: ${item.text}`;
    });
}

// Allowed entries that are no longer on screen, or no longer too long.
function staleEntries(
  found: ReadonlyArray<FoundDescription>,
  allowed: ReadonlyArray<AllowedDescription>,
): Array<string> {
  return allowed
    .filter((entry: AllowedDescription): boolean => {
      return !found.some((item: FoundDescription): boolean => {
        return (
          item.kind === entry.kind &&
          item.text === entry.text &&
          item.text.length > LIMITS[item.kind]
        );
      });
    })
    .map((entry: AllowedDescription): string => {
      return `${entry.kind}: ${entry.text}`;
    });
}

function textsOfKind(
  found: ReadonlyArray<FoundDescription>,
  kind: DescriptionKind,
): Array<string> {
  return found
    .filter((item: FoundDescription): boolean => {
      return item.kind === kind;
    })
    .map((item: FoundDescription): string => {
      return item.text;
    });
}

describe("descriptions across the product are short", () => {
  const found: Array<FoundDescription> = scanProductDescriptions();

  // A guard that reads nothing passes everything.
  test("reads every kind of description, however its words are held", () => {
    const minimums: Record<DescriptionKind, number> = {
      field: 800,
      column: 400,
      detail: 30,
      section: 100,
      option: 20,
      switch: 50,
      card: 800,
      dialog: 200,
      empty: 300,
      page: 2,
    };

    for (const kind of DESCRIPTION_KINDS) {
      expect({
        kind: kind,
        atLeast: textsOfKind(found, kind).length >= minimums[kind],
      }).toEqual({ kind: kind, atLeast: true });
    }

    // A field's own literal.
    expect(textsOfKind(found, "field")).toContain(
      "Leave empty to match any title.",
    );
    // A constant in another module.
    expect(textsOfKind(found, "field")).toContain(
      "The host or IP your apps connect to (server.address), never localhost. For an in-cluster or private address, add @<cluster>: pg.shop.svc:5432@prod-eu.",
    );
    // A copy object's switch sentence.
    expect(textsOfKind(found, "switch")).toContain(
      "Off: subscribers are sent nothing, not even reports. They are kept, and visitors can still subscribe.",
    );
    // Both forms of a count-dependent sentence (translatePlural).
    expect(textsOfKind(found, "dialog")).toEqual(
      expect.arrayContaining([
        "Whether the {{count}} person this level notifies can actually be paged.",
        "Whether the {{count}} people this level notifies can actually be paged.",
      ]),
    );
    // A TranslatedSentence template beside the sentences around it.
    expect(textsOfKind(found, "dialog")).toContain(
      "This monitor gets a new random address, and {{address}} stops working at once. Your custom address is removed. Update everything that emails it.",
    );
    // The Admin Dashboard's nested locale key, read as its English.
    expect(textsOfKind(found, "dialog")).toContain(
      "Pick a project and one of its teams. The {{userCount}} selected user(s) are invited to that team.",
    );
    // A model column's description, shown under a field with none.
    expect(textsOfKind(found, "column")).toContain(
      "Regular expression pattern to match monitor names. Leave empty to match any monitor name. Example: 'prod-.*' matches monitors starting with 'prod-'.",
    );
    expect(textsOfKind(found, "empty")).toContain(
      "No HPAs yet. They appear once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes horizontalpodautoscalers.",
    );
    expect(textsOfKind(found, "card")).toContain(
      "Group and one-on-one chats your notification rules can post to. Add the OneUptime app to a chat in Microsoft Teams to list it here. Use Send Test to confirm OneUptime can post to a chat.",
    );
  });

  test.each(DESCRIPTION_KINDS as Array<DescriptionKind>)(
    "every %s description is within its limit",
    (kind: DescriptionKind) => {
      const ofKind: Array<FoundDescription> = found.filter(
        (item: FoundDescription): boolean => {
          return item.kind === kind;
        },
      );

      expect(tooLong(ofKind, ALLOWED)).toEqual([]);
    },
  );

  test("every allowed description is still on screen and still too long", () => {
    expect(staleEntries(found, ALLOWED)).toEqual([]);
  });
});

/*
 * The guard's own proof: a handful of files held in memory, one long and
 * one short description in each family, plus help and layouts it must leave
 * alone.
 */
describe("the short descriptions guard", () => {
  const ROOT: string = path.join(path.sep, "fixture-repo");
  const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
  const ADMIN: string = "packages/App/FeatureSet/AdminDashboard/src";

  // A sentence of exactly `length` characters that starts with `start`.
  function sentenceOf(start: string, length: number): string {
    let text: string = start;

    while (text.length < length) {
      text += " and every case";
    }

    return `${text.slice(0, length - 1).trimEnd()}.`;
  }

  const LONG: Record<string, string> = {
    field: sentenceOf("Explains the name field", 190),
    constant: sentenceOf("Explains the limit from a shared constant", 170),
    column: sentenceOf("Explains the size column for the API", 180),
    card: sentenceOf("Explains the widgets card", 240),
    // A card drawn only sometimes: its props behind a condition.
    conditionalCard: sentenceOf("Explains the recordings card", 245),
    empty: sentenceOf("No widgets yet, and here is why", 160),
    emptyState: sentenceOf("Nothing to show, and here is why", 170),
    switch: sentenceOf("Turns widgets on and explains both states", 200),
    dialog: sentenceOf("Deletes the widget and explains it all", 175),
    sentence: sentenceOf("Resets {{name}} and explains it all", 165),
    nested: sentenceOf("Invites them and explains the invitation", 155),
    mediumField: sentenceOf("A field that runs a little long", 180),
    // A column line a field asks for by name (hideColumnDescription: false).
    shownColumn: sentenceOf("Explains the depth column for the API", 182),
    // Count-dependent sentences: each form a reader can see is measured.
    pluralOne: sentenceOf("Archives {{count}} widget and explains it", 160),
    pluralOther: sentenceOf("Archives {{count}} widgets and explains it", 158),
    pluralConstant: sentenceOf("No {{count}} widgets match, and why", 163),
    pluralSentence: sentenceOf(
      "Moves {{count}} widgets to {{place}} and why",
      171,
    ),
  };

  const SHORT: Record<string, string> = {
    field: "Pick a colour.",
    switch: "Stops checks while on.",
    card: "Widgets you added.",
    mediumCard: sentenceOf("A card can run a little longer", 180),
    nested: "Invites them to the team.",
    pluralOne: "Pauses {{count}} widget.",
    pluralOther: "Pauses {{count}} widgets.",
  };

  const NEVER_MEASURED: Record<string, string> = {
    tooltip: sentenceOf("A tooltip explains everything", 220),
    help: sentenceOf("The help dialog explains everything", 230),
    layout: sentenceOf("A paragraph in a laid-out dialog", 200),
    // The column line of a field that draws none (hideColumnDescription).
    hiddenColumn: sentenceOf("Explains the weight column for the API", 185),
  };

  const files: Record<string, string> = {
    [path.join(ROOT, DASHBOARD, "Pages", "Widgets.tsx")]: `
import React from "react";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Widget from "Common/Models/DatabaseModels/Widget";
import { WIDGET_LIMIT_DESCRIPTION, NO_MATCHING_WIDGETS } from "./WidgetCopy";

export default function Widgets() {
  return (
    <div>
      <ModelTable
        modelType={Widget}
        cardProps={{ title: "Widgets", description: "${LONG["card"]}" }}
        noItemsMessage="${LONG["empty"]}"
        helpContent={{ title: "About widgets", description: "${NEVER_MEASURED["help"]}" }}
        formFields={[
          { field: { name: true }, title: "Name", fieldType: FormFieldSchemaType.Text, description: "${LONG["field"]}" },
          { field: { size: true }, title: "Size", fieldType: FormFieldSchemaType.Number },
          { field: { limit: true }, title: "Limit", fieldType: FormFieldSchemaType.Number, description: WIDGET_LIMIT_DESCRIPTION },
          { field: { color: true }, title: "Colour", fieldType: FormFieldSchemaType.Text, description: "${SHORT["field"]}" },
          { field: { note: true }, title: "Note", fieldType: FormFieldSchemaType.Text, description: "${LONG["mediumField"]}" },
          { field: { weight: true }, title: "Weight", fieldType: FormFieldSchemaType.Number, hideColumnDescription: true },
          { field: { depth: true }, title: "Depth", fieldType: FormFieldSchemaType.Number, hideColumnDescription: false },
        ]}
      />
      <ModelTable modelType={Widget} cardProps={{ title: "Recent", description: "${SHORT["card"]}" }} />
      <ModelTable
        modelType={Widget}
        cardProps={isMinimal ? undefined : { title: "All recordings", description: "${LONG["conditionalCard"]}" }}
      />
      <Card title="Usage" description="${SHORT["mediumCard"]}" />
      <Toggle title="Enabled" description="${LONG["switch"]}" value={true} onChange={() => {}} />
      <Toggle title="Paused" description="${SHORT["switch"]}" value={false} onChange={() => {}} />
      <ConfirmModal title="Delete widget?" description="${LONG["dialog"]}" submitButtonText="Delete" onSubmit={() => {}} onClose={() => {}} />
      <ConfirmModal
        title="Reset widget?"
        description={<span><TranslatedSentence template="${LONG["sentence"]}" slots={{ name: <b>w</b> }} /></span>}
        submitButtonText="Reset"
        onSubmit={() => {}}
        onClose={() => {}}
      />
      <EmptyState id="no-widgets" title="No widgets" description="${LONG["emptyState"]}" />
      <ConfirmModal
        title="Archive widgets?"
        description={translator.translatePlural({ one: "${LONG["pluralOne"]}", other: "${LONG["pluralOther"]}" }, count)}
        submitButtonText="Archive"
        onSubmit={() => {}}
        onClose={() => {}}
      />
      <ConfirmModal
        title="Pause widgets?"
        description={translator.translatePlural({ one: "${SHORT["pluralOne"]}", other: "${SHORT["pluralOther"]}" }, count)}
        submitButtonText="Pause"
        onSubmit={() => {}}
        onClose={() => {}}
      />
      <EmptyState id="no-matching-widgets" title="No matches" description={translator.translatePlural(NO_MATCHING_WIDGETS, count)} />
      <ConfirmModal
        title="Move widgets?"
        description={<span><TranslatedSentence template={{ one: "Moves {{count}} widget to {{place}}.", other: "${LONG["pluralSentence"]}" }} count={count} slots={{ place: <b>p</b> }} /></span>}
        submitButtonText="Move"
        onSubmit={() => {}}
        onClose={() => {}}
      />
      <InfoTooltip description="${NEVER_MEASURED["tooltip"]}" />
      <ConfirmModal
        title="How it works"
        description={<div><p>${NEVER_MEASURED["layout"]}</p><ul><li>One</li></ul></div>}
        submitButtonText="OK"
        onSubmit={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}
`,
    [path.join(ROOT, DASHBOARD, "Pages", "WidgetCopy.ts")]: `
export const WIDGET_LIMIT_DESCRIPTION: string = "${LONG["constant"]}";

export const NO_MATCHING_WIDGETS: PluralTemplate = {
  one: "No widget matches.",
  other: "${LONG["pluralConstant"]}",
};
`,
    [path.join(
      ROOT,
      "packages",
      "Common",
      "Models",
      "DatabaseModels",
      "Widget.ts",
    )]: `
export default class Widget extends BaseModel {
  @TableColumn({ type: TableColumnType.Number, description: "${LONG["column"]}" })
  public size?: number = undefined;

  @TableColumn({ type: TableColumnType.ShortText, description: "A short column." })
  public color?: string = undefined;

  @TableColumn({ type: TableColumnType.Number, description: "${NEVER_MEASURED["hiddenColumn"]}" })
  public weight?: number = undefined;

  @TableColumn({ type: TableColumnType.Number, description: "${LONG["shownColumn"]}" })
  public depth?: number = undefined;
}
`,
    [path.join(ROOT, ADMIN, "Pages", "Users.tsx")]: `
export default function Users() {
  return (
    <div>
      <ConfirmModal title="Invite?" description={t("pages.users.inviteDescription")} submitButtonText="Invite" onSubmit={() => {}} onClose={() => {}} />
      <ConfirmModal title="Add?" description={t("pages.users.addDescription")} submitButtonText="Add" onSubmit={() => {}} onClose={() => {}} />
    </div>
  );
}
`,
    [path.join(ROOT, ADMIN, "Locales", "en.json")]: JSON.stringify({
      pages: {
        users: {
          inviteDescription: LONG["nested"],
          addDescription: SHORT["nested"],
        },
      },
    }),
  };

  const found: Array<FoundDescription> = new DescriptionScanner({
    repoRoot: ROOT,
    reader: memoryReader(files),
  }).scan([DASHBOARD, ADMIN]);

  // The line of a fixture file that holds `needle`, counted from 1.
  function lineOf(file: string, needle: string): number {
    const source: string = files[path.join(ROOT, file)] || "";

    return source.slice(0, source.indexOf(needle)).split("\n").length;
  }

  function kindOf(text: string): Array<DescriptionKind> {
    return found
      .filter((item: FoundDescription): boolean => {
        return item.text === text;
      })
      .map((item: FoundDescription): DescriptionKind => {
        return item.kind;
      });
  }

  test("flags a long description in every family", () => {
    expect(kindOf(LONG["field"]!)).toEqual(["field"]);
    expect(kindOf(LONG["constant"]!)).toEqual(["field"]);
    expect(kindOf(LONG["column"]!)).toEqual(["column"]);
    expect(kindOf(LONG["card"]!)).toEqual(["card"]);
    expect(kindOf(LONG["conditionalCard"]!)).toEqual(["card"]);
    expect(kindOf(LONG["empty"]!)).toEqual(["empty"]);
    expect(kindOf(LONG["emptyState"]!)).toEqual(["empty"]);
    expect(kindOf(LONG["switch"]!)).toEqual(["switch"]);
    expect(kindOf(LONG["dialog"]!)).toEqual(["dialog"]);
    expect(kindOf(LONG["sentence"]!)).toEqual(["dialog"]);
    expect(kindOf(LONG["nested"]!)).toEqual(["dialog"]);
    expect(kindOf(LONG["mediumField"]!)).toEqual(["field"]);
    expect(kindOf(LONG["shownColumn"]!)).toEqual(["column"]);
    /*
     * Both forms of a plural written in place, the long form of a plural
     * constant, and the longer form of a plural TranslatedSentence.
     */
    expect(kindOf(LONG["pluralOne"]!)).toEqual(["dialog"]);
    expect(kindOf(LONG["pluralOther"]!)).toEqual(["dialog"]);
    expect(kindOf(LONG["pluralConstant"]!)).toEqual(["empty"]);
    expect(kindOf(LONG["pluralSentence"]!)).toEqual(["dialog"]);

    const reported: Array<string> = tooLong(found, []);

    for (const text of Object.values(LONG)) {
      expect(
        reported.some((line: string): boolean => {
          return line.endsWith(`: ${text}`);
        }),
      ).toBe(true);
    }

    expect(reported).toHaveLength(Object.keys(LONG).length);
  });

  test("names where a description's words are written", () => {
    const fromConstant: FoundDescription | undefined = found.find(
      (item: FoundDescription): boolean => {
        return item.text === LONG["constant"];
      },
    );
    const fromColumn: FoundDescription | undefined = found.find(
      (item: FoundDescription): boolean => {
        return item.text === LONG["column"];
      },
    );

    const page: string = `${DASHBOARD}/Pages/Widgets.tsx`;
    const copy: string = `${DASHBOARD}/Pages/WidgetCopy.ts`;
    const model: string = "packages/Common/Models/DatabaseModels/Widget.ts";

    // Drawn on the page, written in the module it imports.
    expect(fromConstant?.where).toBe(
      `${page}:${lineOf(page, "{ field: { limit: true }")}`,
    );
    expect(fromConstant?.writtenAt).toBe(
      `${copy}:${lineOf(copy, LONG["constant"]!)}`,
    );
    // Drawn under the Size field, written on the model's column.
    expect(fromColumn?.where).toBe(
      `${page}:${lineOf(page, "{ field: { size: true }")}`,
    );
    expect(fromColumn?.owner).toBe("Widget.size");
    expect(fromColumn?.writtenAt).toBe(
      `${model}:${lineOf(model, LONG["column"]!)}`,
    );
  });

  test("lets a short description through, and a card runs longer than a field", () => {
    expect(kindOf(SHORT["field"]!)).toEqual(["field"]);
    expect(kindOf(SHORT["switch"]!)).toEqual(["switch"]);
    expect(kindOf(SHORT["card"]!)).toEqual(["card"]);
    expect(kindOf(SHORT["nested"]!)).toEqual(["dialog"]);
    expect(kindOf(SHORT["pluralOne"]!)).toEqual(["dialog"]);
    expect(kindOf(SHORT["pluralOther"]!)).toEqual(["dialog"]);
    // A plural constant's short form is read too, and lets the guard pass it.
    expect(kindOf("No widget matches.")).toEqual(["empty"]);
    // 180 characters: within a card's limit, past a field's.
    expect(kindOf(SHORT["mediumCard"]!)).toEqual(["card"]);
    expect(SHORT["mediumCard"]!.length).toBe(LONG["mediumField"]!.length);

    const reported: string = tooLong(found, []).join("\n");

    for (const text of Object.values(SHORT)) {
      expect(reported).not.toContain(text);
    }

    // A field with a description of its own never shows its column's.
    expect(kindOf("A short column.")).toEqual([]);
  });

  test("leaves help that waits to be asked for, and laid-out text, alone", () => {
    for (const text of Object.values(NEVER_MEASURED)) {
      expect(kindOf(text)).toEqual([]);
    }
  });

  test("an allowed description passes, and an entry that no longer applies is named", () => {
    const allowed: Array<AllowedDescription> = [
      {
        kind: "switch",
        text: LONG["switch"]!,
        reason: "A fixture: kept long to prove the allowance.",
      },
      {
        kind: "field",
        text: SHORT["field"]!,
        reason: "A fixture: short, so the allowance is stale.",
      },
      {
        kind: "dialog",
        text: "A description no longer on screen.",
        reason: "A fixture: gone, so the allowance is stale.",
      },
    ];

    expect(
      tooLong(found, allowed).some((line: string): boolean => {
        return line.endsWith(`: ${LONG["switch"]}`);
      }),
    ).toBe(false);
    expect(staleEntries(found, allowed)).toEqual([
      `field: ${SHORT["field"]}`,
      "dialog: A description no longer on screen.",
    ]);
  });
});
