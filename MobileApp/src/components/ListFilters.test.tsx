import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import ListFilters from "./ListFilters";

function Filters(): React.JSX.Element {
  const [selected, setSelected] = useState<"all" | "active">("all");
  return (
    <ListFilters
      options={[
        { key: "all", label: "All", accessibilityLabel: "All states" },
        { key: "active", label: "Active", accessibilityLabel: "Active only" },
      ]}
      selected={selected}
      onSelect={setSelected}
      resultCount={selected === "all" ? 2 : 1}
      onReset={
        selected === "all"
          ? undefined
          : () => {
              return setSelected("all");
            }
      }
    />
  );
}

test("filter selection is announced, updates the total and can be reset", async () => {
  await render(<Filters />);
  expect(screen.getByRole("button", { name: "All states" })).toHaveProp(
    "accessibilityState",
    { selected: true },
  );
  expect(screen.getByText("2 results")).toHaveProp(
    "accessibilityLiveRegion",
    "polite",
  );
  expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Active only" }));
  expect(screen.getByRole("button", { name: "Active only" })).toHaveProp(
    "accessibilityState",
    { selected: true },
  );
  expect(screen.getByRole("button", { name: "All states" })).toHaveProp(
    "accessibilityState",
    { selected: false },
  );
  expect(screen.getByText("1 result")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByText("2 results")).toBeTruthy();
});

test("unknown totals are not reported as zero matches", async () => {
  await render(
    <ListFilters
      options={[{ key: "all", label: "All", accessibilityLabel: "All states" }]}
      selected="all"
      onSelect={jest.fn()}
    />,
  );
  expect(screen.queryByText(/results?/)).toBeNull();
});

test("filters can still be reset while the result count is unavailable", async () => {
  const onReset: jest.Mock = jest.fn();
  await render(
    <ListFilters
      options={[
        { key: "active", label: "Active", accessibilityLabel: "Active only" },
      ]}
      selected="active"
      onSelect={jest.fn()}
      onReset={onReset}
    />,
  );
  expect(screen.queryByText(/results?/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Reset filters" }));
  expect(onReset).toHaveBeenCalledTimes(1);
});
