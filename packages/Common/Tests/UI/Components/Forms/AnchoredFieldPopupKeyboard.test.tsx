import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import ColorPicker from "../../../../UI/Components/Forms/Fields/ColorPicker";
import IconPicker from "../../../../UI/Components/Forms/Fields/IconPicker";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Modal from "../../../../UI/Components/Modal/Modal";
import Color from "../../../../Types/Color";
import IconProp from "../../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The colour and icon fields are triggers dressed as text boxes: a readOnly
 * input whose only job is to open a portalled popup, which it used to do on
 * click and on nothing else. Every key was dead. That left a keyboard user with
 * no way in at all — and on the Create Label form (issue #3143) the colour is
 * required, so no way in meant no way to submit the form either.
 *
 * Both fields drive UseAnchoredFieldPopup, so the behaviour is stated once per
 * field here and the shared parts are pinned in both.
 */

const OPENING_KEYS: Array<string> = ["Enter", " ", "ArrowDown", "ArrowUp"];

type RenderColorPickerFunction = (
  props?: Partial<{ readOnly: boolean; disabled: boolean }>,
) => MockFunction;

const renderColorPicker: RenderColorPickerFunction = (
  props: Partial<{ readOnly: boolean; disabled: boolean }> = {},
): MockFunction => {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <ColorPicker
      dataTestId="color-value"
      placeholder="Please select color for this label."
      onChange={onChange}
      readOnly={props.readOnly}
      disabled={props.disabled}
      tabIndex={0}
    />,
  );

  return onChange;
};

type GetFieldFunction = (testId: string) => HTMLInputElement;

const getField: GetFieldFunction = (testId: string): HTMLInputElement => {
  return screen.getByTestId(testId) as HTMLInputElement;
};

describe("Opening an anchored field popup from the keyboard", () => {
  afterEach(() => {
    cleanup();
  });

  describe("ColorPicker", () => {
    test.each(OPENING_KEYS)(
      "%p opens the popup and moves focus into it",
      (key: string) => {
        renderColorPicker();

        const field: HTMLInputElement = getField("color-value");

        field.focus();
        fireEvent.keyDown(field, { key });

        const popup: HTMLElement = screen.getByTestId("color-picker-popup");

        expect(popup).toBeInTheDocument();

        /*
         * Landing on the popup's first control is what makes the field
         * fillable: for a colour that control is ChromePicker's hex box, so
         * "open it and type the brand hex" is a complete keyboard path.
         */
        expect(popup.contains(document.activeElement)).toBe(true);
      },
    );

    test("a keyboard user can open the picker and set a hex end to end", async () => {
      const onChange: MockFunction = renderColorPicker();
      const field: HTMLInputElement = getField("color-value");

      field.focus();
      fireEvent.keyDown(field, { key: "Enter" });

      const focusedControl: HTMLElement = document.activeElement as HTMLElement;

      expect(focusedControl.tagName).toEqual("INPUT");

      fireEvent.change(focusedControl, { target: { value: "#32a852" } });

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(new Color("#32a852"));
      });

      // Escape puts the user back where they were, with the value kept.
      fireEvent.keyDown(focusedControl, { key: "Escape" });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(document.activeElement).toBe(field);
      expect(field.value).toEqual("#32a852");
    });

    test("an opening key is claimed, so nothing downstream acts on it too", () => {
      renderColorPicker();

      const field: HTMLInputElement = getField("color-value");

      /*
       * fireEvent returns false when a cancelable event had preventDefault
       * called on it. That is what stops Input's own onEnterPress from also
       * firing, and what would stop a real <form> around the field from
       * submitting on the way past.
       */
      expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
      expect(fireEvent.keyDown(field, { key: " " })).toBe(false);
    });

    test("Enter on an already open field moves focus in rather than closing it", () => {
      renderColorPicker();

      const field: HTMLInputElement = getField("color-value");

      fireEvent.click(field);

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      // A pointer user's popup opens under their cursor and leaves focus alone.
      expect(popup.contains(document.activeElement)).toBe(false);

      field.focus();
      fireEvent.keyDown(field, { key: "Enter" });

      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();
      expect(popup.contains(document.activeElement)).toBe(true);
    });

    test("keys that are not opening keys are left alone", () => {
      renderColorPicker();

      const field: HTMLInputElement = getField("color-value");

      expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(true);
      expect(fireEvent.keyDown(field, { key: "a" })).toBe(true);
      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    test("a readOnly field opens for neither pointer nor keyboard", () => {
      renderColorPicker({ readOnly: true });

      const field: HTMLInputElement = getField("color-value");

      fireEvent.click(field);
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.keyDown(field, { key: "ArrowDown" });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    test("a disabled field opens for neither pointer nor keyboard", () => {
      renderColorPicker({ disabled: true });

      const field: HTMLInputElement = getField("color-value");

      fireEvent.click(field);
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.keyDown(field, { key: "ArrowDown" });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    test("the field advertises the popup it controls", () => {
      renderColorPicker();

      const field: HTMLInputElement = getField("color-value");

      expect(field).toHaveAttribute("aria-haspopup", "dialog");
      expect(field).toHaveAttribute("aria-expanded", "false");
      expect(field).not.toHaveAttribute("aria-controls");

      fireEvent.click(field);

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      expect(field).toHaveAttribute("aria-expanded", "true");
      expect(field.getAttribute("aria-controls")).toEqual(popup.id);
      expect(popup.id).toBeTruthy();
      expect(popup).toHaveAttribute("role", "dialog");
      expect(popup).toHaveAttribute("aria-label", "Color picker");
    });
  });

  describe("IconPicker", () => {
    type RenderIconPickerFunction = () => MockFunction;

    const renderIconPicker: RenderIconPickerFunction = (): MockFunction => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <IconPicker
          dataTestId="icon-value"
          placeholder="No icon"
          onChange={onChange}
          tabIndex={0}
        />,
      );

      return onChange;
    };

    test.each(OPENING_KEYS)(
      "%p opens the popup and moves focus into it",
      (key: string) => {
        renderIconPicker();

        const field: HTMLInputElement = getField("icon-value");

        field.focus();
        fireEvent.keyDown(field, { key });

        const popup: HTMLElement = screen.getByTestId("icon-picker-popup");

        expect(popup).toBeInTheDocument();
        expect(popup.contains(document.activeElement)).toBe(true);
      },
    );

    test("a keyboard user can search for an icon and choose it", () => {
      const onChange: MockFunction = renderIconPicker();
      const field: HTMLInputElement = getField("icon-value");

      field.focus();
      fireEvent.keyDown(field, { key: "Enter" });

      const popup: HTMLElement = screen.getByTestId("icon-picker-popup");
      const searchBox: HTMLElement = document.activeElement as HTMLElement;

      expect(popup.contains(searchBox)).toBe(true);

      fireEvent.change(searchBox, { target: { value: IconProp.Alert } });

      /*
       * The cells used to be plain divs, so Tab skipped straight past the only
       * control that can set this field.
       */
      const cell: HTMLElement = within(popup).getByRole("button", {
        name: IconProp.Alert,
      });

      cell.focus();
      expect(document.activeElement).toBe(cell);

      fireEvent.click(cell);

      expect(onChange).toHaveBeenCalledWith(IconProp.Alert);
      expect(screen.queryByTestId("icon-picker-popup")).toBeNull();
      expect(document.activeElement).toBe(field);
      expect(field.value).toEqual(IconProp.Alert);
    });

    test("the field advertises the popup it controls", () => {
      renderIconPicker();

      const field: HTMLInputElement = getField("icon-value");

      expect(field).toHaveAttribute("aria-haspopup", "dialog");
      expect(field).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(field);

      const popup: HTMLElement = screen.getByTestId("icon-picker-popup");

      expect(field).toHaveAttribute("aria-expanded", "true");
      expect(field.getAttribute("aria-controls")).toEqual(popup.id);
      expect(popup).toHaveAttribute("role", "dialog");
      expect(popup).toHaveAttribute("aria-label", "Icon picker");
    });
  });

  /*
   * The two surfaces the field actually ships on: inside a form, where Enter is
   * a submit, and inside a modal, where Escape is a dismissal.
   */
  describe("inside the Label form and its modal", () => {
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
        dataTestId: "color-value",
      },
    ];

    test("Enter on the colour field opens the picker and posts nothing", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <BasicForm
          id="create-label"
          fields={LABEL_FIELDS}
          onSubmit={onSubmit}
          submitButtonText="Create Label"
        />,
      );

      fireEvent.change(screen.getByTestId("name"), {
        target: { value: "WB Unit-BB" },
      });

      const field: HTMLInputElement = getField("color-value");

      field.focus();
      expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);

      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

      /*
       * The picker is the only thing that happens: no submit, so no "Label
       * Color is required." for a field being filled in right now.
       */
      await waitFor(() => {
        expect(screen.queryByText("Label Color is required.")).toBeNull();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("Escape closes the picker without taking the modal with it", () => {
      const onClose: MockFunction = getJestMockFunction();

      render(
        <Modal title="Create New Label" onClose={onClose}>
          <ColorPicker
            dataTestId="color-value"
            placeholder="Please select color for this label."
            onChange={getJestMockFunction()}
            tabIndex={0}
          />
        </Modal>,
      );

      const field: HTMLInputElement = getField("color-value");

      field.focus();
      fireEvent.keyDown(field, { key: "ArrowDown" });

      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "Escape",
      });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(document.activeElement).toBe(field);
    });
  });
});
