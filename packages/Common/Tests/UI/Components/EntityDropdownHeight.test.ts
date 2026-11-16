import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An EntityDropdown is as tall as a Dropdown: 40px.
 *
 * A rule's condition puts a Dropdown (the field, the operator) beside an
 * EntityDropdown (the value: "Select one or more" services). The Dropdown
 * is at least 40px tall; the EntityDropdown's box was its text's line and
 * padding, 38px, so the value sat 2px short of the pickers beside it and
 * the row looked crooked (#9116).
 *
 * jsdom lays nothing out, so this reads the classes: the Dropdown's control
 * is min-h-[40px]; the EntityDropdown's search box is its input plus the
 * box's 1px border each side (38px + 2px), and its picked value's button
 * lies over the box's border (-m-px), so it is the box's whole 40px.
 */

const COMPONENTS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Components",
);

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(COMPONENTS, file), "utf8");
};

describe("an EntityDropdown is as tall as a Dropdown", () => {
  const dropdown: string = read("Dropdown/Dropdown.tsx");
  const entityDropdown: string = read("EntityDropdown/EntityDropdown.tsx");

  test("the Dropdown's control is at least 40px", () => {
    expect(dropdown).toContain("!min-h-[40px]");
  });

  test("the search box's input is 38px inside the box's 1px border", () => {
    expect(entityDropdown).toMatch(
      /className="block min-h-\[38px\] w-full rounded-lg bg-transparent/,
    );
  });

  test("the picked value's button, over the box's border, is 40px", () => {
    expect(entityDropdown).toMatch(
      /-m-px flex min-h-\[40px\] w-\[calc\(100%\+2px\)\]/,
    );
  });
});
