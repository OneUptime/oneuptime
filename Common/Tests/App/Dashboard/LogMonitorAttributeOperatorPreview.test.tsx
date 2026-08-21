/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The preview mounts a live telemetry viewer that lists logs over the API.
 * These tests are about what the criteria form *hands* the preview, so the
 * viewer itself is stubbed and the chip-building step is driven directly —
 * see buildAttributeFilterChips below, which is the code the real preview
 * runs on the query this form produces.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="logs-preview" />;
      },
    };
  },
);

import LogMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom";
import { buildAttributeFilterChips } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import Log from "../../../Models/AnalyticsModels/Log";
import Query from "../../../Types/BaseDatabase/Query";
import Dictionary from "../../../Types/Dictionary";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Modal from "../../../UI/Components/Modal/Modal";

/*
 * Reported as: "Several of the operators on the log monitor produce this
 * error and don't allow you to save", with a screenshot of the Edit Monitor
 * dialog replaced by the generic "Something went wrong" card, whose error
 * details read:
 *
 *   Objects are not valid as a React child (found: object with keys {_values})
 *
 * `{_values}` is an `Includes` — the "is any of" operator. Filter by
 * Attributes stores a bare string for the implicit `=` and an operator
 * *object* for everything else, `toQuery()` hands those straight to the logs
 * preview, and the preview pinned each one as a chip by rendering the value.
 * Because the preview is inside the modal, the throw unmounted the form and
 * the Save Changes button with it.
 *
 * This walks the whole chain the user walked: pick an operator in the form,
 * take the monitor step it emits, compile it with the real toQuery(), and
 * render the chips the preview builds from the result.
 */

const ATTRIBUTE_KEYS: Array<string> = ["logtype", "requestId", "statusCode"];

interface Recorder {
  closeCount: number;
  latestLogMonitor: MonitorStepLogMonitor | null;
}

const LogHarness: React.FunctionComponent<{ recorder: Recorder }> = (props: {
  recorder: Recorder;
}): ReactElement => {
  const [logMonitor, setLogMonitor] = React.useState<MonitorStepLogMonitor>(
    MonitorStepLogMonitorUtil.getDefault(),
  );

  return (
    <Modal
      title="Edit Monitor"
      onClose={() => {
        props.recorder.closeCount++;
      }}
      onSubmit={() => {}}
    >
      <BasicForm
        id="monitor-form"
        hideSubmitButton={true}
        initialValues={{}}
        onSubmit={() => {}}
        fields={[
          {
            field: { monitorSteps: true },
            title: "Monitor Details",
            fieldType: FormFieldSchemaType.CustomComponent,
            getCustomElement: () => {
              return (
                <LogMonitorStepForm
                  monitorStepLogMonitor={logMonitor}
                  onMonitorStepLogMonitorChanged={(
                    value: MonitorStepLogMonitor,
                  ) => {
                    props.recorder.latestLogMonitor = value;
                    setLogMonitor(value);
                  }}
                  attributeKeys={ATTRIBUTE_KEYS}
                  telemetryServices={[]}
                  telemetryEntities={[]}
                />
              );
            },
          },
        ]}
      />
    </Modal>
  );
};

type SelectOptionFunction = (combobox: HTMLElement, optionText: string) => void;

const selectOption: SelectOptionFunction = (
  combobox: HTMLElement,
  optionText: string,
): void => {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(optionText);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

/*
 * The step form has several other dropdowns above the filter rows (severity,
 * telemetry service, infrastructure entity), so the operator cannot be picked
 * off a fixed combobox index. Walk up from its own "Operator" label instead —
 * that survives a field being added to the form.
 */
type OperatorSelectFunction = () => HTMLElement;

const operatorSelect: OperatorSelectFunction = (): HTMLElement => {
  let node: HTMLElement | null = screen.getByText("Operator");

  while (node) {
    const combobox: HTMLElement | null =
      node.querySelector<HTMLElement>('[role="combobox"]');

    if (combobox) {
      return combobox;
    }

    node = node.parentElement;
  }

  throw new Error("No operator dropdown found in the attribute filter row");
};

type ValueInputFunction = () => HTMLInputElement;

const valueInput: ValueInputFunction = (): HTMLInputElement => {
  return document.querySelector<HTMLInputElement>(
    'input[placeholder="Value"]',
  )!;
};

/**
 * Open the criteria form, reveal the advanced options and add one attribute
 * filter row keyed on `logtype` — the state the reporter's screenshot was in.
 */
function openFormWithAttributeRow(): Recorder {
  const recorder: Recorder = { closeCount: 0, latestLogMonitor: null };

  render(<LogHarness recorder={recorder} />);

  /*
   * A step that already has advanced filters set renders them expanded, so
   * the toggle is only present when they are collapsed.
   */
  const showAdvanced: HTMLElement | null = screen.queryByText(
    "Show Advanced Options",
  );

  if (showAdvanced) {
    fireEvent.click(showAdvanced);
  }

  fireEvent.click(screen.getByText("Add Filter by Attributes"));

  const keyBox: HTMLInputElement = document.querySelector<HTMLInputElement>(
    'input[aria-controls^="autocomplete-suggestions-"]',
  )!;

  fireEvent.change(keyBox, { target: { value: "logtype" } });

  return recorder;
}

/** The exact composition the logs preview performs on the form's output. */
function previewChipsFor(
  monitorStep: MonitorStepLogMonitor,
): Array<ActiveFilter> {
  const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(monitorStep);

  return buildAttributeFilterChips(
    (query as Record<string, unknown>)["attributes"] as
      | Dictionary<DictionaryEntryValue>
      | undefined,
  );
}

function renderChips(filters: Array<ActiveFilter>): void {
  render(
    <ActiveFilterChips
      filters={filters}
      onRemove={() => {}}
      onClearAll={() => {}}
    />,
  );
}

describe("Log monitor criteria — attribute filter operators reach the preview", () => {
  afterEach(() => {
    cleanup();
  });

  test("choosing 'is any of' emits a filter the preview can render — the reported crash, end to end", () => {
    const recorder: Recorder = openFormWithAttributeRow();

    selectOption(operatorSelect(), "is any of");

    const monitorStep: MonitorStepLogMonitor = recorder.latestLogMonitor!;

    expect(monitorStep).not.toBeNull();
    expect(Object.keys(monitorStep.attributes || {})).toContain("logtype");

    /*
     * This is the render that used to throw. An assertion is not enough on
     * its own — the point is that mounting completes at all.
     */
    expect(() => {
      renderChips(previewChipsFor(monitorStep));
    }).not.toThrow();

    expect(document.body.textContent).not.toContain("[object Object]");
  });

  test("choosing 'contains' and typing a value shows the filter as text", () => {
    const recorder: Recorder = openFormWithAttributeRow();

    selectOption(operatorSelect(), "contains");
    fireEvent.change(valueInput(), { target: { value: "web" } });

    const chips: Array<ActiveFilter> = previewChipsFor(
      recorder.latestLogMonitor!,
    );

    expect(chips).toHaveLength(1);
    expect(chips[0]!.displayKey).toBe("logtype");
    expect(chips[0]!.displayValue).toBe("contains web");

    renderChips(chips);

    expect(screen.getByText("contains web")).toBeInTheDocument();
  });

  test.each([
    ["is none of", "is none of"],
    ["does not contain", "does not contain web"],
    ["starts with", "starts with web"],
    ["ends with", "ends with web"],
    ["!=", "does not equal web"],
    ["is empty", "is empty"],
    ["is not empty", "is not empty"],
  ])(
    "the '%s' operator survives the round trip to a chip",
    (optionText: string, expectedText: string) => {
      const recorder: Recorder = openFormWithAttributeRow();

      selectOption(operatorSelect(), optionText);

      const input: HTMLInputElement | null = valueInput();

      // Value-less and multi-select operators have no plain value box.
      if (input && !input.disabled) {
        fireEvent.change(input, { target: { value: "web" } });
      }

      const chips: Array<ActiveFilter> = previewChipsFor(
        recorder.latestLogMonitor!,
      );

      expect(() => {
        renderChips(chips);
      }).not.toThrow();

      expect(chips[0]!.displayValue).toBe(expectedText);
      expect(document.body.textContent).not.toContain("[object Object]");
    },
  );

  test("picking an operator does not disturb the criteria form itself", () => {
    /*
     * Companion to the chip tests above rather than a second guard on the
     * crash: the preview is stubbed here, so this half of the chain cannot
     * throw. What it does pin is that changing the operator leaves the form
     * and the modal alone — the failure mode reported separately against this
     * screen, where interacting with a filter row dismissed the dialog.
     */
    const recorder: Recorder = openFormWithAttributeRow();

    selectOption(operatorSelect(), "is any of");

    expect(screen.getByText("Filter by Attributes")).toBeInTheDocument();
    expect(screen.getByTestId("logs-preview")).toBeInTheDocument();
    expect(recorder.closeCount).toBe(0);
  });

  test("plain equality still produces the chip it always did", () => {
    const recorder: Recorder = openFormWithAttributeRow();

    fireEvent.change(valueInput(), { target: { value: "web" } });

    const chips: Array<ActiveFilter> = previewChipsFor(
      recorder.latestLogMonitor!,
    );

    expect(chips[0]!.displayValue).toBe("web");
  });
});
