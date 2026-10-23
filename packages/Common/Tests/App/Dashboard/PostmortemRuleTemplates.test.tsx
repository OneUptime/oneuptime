import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import PostmortemRuleTemplates, {
  POSTMORTEM_RULE_TEMPLATE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/PostmortemRuleTemplates";
import {
  POSTMORTEM_RULE_MORE_TEMPLATES,
  POSTMORTEM_RULE_STANDARD_OUTLINE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/PostmortemRulesCopy";
import TableBody from "../../../UI/Components/Table/TableBody";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
} from "../../../UI/Components/Table/TableLayout";
import FieldType from "../../../UI/Components/Types/FieldType";

/*
 * A postmortem rule's templates, in the Templates column of Incidents → AI
 * → Settings → More settings → Postmortem rules, in the Dashboard's real
 * German words: one template a line, as every list of records in a table
 * is drawn - the first three by name, then a button that says how many
 * more there are ("2 weitere Vorlagen") and shows them, or all four when
 * there are four - each cut short in
 * a table's row with its whole name under the pointer, and run onto the
 * next line in a phone's card. No template: the standard outline, in grey.
 *
 * It used to be one line of names joined with commas, which on a 1280px
 * screen pushed the rule's Status out of the card.
 */

const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(
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
      "de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

interface Row {
  _id: string;
  templates: Array<{ templateName?: string | undefined }>;
}

function rule(...names: Array<string>): Row {
  return {
    _id: "56000000-0000-4000-8000-000000000001",
    templates: names.map((name: string) => {
      return { templateName: name };
    }),
  };
}

// The cell in a real table body: a row of a table, or a phone's card.
function renderCell(row: Row, isMobile: boolean): HTMLElement {
  const body: ReactElement = (
    <TableBody<Row>
      id="postmortem-rules-body"
      data={[row]}
      columns={[
        {
          title: "Templates",
          key: "templates",
          type: FieldType.EntityArray,
          getElement: (item: Row): ReactElement => {
            return <PostmortemRuleTemplates templates={item.templates} />;
          },
        },
      ]}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={isMobile}
    />
  );

  render(isMobile ? body : <table>{body}</table>);

  return document.getElementById("postmortem-rules-body") as HTMLElement;
}

function names(root: HTMLElement): Array<string> {
  return within(root)
    .queryAllByTestId(POSTMORTEM_RULE_TEMPLATE_TEST_ID)
    .map((name: HTMLElement): string => {
      return name.textContent || "";
    });
}

// The box each name is drawn in: the list's item.
function itemsOf(root: HTMLElement): Array<HTMLElement> {
  return within(root)
    .queryAllByTestId(POSTMORTEM_RULE_TEMPLATE_TEST_ID)
    .map((name: HTMLElement): HTMLElement => {
      return name.parentElement as HTMLElement;
    });
}

describe("a rule's templates in a row of the table", () => {
  test("one a line, by name, each cut short at the column with its whole name under the pointer", () => {
    const body: HTMLElement = renderCell(
      rule("Security incident", "Database outage"),
      false,
    );

    expect(names(body)).toEqual(["Database outage", "Security incident"]);

    for (const item of itemsOf(body)) {
      expect(item.className).toBe(TABLE_LIST_ITEM_CLASS_NAME);
      expect(item).toHaveClass("truncate");
    }
  });

  test("after three, the button says how many more in German, and shows them", () => {
    const body: HTMLElement = renderCell(
      rule(
        "Customer-facing outage",
        "Database outage",
        "Network partition",
        "Payments outage",
        "Security incident",
      ),
      false,
    );

    expect(names(body)).toEqual([
      "Customer-facing outage",
      "Database outage",
      "Network partition",
    ]);

    fireEvent.click(
      within(body).getByRole("button", { name: "2 weitere Vorlagen" }),
    );

    expect(names(body)).toHaveLength(5);
    expect(
      within(body).getByRole("button", { name: "Weniger anzeigen" }),
    ).toBeInTheDocument();
  });

  /*
   * A cell's list never folds a single item behind "1 more": its button
   * takes a line of its own, a taller one than the item it would hide
   * (TableColumnListFold, OneUptime issue #5187). So a fourth template is
   * listed by name, and the button, when there is one, says two or more.
   */
  test("a fourth template is listed rather than folded behind '1 weitere Vorlage'", () => {
    const body: HTMLElement = renderCell(rule("A", "B", "C", "D"), false);

    expect(names(body)).toEqual(["A", "B", "C", "D"]);
    expect(within(body).queryByRole("button")).not.toBeInTheDocument();
  });

  test("no template is the standard outline, in German and in grey", () => {
    const body: HTMLElement = renderCell(rule(), false);

    const standard: HTMLElement = within(body).getByText(
      GERMAN[POSTMORTEM_RULE_STANDARD_OUTLINE]!,
    );

    expect(GERMAN[POSTMORTEM_RULE_STANDARD_OUTLINE]).toBe("Standardgliederung");
    expect(standard).toHaveClass("text-gray-500");
    expect(names(body)).toEqual([]);
  });
});

describe("a rule's templates in a phone's card", () => {
  test("each name runs onto the next line instead of ending in an ellipsis", () => {
    const body: HTMLElement = renderCell(
      rule(
        "Network partition between the eu-west and us-east regions",
        "Database outage",
      ),
      true,
    );

    expect(names(body)).toEqual([
      "Database outage",
      "Network partition between the eu-west and us-east regions",
    ]);

    for (const item of itemsOf(body)) {
      expect(item.className).toBe(TABLE_CARD_LIST_ITEM_CLASS_NAME);
      expect(item).not.toHaveClass("truncate");
    }

    // The card names the field over the list.
    expect(within(body).getByText("Vorlagen").tagName).toBe("DT");
  });
});

describe("the words", () => {
  test("every language words the button with its own plural forms", () => {
    expect(POSTMORTEM_RULE_MORE_TEMPLATES).toEqual({
      one: "{{count}} more template",
      other: "{{count}} more templates",
    });
    expect(GERMAN[POSTMORTEM_RULE_MORE_TEMPLATES.other]).toBe(
      "{{count}} weitere Vorlagen",
    );
    expect(GERMAN[`${POSTMORTEM_RULE_MORE_TEMPLATES.other}_one`]).toBe(
      "{{count}} weitere Vorlage",
    );
  });
});
