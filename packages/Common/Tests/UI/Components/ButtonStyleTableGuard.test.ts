// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";

/*
 * Every button style has one job, written in the rulebook's table.
 *
 * ButtonStyleType had 17 styles, and four of them - a pale indigo
 * SECONDARY, a green SUCCESS and a yellow WARNING and WARNING_OUTLINE - had
 * no row in the rulebook's "which style when" table: one page used SUCCESS
 * (a playbook run's Approve) and nothing used the rest. Each was one more
 * look for a job another style already did (#9195). They are gone, and this
 * keeps the enum and the table in step: a style the table does not name
 * fails here, and so does a row for a style that is gone.
 */

const README: string = fs.readFileSync(
  path.resolve(__dirname, "../../../../../Docs/ux/README.md"),
  "utf8",
);

// The style names in the table under "Each button style has one job".
function stylesInTheTable(): Array<string> {
  const start: number = README.indexOf("**Each button style has one job");

  expect(start).toBeGreaterThan(-1);

  const rows: Array<string> = README.slice(start)
    .split("\n")
    .slice(1)
    .map((line: string): string => {
      return line.trim();
    });
  const firstRow: number = rows.findIndex((line: string): boolean => {
    return line.startsWith("| Style |");
  });

  expect(firstRow).toBeGreaterThan(-1);

  const names: Array<string> = [];

  for (const row of rows.slice(firstRow + 2)) {
    if (!row.startsWith("|")) {
      break;
    }

    const styleCell: string = row.split("|")[1] || "";

    for (const match of styleCell.matchAll(/`([A-Z_]+)`/gu)) {
      names.push(match[1]!);
    }
  }

  return names;
}

const STYLE_NAMES: Array<string> = Object.keys(ButtonStyleType).filter(
  (key: string): boolean => {
    return Number.isNaN(Number(key));
  },
);

describe("each button style has one job, in the rulebook's table", () => {
  test("the table is read", () => {
    expect(stylesInTheTable().length).toBeGreaterThan(5);
  });

  test("every style is in the table", () => {
    const table: Array<string> = stylesInTheTable();

    expect(
      STYLE_NAMES.filter((name: string): boolean => {
        return !table.includes(name);
      }),
    ).toEqual([]);
  });

  test("the table names no style that is gone", () => {
    expect(
      stylesInTheTable().filter((name: string): boolean => {
        return !STYLE_NAMES.includes(name);
      }),
    ).toEqual([]);
  });

  test("the folded styles stay folded", () => {
    for (const gone of ["SECONDARY", "SUCCESS", "WARNING", "WARNING_OUTLINE"]) {
      expect(STYLE_NAMES).not.toContain(gone);
    }
  });
});
