import EntityFilter from "../../../UI/Components/Filters/EntityFilter";
import FieldType from "../../../UI/Components/Types/FieldType";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../UI/Components/Filters/Types/FilterData";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import GenericObject from "../../../Types/GenericObject";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * `EntityFilter` encodes a single-entity "is not" as a one-item IncludesNone,
 * because there is no dedicated NotEqual-for-entities operator. Reading that
 * encoding back is what makes the operator survive a remount — which is every
 * Back-navigation and every shared link.
 *
 * The read side used to only understand IsNull, NotNull and a bare string, so
 * "is not" silently reverted to "is" (with its value dropped) the moment the
 * component re-mounted: the URL still carried the right filter, but the UI
 * disagreed with it.
 */

type Resource = GenericObject & { ownerId?: string };

const FILTER: Filter<Resource> = {
  key: "ownerId",
  title: "Owner",
  type: FieldType.Entity,
  filterDropdownOptions: [
    { label: "Alex", value: "user-1" },
    { label: "Sam", value: "user-2" },
  ],
} as unknown as Filter<Resource>;

type RenderWithFunction = (filterData: FilterData<Resource>) => void;

const renderWith: RenderWithFunction = (
  filterData: FilterData<Resource>,
): void => {
  render(
    <EntityFilter<Resource>
      filter={FILTER}
      filterData={filterData}
      onFilterChanged={jest.fn()}
    />,
  );
};

describe("EntityFilter operator round trip", () => {
  afterEach(() => {
    cleanup();
  });

  test("a bare id reads back as 'is'", () => {
    renderWith({ ownerId: "user-1" } as unknown as FilterData<Resource>);

    expect(screen.getByText("is")).toBeTruthy();
  });

  test("a one-item IncludesNone reads back as 'is not', not 'is'", () => {
    renderWith({
      ownerId: new IncludesNone(["user-1"]),
    } as unknown as FilterData<Resource>);

    expect(screen.getByText("is not")).toBeTruthy();
  });

  test("the selected entity survives alongside the 'is not' operator", () => {
    renderWith({
      ownerId: new IncludesNone(["user-1"]),
    } as unknown as FilterData<Resource>);

    expect(screen.getByText("Alex")).toBeTruthy();
  });

  test("IsNull reads back as 'is empty'", () => {
    renderWith({ ownerId: new IsNull() } as unknown as FilterData<Resource>);

    expect(screen.getByText("is empty")).toBeTruthy();
  });

  test("NotNull reads back as 'is not empty'", () => {
    renderWith({ ownerId: new NotNull() } as unknown as FilterData<Resource>);

    expect(screen.getByText("is not empty")).toBeTruthy();
  });

  test("no value at all falls back to 'is'", () => {
    renderWith({} as unknown as FilterData<Resource>);

    expect(screen.getByText("is")).toBeTruthy();
  });

  test("an empty IncludesNone still selects the 'is not' operator", () => {
    renderWith({
      ownerId: new IncludesNone([]),
    } as unknown as FilterData<Resource>);

    expect(screen.getByText("is not")).toBeTruthy();
  });
});
