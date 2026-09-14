import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import SearchField from "./SearchField";

function Search(): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <SearchField
      value={value}
      onChangeText={setValue}
      placeholder="Search incidents"
    />
  );
}

test("search is named, accepts text and clears without losing the input", async () => {
  await render(<Search />);
  const input: ReturnType<typeof screen.getByLabelText> =
    screen.getByLabelText("Search incidents");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  await fireEvent.changeText(input, "checkout latency");
  expect(input).toHaveProp("value", "checkout latency");
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(input).toHaveProp("value", "");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});

test("an explicit accessible label describes what is searched", async () => {
  await render(
    <SearchField
      value=""
      onChangeText={jest.fn()}
      placeholder="Name or ID"
      accessibilityLabel="Find a monitor"
    />,
  );
  expect(screen.getByLabelText("Find a monitor")).toHaveProp(
    "autoCorrect",
    false,
  );
});
