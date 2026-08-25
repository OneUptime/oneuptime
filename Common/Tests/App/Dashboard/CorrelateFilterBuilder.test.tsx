import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import CorrelateFilterBuilder, {
  getDefaultCorrelationCondition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder";
import {
  CorrelationCondition,
  CorrelationConnector,
  CorrelationFieldKey,
  CorrelationOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";

/*
 * The correlate filter builder rows (issue #3395): field + operator + value
 * per row, add/remove, one AND/OR connector. Pinned here: the default row,
 * append/delete, the operator vocabulary following the field, value reset
 * on field change, the connector toggle appearing only for chains, and the
 * value editor switching between text input and fixed dropdown per field.
 */

interface HarnessProps {
  initialConditions: Array<CorrelationCondition>;
  initialConnector: CorrelationConnector;
  onChangeSpy: (
    conditions: Array<CorrelationCondition>,
    connector: CorrelationConnector,
  ) => void;
}

const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [conditions, setConditions] = useState<Array<CorrelationCondition>>(
    props.initialConditions,
  );
  const [connector, setConnector] = useState<CorrelationConnector>(
    props.initialConnector,
  );

  return (
    <CorrelateFilterBuilder
      conditions={conditions}
      connector={connector}
      onChange={(
        nextConditions: Array<CorrelationCondition>,
        nextConnector: CorrelationConnector,
      ) => {
        setConditions(nextConditions);
        setConnector(nextConnector);
        props.onChangeSpy(nextConditions, nextConnector);
      }}
    />
  );
};

type RenderHarnessFunction = (
  initialConditions?: Array<CorrelationCondition>,
  initialConnector?: CorrelationConnector,
) => MockFunction;

const renderHarness: RenderHarnessFunction = (
  initialConditions?: Array<CorrelationCondition>,
  initialConnector?: CorrelationConnector,
): MockFunction => {
  const onChangeSpy: MockFunction = getJestMockFunction();
  render(
    <Harness
      initialConditions={
        initialConditions || [getDefaultCorrelationCondition()]
      }
      initialConnector={initialConnector || "and"}
      onChangeSpy={
        onChangeSpy as (
          conditions: Array<CorrelationCondition>,
          connector: CorrelationConnector,
        ) => void
      }
    />,
  );
  return onChangeSpy;
};

type SelectOptionFunction = (combobox: HTMLElement, optionText: string) => void;

/*
 * react-select renders its menu on ArrowDown; the option text is unique on
 * the page at that moment, so a global text lookup finds it.
 */
const selectOption: SelectOptionFunction = (
  combobox: HTMLElement,
  optionText: string,
): void => {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(optionText);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

function rowComboboxes(rowIndex: number): Array<HTMLElement> {
  return within(
    screen.getByTestId(`correlate-condition-row-${rowIndex}`),
  ).getAllByRole("combobox");
}

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe("CorrelateFilterBuilder", () => {
  test("renders the default observable row with a text value input", () => {
    renderHarness();
    expect(screen.getByTestId("correlate-condition-row-0")).toBeInTheDocument();
    expect(
      screen.getByTestId("correlate-condition-value-0"),
    ).toBeInTheDocument();
    // Single row → no connector toggle yet.
    expect(screen.queryByTestId("correlate-connector-and")).toBeNull();
  });

  test("typing a value emits the updated condition", () => {
    const onChangeSpy: MockFunction = renderHarness();
    fireEvent.change(screen.getByTestId("correlate-condition-value-0"), {
      target: { value: "wb-ubuntu-03" },
    });
    expect(onChangeSpy).toHaveBeenCalledWith(
      [
        {
          field: CorrelationFieldKey.Observable,
          operator: CorrelationOperator.Equals,
          value: "wb-ubuntu-03",
        },
      ],
      "and",
    );
  });

  test("Add condition appends a default row and reveals the connector toggle", () => {
    const onChangeSpy: MockFunction = renderHarness();
    fireEvent.click(screen.getByTestId("correlate-add-condition"));

    expect(screen.getByTestId("correlate-condition-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-connector-and")).toBeInTheDocument();
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [getDefaultCorrelationCondition(), getDefaultCorrelationCondition()],
      "and",
    );
  });

  test("deleting a row removes exactly that row", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Equals,
        value: "keep-me",
      },
      {
        field: CorrelationFieldKey.PrincipalUser,
        operator: CorrelationOperator.Equals,
        value: "delete-me",
      },
    ]);

    fireEvent.click(screen.getByTestId("correlate-condition-delete-1"));

    expect(screen.queryByTestId("correlate-condition-row-1")).toBeNull();
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Observable,
          operator: CorrelationOperator.Equals,
          value: "keep-me",
        },
      ],
      "and",
    );
  });

  test("switching the connector to OR emits and restyles the badge", () => {
    const onChangeSpy: MockFunction = renderHarness([
      getDefaultCorrelationCondition(),
      getDefaultCorrelationCondition(),
    ]);

    fireEvent.click(screen.getByTestId("correlate-connector-or"));

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [getDefaultCorrelationCondition(), getDefaultCorrelationCondition()],
      "or",
    );
    // The between-row badge now reads OR.
    expect(
      within(screen.getByTestId("correlate-condition-row-1")).getByText("OR"),
    ).toBeInTheDocument();
  });

  test("switching the field resets the value and keeps a compatible operator", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Contains,
        value: "ubuntu",
      },
    ]);

    const fieldCombobox: HTMLElement = rowComboboxes(0)[0] as HTMLElement;
    selectOption(fieldCombobox, "Principal Host");

    // "contains" is offered on Principal Host too, so it survives.
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.PrincipalHost,
          operator: CorrelationOperator.Contains,
          value: "",
        },
      ],
      "and",
    );
  });

  test("switching to a field that lacks the operator falls back to the field's first operator", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.StartsWith,
        value: "192.168.",
      },
    ]);

    const fieldCombobox: HTMLElement = rowComboboxes(0)[0] as HTMLElement;
    selectOption(fieldCombobox, "Severity");

    // Severity only offers is / is not.
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Severity,
          operator: CorrelationOperator.Equals,
          value: "",
        },
      ],
      "and",
    );
  });

  test("severity value renders a dropdown with the OCSF vocabulary", () => {
    const onChangeSpy: MockFunction = renderHarness([
      {
        field: CorrelationFieldKey.Severity,
        operator: CorrelationOperator.Equals,
        value: "",
      },
    ]);

    /*
     * The value editor is a react-select dropdown (not a text input): the
     * row has three comboboxes — field, operator, value.
     */
    const comboboxes: Array<HTMLElement> = rowComboboxes(0);
    expect(comboboxes).toHaveLength(3);

    selectOption(comboboxes[2] as HTMLElement, OcsfSeverity.Critical);

    expect(onChangeSpy).toHaveBeenLastCalledWith(
      [
        {
          field: CorrelationFieldKey.Severity,
          operator: CorrelationOperator.Equals,
          value: OcsfSeverity.Critical,
        },
      ],
      "and",
    );
  });

  test("operator dropdown only offers the field's vocabulary", () => {
    renderHarness([
      {
        field: CorrelationFieldKey.Severity,
        operator: CorrelationOperator.Equals,
        value: "",
      },
    ]);

    const operatorCombobox: HTMLElement = rowComboboxes(0)[1] as HTMLElement;
    fireEvent.keyDown(operatorCombobox, { key: "ArrowDown" });

    expect(screen.getByText("is not")).toBeInTheDocument();
    expect(screen.queryByText("contains")).toBeNull();
    expect(screen.queryByText("starts with")).toBeNull();
  });

  test("message field starts on its first operator (contains) and offers no equality", () => {
    renderHarness([
      {
        field: CorrelationFieldKey.Message,
        operator: CorrelationOperator.Contains,
        value: "",
      },
    ]);

    const operatorCombobox: HTMLElement = rowComboboxes(0)[1] as HTMLElement;
    fireEvent.keyDown(operatorCombobox, { key: "ArrowDown" });

    expect(screen.getByText("does not contain")).toBeInTheDocument();
    expect(screen.queryByText(/^is$/)).toBeNull();
  });
});
