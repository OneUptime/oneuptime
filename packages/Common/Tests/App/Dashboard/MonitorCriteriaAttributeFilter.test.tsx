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
 * Both previews render a live telemetry viewer that lists logs/spans over the
 * API. Nothing in this file is about the preview, and mounting the real one
 * would only add network to a test that is about clicks.
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TraceMonitor/TraceMonitorPreview",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="spans-preview" />;
      },
    };
  },
);

import LogMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom";
import TraceMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import Modal from "../../../UI/Components/Modal/Modal";
import BasicForm from "../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * Reported as: "when I try to filter the criteria by attributes it just closes
 * the window". Monitor → Criteria → Edit Monitoring Criteria → Show Advanced
 * Options → Add Filter by Attributes → click the Key box → pick a key off the
 * suggestion list, and the whole Edit Monitor dialog disappears, taking the
 * criteria the user was editing with it.
 *
 * Two separate defects reached that screen, and both are pinned here:
 *
 *   1. The suggestion list is portalled to document.body so the modal's scroll
 *      container cannot clip it, and React dispatches synthetic events through
 *      the React tree rather than the DOM tree. Picking an option therefore
 *      bubbled into Modal's backdrop handler, which decided "outside" by asking
 *      whether the panel DOM-contains the target — a portalled option never is.
 *      Fixed in Modal (#3133); the mechanism is covered in
 *      Common/Tests/UI/Components/ModalPortalDismissal.test.tsx. What was
 *      missing was coverage of the surface the user actually reported, which is
 *      this one: the criteria editor, where the autocomplete sits at the bottom
 *      of a nested form inside a scrolled modal body.
 *
 *   2. Clearing a Number-typed attribute value deleted the array member rather
 *      than emptying it, which dropped the row and then crashed the form on the
 *      next render. Fixed in Dictionary; the row-level tests are in
 *      Common/Tests/UI/Components/DictionaryAttributeFilterRow.test.tsx.
 *
 * The harness runs the real chain from the modal down: Modal → the outer
 * BasicForm → the step form → its own nested BasicForm → FormField → Dictionary
 * → AutocompleteTextInput. Faking any layer of that would lose the thing that
 * made this a bug — the portal boundary between the option and the panel.
 *
 * Every pick fires mousedown *and* click. Modal only dismisses on a press that
 * both starts and ends outside the panel, so a click-only test passes with the
 * bug fully present.
 */

const ATTRIBUTE_KEYS: Array<string> = [
  "{OriginalFormat}",
  "Action",
  "ActionId",
  "ActionName",
  "ActionType",
  "AlreadyCancelled",
];

interface Recorder {
  closeCount: number;
  latestLogMonitor: MonitorStepLogMonitor | null;
  latestTraceMonitor: MonitorStepTraceMonitor | null;
}

type NewRecorderFunction = () => Recorder;

const newRecorder: NewRecorderFunction = (): Recorder => {
  return { closeCount: 0, latestLogMonitor: null, latestTraceMonitor: null };
};

/*
 * Mirrors the criteria editor: CardModelDetail puts the step form inside a
 * ModelFormModal, so the step form's own BasicForm is nested inside the modal
 * form. That nesting is load-bearing here — it is the shape the user was in.
 */
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

const TraceHarness: React.FunctionComponent<{ recorder: Recorder }> = (props: {
  recorder: Recorder;
}): ReactElement => {
  const [traceMonitor, setTraceMonitor] =
    React.useState<MonitorStepTraceMonitor>(
      MonitorStepTraceMonitorUtil.getDefault(),
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
                <TraceMonitorStepForm
                  monitorStepTraceMonitor={traceMonitor}
                  onMonitorStepTraceMonitorChanged={(
                    value: MonitorStepTraceMonitor,
                  ) => {
                    props.recorder.latestTraceMonitor = value;
                    setTraceMonitor(value);
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

/*
 * AutocompleteTextInput and react-select both report role="combobox". The
 * listbox each autocomplete owns is the only stable way to tell them apart.
 */
type AutocompleteInputsFunction = () => Array<HTMLInputElement>;

const autocompleteInputs: AutocompleteInputsFunction =
  (): Array<HTMLInputElement> => {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[aria-controls^="autocomplete-suggestions-"]',
      ),
    );
  };

type KeyInputFunction = () => HTMLInputElement;

const keyInput: KeyInputFunction = (): HTMLInputElement => {
  return autocompleteInputs().filter((input: HTMLInputElement) => {
    return input.getAttribute("placeholder") !== "Value";
  })[0]!;
};

type ValueInputFunction = () => HTMLInputElement;

const valueInput: ValueInputFunction = (): HTMLInputElement => {
  return autocompleteInputs().filter((input: HTMLInputElement) => {
    return input.getAttribute("placeholder") === "Value";
  })[0]!;
};

// A real pointer press is mousedown-then-click; Modal watches both ends.
type PressFunction = (element: HTMLElement) => void;

const press: PressFunction = (element: HTMLElement): void => {
  fireEvent.mouseDown(element);
  fireEvent.click(element);
};

/*
 * The layer a user actually presses to dismiss is the one the panel is centred
 * in; the tinted sheet behind it is aria-hidden and inert.
 */
type BackdropLayerFunction = () => HTMLElement;

const backdropLayer: BackdropLayerFunction = (): HTMLElement => {
  return screen.getByTestId("modal").parentElement!;
};

// Walks the video: open the advanced section, then add one attribute filter.
type OpenAttributeFilterFunction = () => void;

const openAttributeFilter: OpenAttributeFilterFunction = (): void => {
  const showAdvanced: HTMLElement | null = screen.queryByText(
    "Show Advanced Options",
  );

  if (showAdvanced) {
    fireEvent.click(showAdvanced);
  }

  fireEvent.click(screen.getByText("Add Filter by Attributes"));
};

type RenderLogHarnessFunction = () => Recorder;

const renderLogHarness: RenderLogHarnessFunction = (): Recorder => {
  const recorder: Recorder = newRecorder();
  render(<LogHarness recorder={recorder} />);
  openAttributeFilter();
  return recorder;
};

describe("Monitoring criteria — Filter by Attributes", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the reported bug: picking a key must not close the modal", () => {
    test("the suggestion list is portalled outside the modal panel", () => {
      renderLogHarness();

      fireEvent.focus(keyInput());

      /*
       * The precondition that made this a bug at all. If the menu ever stops
       * being portalled, the Modal contract below is no longer what protects
       * this screen — and this test says so before the others start passing
       * for the wrong reason.
       */
      expect(
        screen.getByTestId("modal").contains(screen.getByText("ActionName")),
      ).toBe(false);
    });

    test("picking a suggested key leaves the modal open", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));

      expect(recorder.closeCount).toBe(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("picking a suggested key fills the row in", () => {
      renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));

      expect(keyInput().value).toBe("ActionName");
    });

    test("the whole form the user filled in survives the pick", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));

      // Everything the modal was showing is still on screen.
      expect(screen.getByText("Filter by Attributes")).toBeInTheDocument();
      expect(screen.getByText("Log Severity")).toBeInTheDocument();
      expect(recorder.closeCount).toBe(0);
    });

    test("the picked attribute reaches the monitor step", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));
      fireEvent.change(valueInput(), { target: { value: "checkout" } });

      expect(recorder.latestLogMonitor?.attributes).toEqual({
        ActionName: "checkout",
      });
      expect(recorder.closeCount).toBe(0);
    });

    test("picking a second key on a second row also leaves the modal open", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));

      fireEvent.click(screen.getByText("Add Filter by Attributes"));

      const secondKeyInput: HTMLInputElement = autocompleteInputs().filter(
        (input: HTMLInputElement) => {
          return (
            input.getAttribute("placeholder") !== "Value" && input.value === ""
          );
        },
      )[0]!;

      fireEvent.focus(secondKeyInput);
      press(screen.getByText("ActionType"));

      expect(recorder.closeCount).toBe(0);
      expect(recorder.latestLogMonitor?.attributes).toEqual({
        ActionName: "",
        ActionType: "",
      });
    });

    test("the same pick on the Traces criteria form leaves the modal open", () => {
      const recorder: Recorder = newRecorder();
      render(<TraceHarness recorder={recorder} />);
      openAttributeFilter();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));

      expect(recorder.closeCount).toBe(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(keyInput().value).toBe("ActionName");
    });
  });

  describe("the rest of the row, from inside the modal", () => {
    test("choosing a key with the keyboard leaves the modal open", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      fireEvent.keyDown(keyInput(), { key: "ArrowDown" });
      fireEvent.keyDown(keyInput(), { key: "Enter" });

      expect(recorder.closeCount).toBe(0);
      expect(keyInput().value).toBe("{OriginalFormat}");
    });

    test("Enter with nothing highlighted does not close the modal", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      fireEvent.keyDown(keyInput(), { key: "Enter" });

      expect(recorder.closeCount).toBe(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("Escape closes the suggestion list, not the modal", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);

      fireEvent.keyDown(keyInput(), { key: "Escape" });

      expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(0);
      expect(recorder.closeCount).toBe(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("a second Escape, with the list closed, does close the modal", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      fireEvent.keyDown(keyInput(), { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });

      expect(recorder.closeCount).toBe(1);
    });

    test("typing a value keeps the modal open", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));
      fireEvent.change(valueInput(), { target: { value: "checkout" } });

      expect(recorder.closeCount).toBe(0);
      expect(valueInput().value).toBe("checkout");
    });

    test("deleting the row keeps the modal open", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));

      press(screen.getByTestId("delete-ActionName"));

      expect(recorder.closeCount).toBe(0);
      expect(autocompleteInputs()).toHaveLength(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
  });

  /*
   * The second defect, seen from the screen it broke. A Number-typed row that
   * had its value cleared used to vanish, and the next "Add Filter by
   * Attributes" click rendered an `undefined` row and threw — which, inside a
   * modal, is another way for the window to just go away.
   */
  describe("a Number-typed attribute value", () => {
    type SwitchToNumberFunction = () => void;

    const switchToNumber: SwitchToNumberFunction = (): void => {
      /*
       * The step form has dropdowns of its own above the filter list, so the
       * type select has to be found relative to the row rather than by a
       * position in the whole modal. Within a row the comboboxes run: key
       * autocomplete, operator select, type select, value autocomplete.
       */
      const row: HTMLElement = keyInput().closest(
        "div.flex.items-start",
      ) as HTMLElement;
      const typeSelect: HTMLElement =
        row.querySelectorAll<HTMLElement>('[role="combobox"]')[2]!;

      fireEvent.keyDown(typeSelect, { key: "ArrowDown" });
      press(screen.getByText("Number"));
    };

    test("clearing it keeps the row and the modal", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionId"));
      switchToNumber();

      const numberInput: HTMLInputElement = document.querySelector(
        'input[type="number"]',
      ) as HTMLInputElement;
      fireEvent.change(numberInput, { target: { value: "5" } });
      expect(recorder.latestLogMonitor?.attributes).toEqual({ ActionId: 5 });

      fireEvent.change(numberInput, { target: { value: "" } });

      expect(keyInput().value).toBe("ActionId");
      expect(recorder.latestLogMonitor?.attributes).toEqual({});
      expect(recorder.closeCount).toBe(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("adding another row after clearing it does not blow the modal up", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionId"));
      switchToNumber();

      const numberInput: HTMLInputElement = document.querySelector(
        'input[type="number"]',
      ) as HTMLInputElement;
      fireEvent.change(numberInput, { target: { value: "5" } });
      fireEvent.change(numberInput, { target: { value: "" } });

      // The click that used to throw on the very next render.
      fireEvent.click(screen.getByText("Add Filter by Attributes"));

      expect(recorder.closeCount).toBe(0);
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(screen.getByText("Filter by Attributes")).toBeInTheDocument();
    });
  });

  /*
   * The Modal fix narrows what counts as a backdrop press, so the far more
   * common behaviour next to it has to be pinned just as hard on this screen —
   * a criteria modal nobody can dismiss would be a worse bug than the one it
   * replaced.
   */
  describe("the modal is still dismissable the ordinary way", () => {
    test("a press on the backdrop closes it", () => {
      const recorder: Recorder = renderLogHarness();

      press(backdropLayer());

      expect(recorder.closeCount).toBe(1);
    });

    test("a press on the backdrop still closes it after a key was picked", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));
      expect(recorder.closeCount).toBe(0);

      press(backdropLayer());

      expect(recorder.closeCount).toBe(1);
    });

    test("the close button still closes it while the suggestion list is open", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      fireEvent.click(screen.getByTestId("close-button"));

      expect(recorder.closeCount).toBe(1);
    });

    test("Cancel still closes it", () => {
      const recorder: Recorder = renderLogHarness();

      fireEvent.focus(keyInput());
      press(screen.getByText("ActionName"));
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));

      expect(recorder.closeCount).toBe(1);
    });
  });
});
