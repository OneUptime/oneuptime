import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import ColorPicker, {
  ColorPickerLayout,
} from "../../../../UI/Components/Forms/Fields/ColorPicker";
import { COLOR_PICKER_SWATCHES } from "../../../../UI/Components/ColorPicker/ColorPalette";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Modal from "../../../../UI/Components/Modal/Modal";
import Color from "../../../../Types/Color";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import {
  colorOf,
  getColorField,
  getSwatch,
  openCustomPanel,
  openPopover,
} from "../ColorPicker/ColorPickerDriver";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #3143: on Settings > Labels > Create Label, choosing a color made the
 * whole dialog vanish and threw the half-filled form away. Label Color is
 * required, so that left no way to create a label at all.
 *
 * The picker is new - swatches in the form, the fine picker under them, and
 * a popover only where a row has room for one control - but every gesture
 * that once dismissed the dialog is still a gesture people make: a press in
 * the picker, a drag across the saturation square that overshoots and lets
 * go over the backdrop, a backdrop press meant for an open popover, Escape.
 * These drive each of them through a real Modal, up to the value the Label
 * form submits.
 */

const SQUARE: { width: number; height: number } = { width: 200, height: 120 };

const giveBox: (element: HTMLElement) => void = (element: HTMLElement): void => {
  element.getBoundingClientRect = (): DOMRect => {
    return {
      bottom: SQUARE.height,
      height: SQUARE.height,
      left: 0,
      right: SQUARE.width,
      top: 0,
      width: SQUARE.width,
      x: 0,
      y: 0,
      toJSON: (): Record<string, never> => {
        return {};
      },
    } as DOMRect;
  };
};

interface Harness {
  onClose: MockFunction;
  onChange: MockFunction;
  field: HTMLElement;
}

const renderInModal: (layout: ColorPickerLayout) => Harness = (
  layout: ColorPickerLayout,
): Harness => {
  const onClose: MockFunction = getJestMockFunction();
  const onChange: MockFunction = getJestMockFunction();

  const Field: () => ReactElement = (): ReactElement => {
    const [value, setValue] = useState<string>("#0d9488");

    return (
      <ColorPicker
        layout={layout}
        dataTestId="label-color"
        value={value}
        isClearable={false}
        onChange={(color: Color | null) => {
          onChange(color);
          setValue(color ? color.toString() : "");
        }}
      />
    );
  };

  render(
    <Modal title="Create New Label" onClose={onClose}>
      <Field />
    </Modal>,
  );

  return { onClose, onChange, field: getColorField("label-color") };
};

// The layer Modal reads backdrop presses from.
const getBackdrop: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal").parentElement!;
};

// The custom square, inline or in the popover, with a box to measure.
const getSquare: (scope: HTMLElement) => HTMLElement = (
  scope: HTMLElement,
): HTMLElement => {
  const square: HTMLElement = within(scope).getByTestId(
    "color-picker-saturation",
  );

  giveBox(square);

  return square;
};

interface Point {
  x: number;
  y: number;
}

/*
 * A real pointer drag, in the order a browser fires it: the press on the
 * square, the moves and the release on window (where the square listens for
 * them), and the click last, on the element the press started on.
 */
const drag: (element: HTMLElement, from: Point, to: Point) => void = (
  element: HTMLElement,
  from: Point,
  to: Point,
): void => {
  act(() => {
    fireEvent.mouseDown(element, { button: 0, clientX: from.x, clientY: from.y });
    fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
    fireEvent.mouseUp(window, { clientX: to.x, clientY: to.y });
    fireEvent.click(element, { clientX: to.x, clientY: to.y });
  });
};

const press: (element: HTMLElement) => void = (element: HTMLElement): void => {
  act(() => {
    fireEvent.mouseDown(element);
    fireEvent.mouseUp(element);
    fireEvent.click(element);
  });
};

const lastColor: (onChange: MockFunction) => Color = (
  onChange: MockFunction,
): Color => {
  return onChange.mock.calls[onChange.mock.calls.length - 1]![0] as Color;
};

describe("Picking a color inside a dialog (issue #3143)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("in a form: the swatches and the fine picker under them", () => {
    test("a click on a swatch keeps the dialog open, and the field shows it in the same tick", () => {
      const { field, onChange, onClose } = renderInModal("inline");

      press(getSwatch(field, "Orange"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(colorOf(field)).toBe(lastColor(onChange).toString());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("the reported flow, a drag across the saturation square, keeps the dialog and the picker open", () => {
      const { field, onChange, onClose } = renderInModal("inline");
      const square: HTMLElement = getSquare(openCustomPanel(field));

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });

      expect(onChange).toHaveBeenCalled();
      expect(lastColor(onChange)).toBeInstanceOf(Color);
      expect(lastColor(onChange).toString()).toMatch(/^#[0-9a-f]{6}$/);
      expect(colorOf(field)).toBe(lastColor(onChange).toString());
      expect(onClose).not.toHaveBeenCalled();
      expect(
        within(field).getByTestId("color-picker-custom-panel"),
      ).toBeInTheDocument();
    });

    test("a drag that overshoots and lets go over the backdrop keeps the dialog", () => {
      const { field, onChange, onClose } = renderInModal("inline");
      const square: HTMLElement = getSquare(openCustomPanel(field));

      act(() => {
        fireEvent.mouseDown(square, { button: 0, clientX: 100, clientY: 60 });
        fireEvent.mouseMove(window, { clientX: 900, clientY: 900 });
        fireEvent.mouseUp(getBackdrop(), { clientX: 900, clientY: 900 });
        fireEvent.click(document.body, { clientX: 900, clientY: 900 });
      });

      // Held to the corner it overshot: black, not "transparent".
      expect(lastColor(onChange).toString()).toBe("#000000");
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("the press does not arm the backdrop, so the next click is harmless", () => {
      const { field, onClose } = renderInModal("inline");
      const square: HTMLElement = getSquare(openCustomPanel(field));

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });
      fireEvent.click(screen.getByTestId("modal-title"));

      expect(onClose).not.toHaveBeenCalled();
    });

    test("Escape in the fine picker puts it away and leaves the dialog", () => {
      const { field, onClose } = renderInModal("inline");
      const panel: HTMLElement = openCustomPanel(field);

      act(() => {
        fireEvent.keyDown(within(panel).getByTestId("color-picker-code"), {
          key: "Escape",
        });
      });

      expect(within(field).queryByTestId("color-picker-custom-panel")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      // Nothing open in the field: the next Escape is the dialog's.
      act(() => {
        fireEvent.keyDown(getSwatch(field, "Teal"), { key: "Escape" });
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("in a row: the popover", () => {
    test("pressing inside the popover keeps the dialog open", () => {
      const { field, onChange, onClose } = renderInModal("compact");
      const popup: HTMLElement = openPopover(field);

      expect(screen.getByTestId("modal").contains(popup)).toBe(false);

      press(getSwatch(popup, "Lime"));

      expect(lastColor(onChange).toString()).toBe(
        COLOR_PICKER_SWATCHES.find((swatch: { name: string }): boolean => {
          return swatch.name === "Lime";
        })!.hex,
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("a drag in the popover's square that lets go over the backdrop keeps the dialog", () => {
      const { field, onChange, onClose } = renderInModal("compact");
      const popup: HTMLElement = openPopover(field);

      act(() => {
        fireEvent.click(within(popup).getByTestId("color-picker-custom"), {
          detail: 1,
        });
      });

      const square: HTMLElement = getSquare(popup);

      act(() => {
        fireEvent.mouseDown(square, { button: 0, clientX: 100, clientY: 60 });
        fireEvent.mouseMove(window, { clientX: 900, clientY: 900 });
        fireEvent.mouseUp(getBackdrop(), { clientX: 900, clientY: 900 });
        fireEvent.click(document.body, { clientX: 900, clientY: 900 });
      });

      expect(onChange).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("with the popover open, the first backdrop press only puts it away", () => {
      const { field, onClose } = renderInModal("compact");

      openPopover(field);
      press(getBackdrop());

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      // The popover gone, the next press dismisses the dialog as usual.
      press(getBackdrop());

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("Escape dismisses the popover first and the dialog second", () => {
      const { field, onClose } = renderInModal("compact");
      const popup: HTMLElement = openPopover(field);

      act(() => {
        fireEvent.keyDown(popup, { key: "Escape" });
      });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      act(() => {
        fireEvent.keyDown(document.activeElement || document.body, {
          key: "Escape",
        });
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("the dialog is still dismissable the ordinary ways", () => {
    test("a press that starts and ends on the backdrop closes it", () => {
      const { onClose } = renderInModal("inline");

      press(getBackdrop());

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("the close button works after a color has been dragged out", () => {
      const { field, onClose } = renderInModal("inline");
      const square: HTMLElement = getSquare(openCustomPanel(field));

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });
      fireEvent.click(screen.getByTestId("close-button"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * The report is about a form, not a component: the point of picking a
   * color is that "Label Color is required." goes away and the value
   * reaches submit.
   */
  describe("through the Label form the bug was reported on", () => {
    const LABEL_FIELDS: Fields<FormValues<Record<string, unknown>>> = [
      {
        field: { name: true },
        title: "Name",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        dataTestId: "name",
      },
      {
        field: { color: true },
        title: "Label Color",
        fieldType: FormFieldSchemaType.Color,
        required: true,
        placeholder: "Please select color for this label.",
        dataTestId: "label-color",
      },
    ];

    const renderLabelForm: (onSubmit: MockFunction) => void = (
      onSubmit: MockFunction,
    ): void => {
      render(
        <Modal title="Create New Label" onClose={getJestMockFunction()}>
          <BasicForm
            id="create-label"
            fields={LABEL_FIELDS}
            onSubmit={onSubmit}
            submitButtonText="Create Label"
          />
        </Modal>,
      );
    };

    test("a swatch clears the required error and is the value submitted", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      renderLabelForm(onSubmit);

      fireEvent.change(screen.getByTestId("name"), {
        target: { value: "WB Unit-BB" },
      });

      // The state the report ends in: blocked.
      fireEvent.click(screen.getByRole("button", { name: /create label/i }));

      await waitFor(() => {
        expect(screen.getByText("Label Color is required.")).toBeInTheDocument();
      });

      expect(onSubmit).not.toHaveBeenCalled();

      const field: HTMLElement = getColorField("label-color");

      press(getSwatch(field, "Teal"));

      await waitFor(() => {
        expect(screen.queryByText("Label Color is required.")).toBeNull();
      });

      fireEvent.click(screen.getByRole("button", { name: /create label/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const submitted: Record<string, unknown> = onSubmit.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(submitted["name"]).toEqual("WB Unit-BB");
      expect(submitted["color"]).toBeInstanceOf(Color);
      expect((submitted["color"] as Color).toString()).toBe("#0d9488");
    });

    test("a dragged custom color is the value submitted", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      renderLabelForm(onSubmit);

      fireEvent.change(screen.getByTestId("name"), {
        target: { value: "payments" },
      });

      const field: HTMLElement = getColorField("label-color");
      const square: HTMLElement = getSquare(openCustomPanel(field));

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });

      const shown: string = colorOf(field);

      expect(shown).toMatch(/^#[0-9a-f]{6}$/);

      fireEvent.click(screen.getByRole("button", { name: /create label/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const submitted: Record<string, unknown> = onSubmit.mock
        .calls[0]![0] as Record<string, unknown>;

      expect((submitted["color"] as Color).toString()).toBe(shown);
    });
  });
});
