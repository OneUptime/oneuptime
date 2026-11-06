/*
 * Issue #5943, in a row of the record editor and the query builder: an ID column
 * whose records can be listed is a list of them, a value from an earlier step is
 * its chip with the way back to the list, and what could not be shown in the
 * list stays exactly as it was saved.
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
  "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordSource",
  () => {
    return {
      __esModule: true,
      LINKED_RECORD_LIST_LIMIT: 100,
      loadLinkedRecords: jest.fn(),
      loadLinkedRecordsById: jest.fn(),
    };
  },
);

import ColumnValueInput from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import {
  DictionaryFilterOperator,
  getOperatorOption,
} from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { LinkedRecordCopy } from "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordInput";
import {
  loadLinkedRecords,
  loadLinkedRecordsById,
} from "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordSource";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SEV1: string = "7c000000-0000-4000-8000-0000000000a1";
const SEV2: string = "7c000000-0000-4000-8000-0000000000a2";

beforeEach(() => {
  (loadLinkedRecords as jest.Mock<any>).mockResolvedValue({
    options: [
      { value: SEV1, label: "SEV1", isUserContent: true },
      { value: SEV2, label: "SEV2", isUserContent: true },
    ],
    isComplete: true,
  });
  (loadLinkedRecordsById as jest.Mock<any>).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

type PickFunction = (label: string) => Promise<void>;

const pick: PickFunction = async (label: string): Promise<void> => {
  const box: HTMLElement = screen.getByRole("combobox");

  await act(async () => {
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
  });

  await act(async () => {
    fireEvent.click(await screen.findByText(label));
  });
};

describe("a linked ID, in a record", () => {
  test("lists the table's records, and a pick is its ID", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        dataTestId="severity"
        onChange={onChange}
      />,
    );

    await screen.findByText(LinkedRecordCopy.placeholder);

    expect(loadLinkedRecords).toHaveBeenCalledWith({
      tableName: "IncidentSeverity",
    });

    await pick("SEV2");

    expect(onChange).toHaveBeenCalledWith({
      text: SEV2,
      valueMode: ColumnValueMode.Literal,
    });
  });

  test("clearing it leaves an empty value, as a cleared box does", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { container } = render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Literal}
        text={SEV1}
        values={[]}
        onChange={onChange}
      />,
    );

    await screen.findByText("SEV1");

    await act(async () => {
      fireEvent.mouseDown(
        container.querySelector(".ou-select__clear-indicator") as Element,
      );
    });

    expect(onChange).toHaveBeenCalledWith({
      text: "",
      valueMode: ColumnValueMode.Literal,
    });
  });

  test("an ID whose records cannot be read is a box to type it into", async () => {
    (loadLinkedRecords as jest.Mock<any>).mockRejectedValue(
      new Error("Not allowed"),
    );

    render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Literal}
        text={SEV1}
        values={[]}
        dataTestId="severity"
        onChange={getJestMockFunction()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByTestId("severity")).toHaveTextContent(SEV1);
    });
  });

  test("with no table to list, it is a box as it always was", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.ObjectId}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        dataTestId="other"
        onChange={getJestMockFunction()}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(loadLinkedRecords).not.toHaveBeenCalled();
  });
});

describe("a value from an earlier step in a linked ID", () => {
  test("is its chip, with the way back to the list and not the abc of a typed value", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Reference}
        text="{{local.variables.severityId}}"
        values={[]}
        dataTestId="severity"
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("severity-type-a-value"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("severity-pick-from-list"));

    expect(onChange).toHaveBeenCalledWith({
      valueMode: ColumnValueMode.Literal,
      text: "",
    });
  });
});

describe("a value kept exactly as it was saved", () => {
  test("stays in its plain box until it is edited", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Raw}
        text="8"
        values={[]}
        dataTestId="severity"
        onChange={getJestMockFunction()}
      />,
    );

    expect(screen.getByTestId("severity")).toHaveValue("8");
    expect(loadLinkedRecords).not.toHaveBeenCalled();
  });
});

describe("a list of records, in a record", () => {
  test("lists the table's records, and every change reports their IDs", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ColumnValueInput
        control={ModelColumnControl.RecordList}
        linkedTableName="Label"
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[SEV1]}
        onChange={onChange}
      />,
    );

    await screen.findByText("SEV1");
    await pick("SEV2");

    expect(onChange).toHaveBeenCalledWith({ values: [SEV1, SEV2] });
  });

  test("a value for the whole list is its chip", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.RecordList}
        linkedTableName="Label"
        valueMode={ColumnValueMode.Reference}
        text="{{local.components.find-1.returnValues.model.labels}}"
        values={[]}
        dataTestId="labels"
        onChange={getJestMockFunction()}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("labels-pick-from-list")).toBeInTheDocument();
  });

  test("whose records cannot be read is the box to type each ID into", async () => {
    (loadLinkedRecords as jest.Mock<any>).mockRejectedValue(
      new Error("Not allowed"),
    );

    const onChange: MockFunction = getJestMockFunction();

    render(
      <ColumnValueInput
        control={ModelColumnControl.RecordList}
        linkedTableName="Label"
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        dataTestId="labels"
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    const box: HTMLElement = screen.getByTestId("labels");

    fireEvent.change(box, { target: { value: SEV1 } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({ values: [SEV1] });
  });
});

describe("a linked ID, in a query", () => {
  test("is any of lists the records too, and reports their IDs", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        operatorOption={getOperatorOption(DictionaryFilterOperator.IsAnyOf)}
        onChange={onChange}
      />,
    );

    await screen.findByText(LinkedRecordCopy.placeholder);
    await pick("SEV1");

    expect(onChange).toHaveBeenCalledWith({ values: [SEV1] });
  });

  test("a comparison that takes no value asks for none", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Record}
        linkedTableName="IncidentSeverity"
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        operatorOption={getOperatorOption(DictionaryFilterOperator.IsEmpty)}
        onChange={getJestMockFunction()}
      />,
    );

    expect(screen.getByText("No value needed")).toBeInTheDocument();
    expect(loadLinkedRecords).not.toHaveBeenCalled();
  });

  test("any other column's is any of stays the box to type values into", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Text}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        operatorOption={getOperatorOption(DictionaryFilterOperator.IsAnyOf)}
        onChange={getJestMockFunction()}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(loadLinkedRecords).not.toHaveBeenCalled();
  });
});
