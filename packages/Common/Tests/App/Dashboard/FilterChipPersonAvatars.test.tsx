import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { getOwnerChipOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerFacetQuery";
import OwnersCell from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import { getPeopleAvatarPalette } from "../../../UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE OWNER CHIP DRAWS PEOPLE AND TEAMS AS THE OWNERS COLUMN DOES.
 *
 * The chip drew its people and teams as initials on a colour of its own,
 * hashed from the pick's key: Ada Lovelace was violet in the chip and red in
 * the Owners column under it, and the SRE team a green circle - a person's
 * look - where the column draws a team as a dark tile with a people badge.
 * Now an option that is a person or a team (`person`) is drawn with the
 * avatar every owners list draws (PeopleAvatar): the same colour for the
 * same name, a profile picture where there is one, a team as a team - in the
 * list, and in the chip once picked.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const ADA_ID: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const GRACE_ID: string = "1e5dac3f-7b40-4f2e-8c8b-3d6f9a2b4c71";
const SRE_ID: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";

const ADA: FilterChipDropdownOption = getOwnerChipOption({
  kind: "user",
  id: ADA_ID,
  name: "Ada Lovelace",
});
const GRACE: FilterChipDropdownOption = getOwnerChipOption({
  kind: "user",
  id: GRACE_ID,
  name: "Grace Hopper",
  hasProfilePicture: true,
});
const SRE: FilterChipDropdownOption = getOwnerChipOption({
  kind: "team",
  id: SRE_ID,
  name: "SRE",
});

const OWNERS: Array<FilterChipDropdownOption> = [ADA, GRACE, SRE];

afterEach(() => {
  cleanup();
});

// The Owner chip with its people and teams given.
const renderChip: (value: Array<string>) => void = (
  value: Array<string>,
): void => {
  render(
    <FilterChipDropdown
      label="Owner"
      emptyIcon={IconProp.User}
      options={OWNERS}
      isMultiSelect={true}
      value={value}
      onChange={(): void => {}}
    />,
  );
};

const openChip: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: /^Owner/ }));
  return screen.getByRole("dialog");
};

const optionNamed: (dialog: HTMLElement, name: string) => HTMLElement = (
  dialog: HTMLElement,
  name: string,
): HTMLElement => {
  return within(dialog).getByRole("option", {
    name: (accessibleName: string): boolean => {
      return accessibleName.includes(name);
    },
  });
};

// The classes of a name's avatar colour (PeopleAvatar's palette).
const paletteOf: (kind: PeoplePickerKind, name: string) => Array<string> = (
  kind: PeoplePickerKind,
  name: string,
): Array<string> => {
  return getPeopleAvatarPalette(kind, name).bg.split(" ");
};

// The tile that holds a person's or a team's initials.
const initialsTile: (scope: HTMLElement, initials: string) => HTMLElement = (
  scope: HTMLElement,
  initials: string,
): HTMLElement => {
  const tile: HTMLElement | undefined = Array.from(
    scope.querySelectorAll<HTMLElement>("div[aria-hidden='true']"),
  ).find((element: HTMLElement): boolean => {
    return element.textContent === initials;
  });

  expect(tile).toBeDefined();

  return tile!;
};

describe("the Owner chip's people and teams", () => {
  test("a person in the list wears their avatar colour - the one the Owners column gives them", () => {
    renderChip([]);
    const dialog: HTMLElement = openChip();

    const tile: HTMLElement = initialsTile(
      optionNamed(dialog, "Ada Lovelace"),
      "AL",
    );

    for (const className of paletteOf(PeoplePickerKind.User, "Ada Lovelace")) {
      expect(tile).toHaveClass(className);
    }

    // The column under the chip draws Ada with the very same classes.
    const ada: User = new User();
    ada._id = ADA_ID;
    ada.id = new ObjectID(ADA_ID);
    ada.name = new Name("Ada Lovelace");

    const owners: Array<ResourceOwnerEntry> = [{ kind: "user", user: ada }];
    const { container } = render(<OwnersCell owners={owners} />);

    expect(initialsTile(container, "AL").className).toBe(tile.className);
  });

  test("a team in the list is a team's dark tile with its people badge, never a person's circle", () => {
    renderChip([]);
    const dialog: HTMLElement = openChip();
    const option: HTMLElement = optionNamed(dialog, "SRE");

    const tile: HTMLElement = initialsTile(option, "S");

    for (const className of paletteOf(PeoplePickerKind.Team, "SRE")) {
      expect(tile).toHaveClass(className);
    }

    // The badge: a second hidden mark, holding the people icon.
    expect(
      option.querySelectorAll("div[aria-hidden='true']").length,
    ).toBeGreaterThanOrEqual(2);
    expect(option.querySelector("svg")).not.toBeNull();

    // And the column draws the SRE team with the same tile.
    const sre: Team = new Team();
    sre._id = SRE_ID;
    sre.name = "SRE";

    const { container } = render(
      <OwnersCell owners={[{ kind: "team", team: sre }]} />,
    );

    expect(initialsTile(container, "S").className).toBe(tile.className);
  });

  test("a person with a profile picture shows it", () => {
    renderChip([]);
    const dialog: HTMLElement = openChip();

    const picture: HTMLElement = within(
      optionNamed(dialog, "Grace Hopper"),
    ).getByAltText("Grace Hopper");

    expect(picture.getAttribute("src")).toContain(GRACE_ID);
  });

  test("no colour of the chip's own is left on a person or a team", () => {
    renderChip([]);
    const dialog: HTMLElement = openChip();

    // The chip's own palette: solid fills hashed from the pick's key.
    for (const option of within(dialog).getAllByRole("option")) {
      expect(option.innerHTML).not.toMatch(
        /\bbg-(?:indigo|blue|violet|emerald|amber|rose|teal|cyan|fuchsia)-500\b/,
      );
    }
  });

  test("a team picked: the chip shows the team's tile, small, beside its name", () => {
    renderChip([SRE.value]);

    const chip: HTMLElement = screen.getByRole("button", { name: /^Owner/ });

    expect(chip).toHaveTextContent("SRE");

    const tile: HTMLElement = initialsTile(chip, "S");

    expect(tile).toHaveClass("h-4", "w-4");
    for (const className of paletteOf(PeoplePickerKind.Team, "SRE")) {
      expect(tile).toHaveClass(className);
    }
    // No badge and no ring at 16px.
    expect(chip.querySelectorAll("div[aria-hidden='true']")).toHaveLength(1);
    expect(tile.className).not.toContain("ring-2");
  });

  test("a person picked: the chip shows their colour, small, beside their name", () => {
    renderChip([ADA.value]);

    expect(screen.getByRole("button", { name: /^Owner/ })).toHaveTextContent(
      "Ada Lovelace",
    );

    const personTile: HTMLElement = initialsTile(
      screen.getByRole("button", { name: /^Owner/ }),
      "AL",
    );

    for (const className of paletteOf(PeoplePickerKind.User, "Ada Lovelace")) {
      expect(personTile).toHaveClass(className);
    }
  });

  test("options that are not people keep their own look (Labels, States...)", () => {
    render(
      <FilterChipDropdown
        label="Labels"
        options={[
          { value: "night", label: "night-shift", color: "#4f46e5" },
          { value: "x", label: "Xavier", initials: "XA" },
        ]}
        isMultiSelect={true}
        value={[]}
        onChange={(): void => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Labels/ }));
    const dialog: HTMLElement = screen.getByRole("dialog");

    // A label is its colour's dot.
    const dot: HTMLElement | null = optionNamed(
      dialog,
      "night-shift",
    ).querySelector("span[style]");

    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("style")).toContain("background-color");

    // Initials without a person keep the chip's own hashed colour.
    expect(optionNamed(dialog, "Xavier").innerHTML).toMatch(/bg-[a-z]+-500/);
  });
});
