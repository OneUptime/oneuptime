import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import PeopleAvatar from "../../../UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { selectorsDeclaring } from "./ThemeStylesheet";

/*
 * A team's avatar is a dark slate tile (PeopleAvatar's group palette). On
 * the dark theme's surfaces it all but vanished - in the people row of an
 * incident's header, where the owner teams now sit beside the state, as on
 * an Owners page - so Theme.css lifts the group palette a few steps there.
 * The palette lives in the component and the lift in the stylesheet; this
 * holds the two together: every tile colour a team can get is lifted, and a
 * person's coloured circle is left as it is.
 */

const LIFTED_FROM: string = "#64748b var(--tw-gradient-from-position)";
const LIFTED_TO: string = "#334155 var(--tw-gradient-to-position)";

// Enough names to land on every entry of a five-colour palette.
const NAMES: Array<string> = Array.from(
  { length: 60 },
  (_value: unknown, index: number): string => {
    return `Team ${index} ${String.fromCharCode(65 + (index % 26))}`;
  },
);

function gradientFromClasses(
  kind: PeoplePickerKind,
  names: Array<string>,
): Set<string> {
  const classes: Set<string> = new Set<string>();

  for (const name of names) {
    const view: RenderResult = render(
      <PeopleAvatar item={{ kind: kind, name: name }} size="chip" />,
    );

    for (const element of Array.from(view.container.querySelectorAll("*"))) {
      for (const className of Array.from(element.classList)) {
        if (className.startsWith("from-")) {
          classes.add(className);
        }
      }
    }

    view.unmount();
  }

  return classes;
}

// Selectors the dark rule names, split at their commas by the reader.
function liftedSelectors(property: string, value: string): string {
  return selectorsDeclaring(property, value).join(",");
}

afterEach(() => {
  cleanup();
});

describe("a team's avatar in the dark theme", () => {
  const teamClasses: Set<string> = gradientFromClasses(
    PeoplePickerKind.Team,
    NAMES,
  );

  test("the group palette is the five dark tiles it was designed with", () => {
    expect(Array.from(teamClasses).sort()).toEqual([
      "from-gray-700",
      "from-neutral-700",
      "from-slate-700",
      "from-stone-700",
      "from-zinc-700",
    ]);
  });

  test("every tile a team can get is lifted, from and to, under html.dark only", () => {
    const from: string = liftedSelectors("--tw-gradient-from", LIFTED_FROM);
    const to: string = liftedSelectors("--tw-gradient-to", LIFTED_TO);

    expect(from.startsWith("html.dark :is(")).toBe(true);
    expect(to).toBe(from);

    for (const className of Array.from(teamClasses)) {
      expect(from).toContain(`.${className}`);
    }
  });

  test("a person's coloured circle is not touched", () => {
    const personClasses: Set<string> = gradientFromClasses(
      PeoplePickerKind.User,
      NAMES,
    );
    const from: string = liftedSelectors("--tw-gradient-from", LIFTED_FROM);

    expect(personClasses.size).toBeGreaterThan(0);

    for (const className of Array.from(personClasses)) {
      expect(from).not.toContain(`.${className}`);
    }
  });
});
