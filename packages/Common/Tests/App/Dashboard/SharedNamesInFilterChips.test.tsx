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
import { SHARED_NAME_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/SharedNameWords";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import IconProp from "../../../Types/Icon/IconProp";
import {
  SHARED_NAME_DETAIL_TEST_ID,
  SHARED_NAME_PILL_TEST_ID,
} from "../../../UI/Components/Dropdown/SharedNameOptionLines";
import { writeReaderDay } from "../../../UI/Utils/ReaderMoments";
import {
  SHARED_NAME_PILLS,
  getSharedNameFacts,
} from "../../../UI/Utils/SharedNameOptions";

/*
 * THE FILTER CHIPS ABOVE A LIST TELL APART THE LABELS AND TEAMS THAT SHARE
 * A NAME (#10064).
 *
 * A list's Labels chip and its Owner chip list labels and teams by name,
 * so two "Production" labels, or two "Platform" teams, read alike there as
 * in every picker. They are drawn by the picker's rule
 * (Common/UI/Utils/SharedNameOptions): the pill the record's own list
 * draws, and under the name what sets each apart - its description, or
 * when it was made.
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

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");

function label(data: {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
}): FilterChipDropdownOption {
  const model: Label = new Label();
  model._id = data.id;
  model.name = data.name;
  model.description = data.description;
  model.createdAt = data.createdAt;

  return {
    value: data.id,
    label: data.name,
    color: "#ef4444",
    sharedName: getSharedNameFacts(model),
  };
}

function team(data: {
  id: string;
  name: string;
  description?: string;
}): FilterChipDropdownOption {
  const model: Team = new Team();
  model._id = data.id;
  model.name = data.name;
  model.description = data.description;

  // As the Owner chip lists a team the owners picker found.
  return getOwnerChipOption({
    kind: "team",
    id: data.id,
    name: data.name,
    sharedName: getSharedNameFacts(model),
  });
}

function openChip(label: string): HTMLElement {
  fireEvent.click(
    screen.getByRole("button", {
      name: (accessibleName: string): boolean => {
        return accessibleName.startsWith(label);
      },
    }),
  );

  return screen.getByRole("dialog");
}

function rowOf(dialog: HTMLElement, name: string): Array<HTMLElement> {
  return within(dialog)
    .getAllByRole("option")
    .filter((row: HTMLElement): boolean => {
      return (row.textContent || "").trim().startsWith(name);
    });
}

afterEach(() => {
  cleanup();
});

describe("a list's filter chips", () => {
  test("the Labels chip marks labels that share a name, each with its description or when it was made", () => {
    render(
      <FilterChipDropdown
        label="Labels"
        emptyIcon={IconProp.Tag}
        options={[
          label({
            id: "a",
            name: "Production",
            description: "Customer-facing services",
          }),
          label({ id: "b", name: "production", createdAt: MARCH }),
          label({ id: "c", name: "Staging" }),
        ]}
        isMultiSelect={true}
        value={[]}
        onChange={(): void => {}}
      />,
    );

    const dialog: HTMLElement = openChip("Labels");
    const twins: Array<HTMLElement> = [
      ...rowOf(dialog, "Production"),
      ...rowOf(dialog, "production"),
    ];

    expect(twins).toHaveLength(2);
    expect(
      twins.map((row: HTMLElement): string => {
        return (
          within(row).getByTestId(SHARED_NAME_PILL_TEST_ID).textContent || ""
        );
      }),
    ).toEqual(["Same name as another label", "Same name as another label"]);
    expect(
      twins.map((row: HTMLElement): string => {
        return (
          within(row).getByTestId(SHARED_NAME_DETAIL_TEST_ID).textContent || ""
        );
      }),
    ).toEqual(["Customer-facing services", `Created ${writeReaderDay(MARCH)}`]);

    const staging: HTMLElement = rowOf(dialog, "Staging")[0]!;
    expect(
      within(staging).queryByTestId(SHARED_NAME_PILL_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("the Owner chip marks teams that share a name, and never a person", () => {
    render(
      <FilterChipDropdown
        label="Owner"
        emptyIcon={IconProp.User}
        options={[
          team({ id: "t1", name: "Platform", description: "Clusters" }),
          team({ id: "t2", name: "Platform", description: "Databases" }),
          getOwnerChipOption({ kind: "user", id: "u1", name: "Platform" }),
        ]}
        isMultiSelect={true}
        value={[]}
        onChange={(): void => {}}
      />,
    );

    const dialog: HTMLElement = openChip("Owner");
    const pills: Array<HTMLElement> = within(dialog).getAllByTestId(
      SHARED_NAME_PILL_TEST_ID,
    );

    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent("Same name as another team");
    expect(
      within(dialog)
        .getAllByTestId(SHARED_NAME_DETAIL_TEST_ID)
        .map((detail: HTMLElement): string => {
          return detail.textContent || "";
        }),
    ).toEqual(["Clusters", "Databases"]);
  });

  test("an option that carries nothing of its record is drawn as before", () => {
    render(
      <FilterChipDropdown
        label="Labels"
        emptyIcon={IconProp.Tag}
        options={[
          { value: "a", label: "Production" },
          { value: "b", label: "Production" },
        ]}
        isMultiSelect={true}
        value={[]}
        onChange={(): void => {}}
      />,
    );

    const dialog: HTMLElement = openChip("Labels");

    expect(
      within(dialog).queryByTestId(SHARED_NAME_PILL_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("the pill a picker draws", () => {
  test("is the pill each kind's list draws: one name per thing", () => {
    for (const kind of Object.values(SharedNameKind)) {
      expect({ kind, pill: SHARED_NAME_WORDS[kind].pill }).toEqual({
        kind,
        pill: SHARED_NAME_PILLS[kind],
      });
    }
  });
});
