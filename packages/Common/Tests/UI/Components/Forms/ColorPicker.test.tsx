import ColorPicker from "../../../../UI/Components/Forms/Fields/ColorPicker";
import Color from "../../../../Types/Color";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type JestMock = ReturnType<typeof jest.fn>;

afterEach(() => {
  cleanup();
});

describe("ColorPicker", () => {
  test("clearing a selected color leaves the control empty", async () => {
    const onChange: JestMock = jest.fn();
    const { container } = render(
      <ColorPicker
        placeholder="No color"
        dataTestId="color-value"
        initialValue={new Color("#ef4444")}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(
        (screen.getByTestId("color-value") as HTMLInputElement).value,
      ).toEqual("#ef4444");
    });

    const clearIcon: SVGSVGElement | null = container.querySelector("svg");
    expect(clearIcon).not.toBeNull();
    fireEvent.click(clearIcon!);

    await waitFor(() => {
      expect(
        (screen.getByTestId("color-value") as HTMLInputElement).value,
      ).toEqual("");
      expect(onChange).toHaveBeenLastCalledWith(null);
    });
  });
});
