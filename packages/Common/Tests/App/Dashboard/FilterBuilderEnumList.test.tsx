import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import FilterConditionElement, {
  getOperatorOptionsForField,
  getPickedListOptions,
  getValueDropdownOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterCondition";
import FilterQueryBuilder from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryBuilder";
import FilterQueryBuilderField from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryBuilderField";
import LogFilterConfig from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  FilterBuilderConfig,
  FilterConditionData,
  FilterFieldDefinition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import TracePipeline from "../../../Models/DatabaseModels/TracePipeline";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * "IS ONE OF" ON A DROPDOWN FIELD IS PICKED FROM ITS LABELS (#9214).
 *
 * Traces' Status, Span Kind and the yes/no fields, and Logs' Severity, are
 * dropdowns for "equals". With "is one of" the value was a text box that
 * wanted the stored codes - "0, 2", "SPAN_KIND_CLIENT, SPAN_KIND_SERVER" -
 * and typing the labels people see (Unset, Error) matched nothing. It is now
 * a multi-select of the same labels that saves the same codes, and a saved
 * filter reads back as its labels, in the builder and in its summary.
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const fieldOf: (
  config: FilterBuilderConfig,
  key: string,
) => FilterFieldDefinition = (
  config: FilterBuilderConfig,
  key: string,
): FilterFieldDefinition => {
  return config.fields.find((field: FilterFieldDefinition): boolean => {
    return field.key === key;
  })!;
};

const operatorLabels: (
  field: FilterFieldDefinition | undefined,
  operator: string,
) => Array<string> = (
  field: FilterFieldDefinition | undefined,
  operator: string,
): Array<string> => {
  return getOperatorOptionsForField(field, operator).map(
    (option: DropdownOption): string => {
      return option.label;
    },
  );
};

function renderCondition(condition: FilterConditionData): MockFunction {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <FilterConditionElement
      condition={condition}
      onChange={onChange as unknown as (c: FilterConditionData) => void}
      onDelete={() => {}}
      canDelete={false}
      index={0}
      connector="AND"
      isLast={true}
      config={TraceFilterConfig}
    />,
  );

  return onChange;
}

function lastCondition(onChange: MockFunction): FilterConditionData {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);

  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as FilterConditionData;
}

describe("the operators a field offers", () => {
  test.each([
    ["Status", TraceFilterConfig, "statusCode"],
    ["Span Kind", TraceFilterConfig, "kind"],
    ["Has Exception", TraceFilterConfig, "hasException"],
    ["Severity", LogFilterConfig, "severityText"],
  ])(
    "%s offers equals, does not equal and is one of, never contains",
    (_name: string, config: FilterBuilderConfig, key: string) => {
      expect(operatorLabels(fieldOf(config, key), "=")).toEqual([
        "equals",
        "does not equal",
        "is one of",
      ]);
    },
  );

  test("a text field and a custom attribute still offer contains", () => {
    expect(operatorLabels(fieldOf(TraceFilterConfig, "name"), "=")).toContain(
      "contains",
    );
    expect(operatorLabels(undefined, "=")).toContain("contains");
  });

  test("a filter saved with contains on a dropdown field still shows it", () => {
    expect(
      operatorLabels(fieldOf(LogFilterConfig, "severityText"), "LIKE"),
    ).toContain("contains");
  });
});

describe("a stored list as picks", () => {
  test("each code is its option, by its label", () => {
    const options: Array<DropdownOption> = getValueDropdownOptions(
      fieldOf(TraceFilterConfig, "statusCode"),
    );

    expect(
      getPickedListOptions("0, 2", options).map(
        (option: DropdownOption): string => {
          return option.label;
        },
      ),
    ).toEqual(["Unset", "Error"]);
  });

  test("a value no option has is kept, drawn as written", () => {
    const options: Array<DropdownOption> = getValueDropdownOptions(
      fieldOf(LogFilterConfig, "severityText"),
    );

    expect(getPickedListOptions("Error, INFO", options)).toEqual([
      expect.objectContaining({ value: "Error", label: "Error" }),
      { value: "INFO", label: "INFO", isUserContent: true },
    ]);
  });
});

describe("the value of is one of on a dropdown field", () => {
  test("is a multi-select showing the saved codes as their labels, not a text box", () => {
    renderCondition({ field: "statusCode", operator: "IN", value: "0, 2" });

    const list: HTMLElement = screen.getByTestId("filter-condition-value-list");
    expect(within(list).getByText("Unset")).toBeInTheDocument();
    expect(within(list).getByText("Error")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("0, 2")).toBeNull();
    expect(screen.queryByText("Comma-separated values")).toBeNull();
  });

  test("picking a label adds its code to the saved list", () => {
    const onChange: MockFunction = renderCondition({
      field: "statusCode",
      operator: "IN",
      value: "0",
    });

    const list: HTMLElement = screen.getByTestId("filter-condition-value-list");
    fireEvent.keyDown(within(list).getByRole("combobox"), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByText("Error"));

    expect(lastCondition(onChange)).toEqual({
      field: "statusCode",
      operator: "IN",
      value: "0, 2",
    });
  });

  test("a text field's is one of is still a text box", () => {
    renderCondition({ field: "name", operator: "IN", value: "a, b" });

    expect(screen.queryByTestId("filter-condition-value-list")).toBeNull();
    expect(screen.getByDisplayValue("a, b")).toBeInTheDocument();
  });

  test("a saved Span Kind list reads back in the builder as its labels", () => {
    render(
      <FilterQueryBuilderField
        config={TraceFilterConfig}
        value="kind IN ('SPAN_KIND_CLIENT', 'SPAN_KIND_SERVER')"
      />,
    );

    const list: HTMLElement = screen.getByTestId("filter-condition-value-list");
    expect(within(list).getByText("Client")).toBeInTheDocument();
    expect(within(list).getByText("Server")).toBeInTheDocument();
    expect(within(list).queryByText("SPAN_KIND_CLIENT")).toBeNull();
  });
});

describe("the filter's summary", () => {
  test("shows a saved Status list as one pill per label", async () => {
    getJestSpyOn(ModelAPI, "getItem").mockImplementation(
      async (): Promise<unknown> => {
        const pipeline: TracePipeline = new TracePipeline();
        (pipeline as unknown as { filterQuery: string }).filterQuery =
          "statusCode IN ('0', '2')";
        return pipeline;
      },
    );

    render(
      <FilterQueryBuilder
        modelType={TracePipeline}
        modelId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90")}
        config={TraceFilterConfig}
      />,
    );

    const list: HTMLElement = await waitFor((): HTMLElement => {
      return screen.getByTestId("filter-value-list");
    });
    expect(
      Array.from(list.children).map((pill: Element): string => {
        return pill.textContent || "";
      }),
    ).toEqual(["Unset", "Error"]);
    expect(screen.queryByText("0, 2")).toBeNull();
  });
});
