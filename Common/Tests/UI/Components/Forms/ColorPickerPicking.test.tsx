import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import ColorPicker from "../../../../UI/Components/Forms/Fields/ColorPicker";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Modal from "../../../../UI/Components/Modal/Modal";
import Color from "../../../../Types/Color";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Issue #3143: on Settings > Labels > Create Label, choosing a colour made the
 * whole modal vanish and threw the half-filled form away. Label Color is
 * required, so that left no way to create a label at all.
 *
 * The dismissal itself was a Modal-level bug (#3133): ColorPicker portals its
 * popup to document.body so the modal body cannot clip it, and React dispatches
 * synthetic events through the REACT tree, so a press inside the popup still
 * reached the backdrop handler — which read "not a DOM descendant of the panel"
 * as "outside" and closed the dialog.
 *
 * ModalPortalDismissal.test.tsx states that contract for every portalling
 * surface, but it presses the popup's hex box. What the bug report actually
 * shows is a *drag across the saturation square*, and that is a different event
 * sequence: react-color takes the press, binds mousemove and mouseup on window,
 * and the click that finally bubbles into Modal arrives after the colour has
 * already changed under it. These tests drive the real ChromePicker through
 * that sequence, end to end, up to the value the form submits.
 */

/*
 * react-color reads pageX/pageY to work out where in the square the pointer
 * landed, and jsdom populates neither — its handler throws before it can
 * compute a colour, so nothing downstream of a press can be tested without
 * this. Nothing here scrolls, so the client coordinates are the page ones.
 */
const definePageCoordinates: () => void = (): void => {
  ["pageX", "pageY"].forEach((property: string) => {
    Object.defineProperty(MouseEvent.prototype, property, {
      configurable: true,
      get(this: MouseEvent): number {
        return property === "pageX" ? this.clientX : this.clientY;
      },
    });
  });
};

const deletePageCoordinates: () => void = (): void => {
  Reflect.deleteProperty(MouseEvent.prototype, "pageX");
  Reflect.deleteProperty(MouseEvent.prototype, "pageY");
};

/*
 * The saturation square and the hue strip both measure themselves to map a
 * pointer position onto a colour, and every box in jsdom is zero by zero.
 */
const SATURATION_BOX_WIDTH_PX: number = 200;
const SATURATION_BOX_HEIGHT_PX: number = 120;
const HUE_STRIP_WIDTH_PX: number = 200;
const HUE_STRIP_HEIGHT_PX: number = 10;

type GiveElementABoxFunction = (
  element: HTMLElement,
  width: number,
  height: number,
) => void;

const giveElementABox: GiveElementABoxFunction = (
  element: HTMLElement,
  width: number,
  height: number,
): void => {
  element.getBoundingClientRect = (): DOMRect => {
    return {
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: (): Record<string, never> => {
        return {};
      },
    } as DOMRect;
  };
};

interface PickerHarness {
  onClose: MockFunction;
  onChange: MockFunction;
}

type OpenPickerFunction = () => HTMLElement;

const openPicker: OpenPickerFunction = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("color-value"));

  return screen.getByTestId("color-picker-popup");
};

/*
 * The elements react-color takes the press on and measures itself against. The
 * saturation one carries no class of its own — it is the parent of the
 * `.saturation-white` overlay; the hue strip is `.hue-horizontal` itself.
 */
type GetSurfaceFunction = (popup: HTMLElement) => HTMLElement;

const getSaturationSquare: GetSurfaceFunction = (
  popup: HTMLElement,
): HTMLElement => {
  const overlay: HTMLElement | null = popup.querySelector(".saturation-white");

  if (!overlay?.parentElement) {
    throw new Error("ChromePicker did not render a saturation square.");
  }

  giveElementABox(
    overlay.parentElement,
    SATURATION_BOX_WIDTH_PX,
    SATURATION_BOX_HEIGHT_PX,
  );

  return overlay.parentElement;
};

const getHueStrip: GetSurfaceFunction = (popup: HTMLElement): HTMLElement => {
  const strip: HTMLElement | null = popup.querySelector(".hue-horizontal");

  if (!strip) {
    throw new Error("ChromePicker did not render a hue strip.");
  }

  giveElementABox(strip, HUE_STRIP_WIDTH_PX, HUE_STRIP_HEIGHT_PX);

  return strip;
};

interface Point {
  x: number;
  y: number;
}

/*
 * A real pointer drag, in the order a browser fires it: the press lands on the
 * square, the moves and the release go to window because that is where
 * react-color binds them, and the click arrives last on the element the press
 * started on.
 */
type DragFunction = (element: HTMLElement, from: Point, to: Point) => void;

const drag: DragFunction = (
  element: HTMLElement,
  from: Point,
  to: Point,
): void => {
  fireEvent.mouseDown(element, { clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(window, { clientX: to.x, clientY: to.y });
  fireEvent.click(element, { clientX: to.x, clientY: to.y });
};

type RenderPickerInModalFunction = () => PickerHarness;

const renderPickerInModal: RenderPickerInModalFunction = (): PickerHarness => {
  const onClose: MockFunction = getJestMockFunction();
  const onChange: MockFunction = getJestMockFunction();

  render(
    <Modal title="Create New Label" onClose={onClose}>
      <ColorPicker
        dataTestId="color-value"
        placeholder="Please select color for this label."
        onChange={onChange}
      />
    </Modal>,
  );

  return { onChange, onClose };
};

type GetColorFieldFunction = () => HTMLInputElement;

const getColorField: GetColorFieldFunction = (): HTMLInputElement => {
  return screen.getByTestId("color-value") as HTMLInputElement;
};

describe("Picking a colour inside a modal (issue #3143)", () => {
  beforeAll(() => {
    definePageCoordinates();
  });

  afterAll(() => {
    deletePageCoordinates();
  });

  afterEach(() => {
    cleanup();
  });

  describe("the reported flow: dragging across the saturation square", () => {
    test("keeps the modal open, keeps the popup open and reports the colour", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);

      // Half across, half down: full-saturation, half-brightness red.
      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });

      await waitFor(() => {
        expect(harness.onChange).toHaveBeenCalled();
      });

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

      const picked: Color = harness.onChange.mock.calls[
        harness.onChange.mock.calls.length - 1
      ]![0] as Color;

      expect(picked).toBeInstanceOf(Color);
      expect(picked.toString()).toMatch(/^#[0-9a-f]{6}$/i);
      expect(getColorField().value).toEqual(picked.toString());
    });

    test("the press does not arm the backdrop, so the next click is harmless", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });

      /*
       * Modal remembers where a press started so that selecting text and
       * releasing past the panel edge is not a dismissal. A press that began in
       * the portalled popup must not leave that memory set to "outside".
       */
      fireEvent.click(screen.getByTestId("modal-title"));

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("a drag that leaves the popup and releases over the backdrop keeps the modal", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);
      const backdropLayer: HTMLElement =
        screen.getByTestId("modal").parentElement!;

      /*
       * Overshooting a 200px-wide square is the normal way to reach full
       * saturation. react-color clamps the coordinates; the release lands on
       * the backdrop, and the browser then fires the click on the nearest
       * common ancestor of press and release, which is the body.
       */
      fireEvent.mouseDown(square, { clientX: 100, clientY: 60 });
      fireEvent.mouseMove(window, { clientX: 900, clientY: 900 });
      fireEvent.mouseUp(backdropLayer, { clientX: 900, clientY: 900 });
      fireEvent.click(document.body, { clientX: 900, clientY: 900 });

      await waitFor(() => {
        expect(harness.onChange).toHaveBeenCalled();
      });

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
  });

  describe("the other two ways to pick a colour", () => {
    test("dragging the hue strip keeps the modal open and changes the colour", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);

      // Give it a saturated colour first, so a hue change is visible in the hex.
      drag(square, { x: 200, y: 0 }, { x: 200, y: 0 });

      await waitFor(() => {
        expect(harness.onChange).toHaveBeenCalled();
      });

      const beforeHueChange: string = getColorField().value;
      const hueStrip: HTMLElement = getHueStrip(popup);

      drag(hueStrip, { x: 10, y: 5 }, { x: 120, y: 5 });

      await waitFor(() => {
        expect(getColorField().value).not.toEqual(beforeHueChange);
      });

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("typing a hex into the popup keeps the modal open and reports the colour", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const hexBox: HTMLInputElement = popup.querySelector(
        "input",
      ) as HTMLInputElement;

      fireEvent.mouseDown(hexBox);
      fireEvent.click(hexBox);
      fireEvent.change(hexBox, { target: { value: "#32a852" } });

      await waitFor(() => {
        expect(harness.onChange).toHaveBeenCalledWith(new Color("#32a852"));
      });

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(getColorField().value).toEqual("#32a852");
    });
  });

  describe("the value the form gets is the value on screen", () => {
    test("a picked colour reaches onChange in the same tick the field shows it", () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);

      /*
       * The picker used to paint the swatch from react-color's onChange and
       * feed the form from onChangeComplete, which is debounced by 100ms — so
       * for that window the field showed a colour the form did not hold. No
       * waitFor here: that the two agree immediately is the point of the test.
       */
      fireEvent.mouseDown(square, { clientX: 100, clientY: 60 });

      expect(harness.onChange).toHaveBeenCalled();

      const reported: Color = harness.onChange.mock.calls[
        harness.onChange.mock.calls.length - 1
      ]![0] as Color;

      expect(getColorField().value).toEqual(reported.toString());
    });

    test("there is no alpha channel to produce a colour the column cannot hold", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();

      /*
       * react-color reports a fully transparent colour as the literal string
       * "transparent" — eleven characters, where Label.color holds ten, and
       * Color validates nothing on the way through. Dropping the alpha slider
       * is what stops the field producing a value that cannot be saved.
       */
      expect(popup.querySelector(".alpha-picker")).toBeNull();

      const square: HTMLElement = getSaturationSquare(popup);

      // The corner that is #000000, the only colour react-color calls transparent.
      drag(square, { x: 0, y: 120 }, { x: 0, y: 120 });

      await waitFor(() => {
        expect(harness.onChange).toHaveBeenCalled();
      });

      harness.onChange.mock.calls.forEach((call: Array<unknown>) => {
        expect((call[0] as Color).toString()).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  describe("the required error is reachable, not just visible", () => {
    test("the field points at its own message and is marked invalid", () => {
      render(
        <ColorPicker
          dataTestId="color-value"
          placeholder="Please select color for this label."
          error="Label Color is required."
          onChange={getJestMockFunction()}
        />,
      );

      const field: HTMLInputElement = getColorField();
      const message: HTMLElement = screen.getByTestId("error-message");

      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field.getAttribute("aria-describedby")).toEqual(message.id);
      expect(message.id).toBeTruthy();
      expect(message).toHaveAttribute("role", "alert");
      expect(message).toHaveTextContent("Label Color is required.");
    });

    test("a field with no error advertises neither", () => {
      renderPickerInModal();

      const field: HTMLInputElement = getColorField();

      expect(field).not.toHaveAttribute("aria-invalid");
      expect(field).not.toHaveAttribute("aria-describedby");
    });
  });

  describe("the modal is still dismissable the ordinary ways", () => {
    test("a press that starts and ends on the backdrop still closes it", () => {
      const harness: PickerHarness = renderPickerInModal();
      const backdropLayer: HTMLElement =
        screen.getByTestId("modal").parentElement!;

      fireEvent.mouseDown(backdropLayer);
      fireEvent.mouseUp(backdropLayer);
      fireEvent.click(backdropLayer);

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("with the picker open, the first backdrop press only puts the picker away", () => {
      const harness: PickerHarness = renderPickerInModal();
      const backdropLayer: HTMLElement =
        screen.getByTestId("modal").parentElement!;

      openPicker();

      fireEvent.mouseDown(backdropLayer);
      fireEvent.mouseUp(backdropLayer);
      fireEvent.click(backdropLayer);

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(harness.onClose).not.toHaveBeenCalled();

      // The picker gone, the next press dismisses the dialog as usual.
      fireEvent.mouseDown(backdropLayer);
      fireEvent.mouseUp(backdropLayer);
      fireEvent.click(backdropLayer);

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("the close button still works after a colour has been dragged out", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });

      await waitFor(() => {
        expect(harness.onChange).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByTestId("close-button"));

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("Escape dismisses the popup first and the modal second", async () => {
      const harness: PickerHarness = renderPickerInModal();
      const popup: HTMLElement = openPicker();

      fireEvent.keyDown(popup, { key: "Escape" });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(harness.onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(getColorField(), { key: "Escape" });

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * The report is about a form, not a component: the point of picking a colour
   * is that "Label Color is required." goes away and the value reaches submit.
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
        dataTestId: "color-value",
      },
    ];

    type RenderLabelFormFunction = (onSubmit: MockFunction) => ReactElement;

    const renderLabelForm: RenderLabelFormFunction = (
      onSubmit: MockFunction,
    ): ReactElement => {
      return (
        <Modal title="Create New Label" onClose={getJestMockFunction()}>
          <BasicForm
            id="create-label"
            fields={LABEL_FIELDS}
            onSubmit={onSubmit}
            submitButtonText="Create Label"
          />
        </Modal>
      );
    };

    test("picking a colour clears the required error and submits the value", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      render(renderLabelForm(onSubmit));

      fireEvent.change(screen.getByTestId("name"), {
        target: { value: "WB Unit-BB" },
      });

      // The state the report ends in: blocked, with nowhere to go.
      fireEvent.click(screen.getByRole("button", { name: /create label/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Label Color is required."),
        ).toBeInTheDocument();
      });

      expect(onSubmit).not.toHaveBeenCalled();

      const popup: HTMLElement = openPicker();
      const square: HTMLElement = getSaturationSquare(popup);

      drag(square, { x: 20, y: 20 }, { x: 100, y: 60 });

      await waitFor(() => {
        expect(screen.queryByText("Label Color is required.")).toBeNull();
      });

      expect(screen.getByTestId("modal")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /create label/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const submitted: Record<string, unknown> = onSubmit.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(submitted["name"]).toEqual("WB Unit-BB");
      expect(submitted["color"]).toBeInstanceOf(Color);
      expect((submitted["color"] as Color).toString()).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
    });
  });
});
