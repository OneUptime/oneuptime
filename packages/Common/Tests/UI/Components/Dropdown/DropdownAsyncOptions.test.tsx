import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { render, RenderResult, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";

describe("Dropdown asynchronous options", () => {
  const owner: DropdownOption = { value: "owner-1", label: "Saved Owner" };

  test("resolves a controlled multiselect's unchanged IDs when options arrive", () => {
    const onChange: MockFunction = getJestMockFunction();
    // BasicForm passes the stored IDs, before their option labels are fetched.
    const value: Array<DropdownOption> = [
      owner.value,
    ] as unknown as Array<DropdownOption>;
    const { rerender }: RenderResult = render(
      <Dropdown
        isMultiSelect={true}
        options={[]}
        value={value}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText(owner.label)).not.toBeInTheDocument();
    rerender(
      <Dropdown
        isMultiSelect={true}
        options={[owner]}
        value={value}
        onChange={onChange}
      />,
    );

    expect(screen.getByText(owner.label)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove Saved Owner" }),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("resolves a controlled single value when options arrive", () => {
    const value: DropdownOption = owner.value as unknown as DropdownOption;
    const { rerender }: RenderResult = render(
      <Dropdown options={[]} value={value} />,
    );

    rerender(<Dropdown options={[owner]} value={value} />);

    expect(screen.getByText(owner.label)).toBeVisible();
  });

  test("does not clear an uncontrolled selection when its options refresh", () => {
    const { rerender }: RenderResult = render(
      <Dropdown options={[owner]} initialValue={owner} />,
    );

    rerender(
      <Dropdown
        options={[owner, { value: "owner-2", label: "Another Owner" }]}
        initialValue={owner}
      />,
    );

    expect(screen.getByText(owner.label)).toBeVisible();
    expect(screen.queryByText("Another Owner")).not.toBeInTheDocument();
  });

  test("still clears a controlled selection when its value becomes undefined", () => {
    const { rerender }: RenderResult = render(
      <Dropdown options={[owner]} value={owner} />,
    );

    rerender(<Dropdown options={[owner]} value={undefined} />);

    expect(screen.queryByText(owner.label)).not.toBeInTheDocument();
  });
});
