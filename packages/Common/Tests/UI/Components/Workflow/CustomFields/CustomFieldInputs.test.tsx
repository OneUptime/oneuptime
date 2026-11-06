/*
 * Issue #5942, the two inputs of their own: a dropdown custom field's options,
 * and Outside ID Field, which names a custom field. Each is a list to pick from
 * with { } beside it, and what they keep is the plain name or option.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: () => {
      return null;
    },
  };
});

jest.mock(
  "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onPick: (reference: string) => void;
        dataTestId?: string;
      }) => {
        return (
          <button
            type="button"
            data-testid={props.dataTestId || "pick-a-value"}
            onClick={() => {
              props.onPick("{{local.variables.chosen}}");
            }}
          >
            Pick a value
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../../UI/Components/Workflow/CustomFields/UseCustomFields",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

import CustomFieldType from "../../../../../Types/CustomField/CustomFieldType";
import CustomFieldChoiceInput from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldChoiceInput";
import CustomFieldNameInput from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldNameInput";
import useCustomFields from "../../../../../UI/Components/Workflow/CustomFields/UseCustomFields";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type OpenMenuFunction = () => Promise<void>;

const openMenu: OpenMenuFunction = async (): Promise<void> => {
  const box: HTMLElement = screen.getByRole("combobox");

  await act(async () => {
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
  });
};

type PickOptionFunction = (label: string) => Promise<void>;

const pickOption: PickOptionFunction = async (label: string): Promise<void> => {
  await openMenu();

  const option: HTMLElement = await screen.findByText(label);

  await act(async () => {
    fireEvent.click(option);
  });
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("a dropdown custom field", () => {
  const CHOICES: Array<{ value: string; color?: string }> = [
    { value: "P1", color: "#ff0000" },
    { value: "P2" },
  ];

  type DrawFunction = (data: {
    value?: string;
    onChange?: MockFunction;
    onPickReference?: MockFunction;
  }) => ReactElement;

  const draw: DrawFunction = (data: {
    value?: string;
    onChange?: MockFunction;
    onPickReference?: MockFunction;
  }): ReactElement => {
    return (
      <CustomFieldChoiceInput
        choices={CHOICES}
        value={data.value}
        onChange={(data.onChange || getJestMockFunction()) as never}
        onPickReference={
          (data.onPickReference || getJestMockFunction()) as never
        }
        dataTestId="choice"
      />
    );
  };

  test("lists its own options, and writes the one picked", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(draw({ onChange: onChange }));

    await pickOption("P2");

    expect(onChange).toHaveBeenCalledWith("P2");
  });

  test("shows the one a step holds", () => {
    render(draw({ value: "P1" }));

    expect(screen.getByText("P1")).toBeInTheDocument();
  });

  test("an option since removed is shown as it is, not lost", () => {
    render(draw({ value: "P9" }));

    expect(screen.getByText("P9")).toBeInTheDocument();
  });

  test("a reference a step holds is shown as a value from an earlier step", () => {
    render(draw({ value: "{{local.variables.x}}" }));

    expect(screen.queryByText("P1")).toBeNull();
    expect(screen.getByText(/local\.variables\.x/)).toBeInTheDocument();
  });

  test("typed text that is no option cannot be added: the step would refuse it", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(draw({ onChange: onChange }));

    const box: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(box, { target: { value: "P7" } });
    });

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  test("a typed reference can", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(draw({ onChange: onChange }));

    const box: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(box, { target: { value: "{{local.variables.x}}" } });
    });

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    });

    expect(onChange).toHaveBeenCalledWith("{{local.variables.x}}");
  });
});

describe("a multi-select custom field", () => {
  type DrawFunction = (data: {
    values: Array<string>;
    onChangeList?: MockFunction;
  }) => ReactElement;

  const draw: DrawFunction = (data: {
    values: Array<string>;
    onChangeList?: MockFunction;
  }): ReactElement => {
    return (
      <CustomFieldChoiceInput
        choices={[{ value: "blue" }, { value: "green" }, { value: "red" }]}
        isList={true}
        values={data.values}
        onChangeList={(data.onChangeList || getJestMockFunction()) as never}
        dataTestId="choices"
      />
    );
  };

  test("adds an option to those it holds, in order", async () => {
    const onChangeList: MockFunction = getJestMockFunction();

    render(draw({ values: ["red"], onChangeList: onChangeList }));

    await pickOption("blue");

    expect(onChangeList).toHaveBeenCalledWith(["red", "blue"]);
  });

  test("shows each it holds, one since removed among them", () => {
    render(draw({ values: ["blue", "gone"] }));

    expect(screen.getByText("blue")).toBeInTheDocument();
    expect(screen.getByText("gone")).toBeInTheDocument();
  });
});

describe("Outside ID Field", () => {
  const FIELDS: Array<Record<string, unknown>> = [
    { name: "Case Number", customFieldType: CustomFieldType.Text, options: [] },
    { name: "Reference", customFieldType: CustomFieldType.Text, options: [] },
  ];

  type DrawFunction = (data: {
    value?: unknown;
    onChange?: MockFunction;
  }) => ReactElement;

  const draw: DrawFunction = (data: {
    value?: unknown;
    onChange?: MockFunction;
  }): ReactElement => {
    return (
      <CustomFieldNameInput
        tableName="Incident"
        value={data.value}
        onChange={(data.onChange || getJestMockFunction()) as never}
        placeholder="externalId"
        dataTestId="outside-id-field"
      />
    );
  };

  beforeEach(() => {
    (useCustomFields as jest.Mock).mockReturnValue({
      fields: FIELDS,
      isLoading: false,
    });
  });

  test("reads the fields of the record's own kind", () => {
    render(draw({}));

    expect(useCustomFields).toHaveBeenCalledWith("Incident");
  });

  test("lists the project's custom fields, and keeps the name picked", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(draw({ onChange: onChange }));

    await pickOption("Reference");

    expect(onChange).toHaveBeenCalledWith("Reference");
  });

  test("shows a name no field has, as the setting's own default is one", () => {
    render(draw({ value: "externalId" }));

    expect(screen.getByText("externalId")).toBeInTheDocument();
  });

  test("any name can be typed: a step may keep it under a field nobody has defined yet", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(draw({ onChange: onChange }));

    const box: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(box, { target: { value: "caseNumber" } });
    });

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    });

    expect(onChange).toHaveBeenCalledWith("caseNumber");
  });

  test("a value that is no text shows nothing, and does not throw", () => {
    render(draw({ value: 42 }));

    expect(screen.queryByText("42")).toBeNull();
  });

  test("with no custom fields, or none it may read, a name can still be typed", async () => {
    (useCustomFields as jest.Mock).mockReturnValue({
      fields: [],
      isLoading: false,
    });

    const onChange: MockFunction = getJestMockFunction();

    render(draw({ onChange: onChange }));

    const box: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(box, { target: { value: "caseNumber" } });
    });

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    });

    expect(onChange).toHaveBeenCalledWith("caseNumber");
  });
});
