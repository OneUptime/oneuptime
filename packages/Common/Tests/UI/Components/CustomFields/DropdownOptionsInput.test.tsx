import DropdownOptionsInput from "../../../../UI/Components/CustomFields/DropdownOptionsInput";
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

jest.mock("../../../../UI/Components/Forms/Fields/ColorPicker", () => {
  interface MockColorPickerProps {
    dataTestId?: string | undefined;
    value?: string | undefined;
    initialValue?: { toString: () => string } | undefined;
    onChange: (value: { toString: () => string } | null) => void;
    onBlur?: (() => void) | undefined;
  }

  const MockColorPicker: React.FunctionComponent<MockColorPickerProps> = (
    props: MockColorPickerProps,
  ): React.ReactElement => {
    return (
      <input
        data-testid={props.dataTestId}
        value={props.value || props.initialValue?.toString() || ""}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const value: string = event.target.value;
          props.onChange(
            value
              ? {
                  toString: () => {
                    return value;
                  },
                }
              : null,
          );
        }}
        onBlur={() => {
          props.onBlur?.();
        }}
      />
    );
  };

  return {
    __esModule: true,
    default: MockColorPicker,
  };
});

afterEach(() => {
  cleanup();
});

const getInputValue: (testId: string) => string = (testId: string): string => {
  return (screen.getByTestId(testId) as HTMLInputElement).value;
};

describe("DropdownOptionsInput", () => {
  test("renders legacy options with an empty color control for each value", async () => {
    const onChange: JestMock = jest.fn();

    render(
      <DropdownOptionsInput initialValue={"Low\nHigh"} onChange={onChange} />,
    );

    await waitFor(() => {
      expect(getInputValue("dropdown-option-value-0")).toEqual("Low");
      expect(getInputValue("dropdown-option-value-1")).toEqual("High");
    });
    expect(getInputValue("dropdown-option-color-0")).toEqual("");
    expect(getInputValue("dropdown-option-color-1")).toEqual("");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("renders saved colors from structured options", async () => {
    render(
      <DropdownOptionsInput
        initialValue={
          '[{"value":"Low","color":"#22c55e"},{"value":"High","color":"#ef4444"}]'
        }
      />,
    );

    await waitFor(() => {
      expect(getInputValue("dropdown-option-color-0")).toEqual("#22c55e");
      expect(getInputValue("dropdown-option-color-1")).toEqual("#ef4444");
    });
  });

  test("keeps newline storage when only a value changes", async () => {
    const onChange: JestMock = jest.fn();
    render(
      <DropdownOptionsInput initialValue={"Low\nHigh"} onChange={onChange} />,
    );

    fireEvent.change(screen.getByTestId("dropdown-option-value-1"), {
      target: { value: "Critical" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("Low\nCritical");
    });
  });

  test("serializes the values and colors when a color is selected", async () => {
    const onChange: JestMock = jest.fn();
    render(
      <DropdownOptionsInput initialValue={"Low\nHigh"} onChange={onChange} />,
    );

    fireEvent.change(screen.getByTestId("dropdown-option-color-1"), {
      target: { value: "#ef4444" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        '[{"value":"Low"},{"value":"High","color":"#ef4444"}]',
      );
    });
  });

  test("returns to newline storage when the final color is cleared", async () => {
    const onChange: JestMock = jest.fn();
    render(
      <DropdownOptionsInput
        initialValue={'[{"value":"Low"},{"value":"High","color":"#ef4444"}]'}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByTestId("dropdown-option-color-1"), {
      target: { value: "" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("Low\nHigh");
    });
  });

  test("adds a value and preserves its selected color", async () => {
    const onChange: JestMock = jest.fn();
    render(<DropdownOptionsInput initialValue="Low" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Option" }));
    fireEvent.change(screen.getByTestId("dropdown-option-value-1"), {
      target: { value: "High" },
    });
    fireEvent.change(screen.getByTestId("dropdown-option-color-1"), {
      target: { value: "#ef4444" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        '[{"value":"Low"},{"value":"High","color":"#ef4444"}]',
      );
    });
  });

  test("removing an option keeps the remaining option's color paired with its value", async () => {
    const onChange: JestMock = jest.fn();
    render(
      <DropdownOptionsInput
        initialValue={
          '[{"value":"Low","color":"#22c55e"},{"value":"High","color":"#ef4444"}]'
        }
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    await waitFor(() => {
      expect(getInputValue("dropdown-option-value-0")).toEqual("High");
      expect(getInputValue("dropdown-option-color-0")).toEqual("#ef4444");
      expect(onChange).toHaveBeenLastCalledWith(
        '[{"value":"High","color":"#ef4444"}]',
      );
    });
  });

  test("removing the last option leaves one editable blank row and clears the value", async () => {
    const onChange: JestMock = jest.fn();
    render(<DropdownOptionsInput initialValue="Low" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(getInputValue("dropdown-option-value-0")).toEqual("");
      expect(onChange).toHaveBeenLastCalledWith("");
    });
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  test("does not store a color for a blank option", async () => {
    const onChange: JestMock = jest.fn();
    render(<DropdownOptionsInput onChange={onChange} />);

    fireEvent.change(screen.getByTestId("dropdown-option-color-0"), {
      target: { value: "#ef4444" },
    });

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  test("forwards blur events and displays validation errors", () => {
    const onBlur: JestMock = jest.fn();
    render(
      <DropdownOptionsInput
        initialValue="Low"
        onBlur={onBlur}
        error="Add at least one option"
      />,
    );

    fireEvent.blur(screen.getByTestId("dropdown-option-value-0"));
    fireEvent.blur(screen.getByTestId("dropdown-option-color-0"));

    expect(onBlur).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Add at least one option")).not.toBeNull();
  });
});
