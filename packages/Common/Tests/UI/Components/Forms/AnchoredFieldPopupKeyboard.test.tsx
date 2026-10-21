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
import {
  getColorField,
  getSwatch,
  getTrigger,
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
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Fields that open a portalled popup - the compact color field (a custom
 * field's options, a workflow value) and the icon field - used to open it on
 * a click and on nothing else. Every key was dead. That left a keyboard user
 * with no way in at all - and on the Create Label form (issue #3143) the
 * color is required, so no way in meant no way to submit the form either.
 *
 * Both fields drive UseAnchoredFieldPopup, so the behaviour is stated once
 * per field here and the shared parts are pinned in both. A form's color
 * field has no popup any more - its swatches are a radio group on the form -
 * and is pinned by its own keys below.
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
      layout="compact"
      dataTestId="color-value"
      placeholder="No color"
      initialValue={new Color("#ef4444")}
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

// The compact color field's button.
const getColorTrigger: () => HTMLElement = (): HTMLElement => {
  return getTrigger(getColorField("color-value"));
};

describe("Opening an anchored field popup from the keyboard", () => {
  afterEach(() => {
    cleanup();
  });

  describe("ColorPicker (compact)", () => {
    test.each(OPENING_KEYS)(
      "%p opens the popup and moves focus to the picked color",
      (key: string) => {
        renderColorPicker();

        const trigger: HTMLElement = getColorTrigger();

        trigger.focus();
        fireEvent.keyDown(trigger, { key });

        const popup: HTMLElement = screen.getByTestId("color-picker-popup");

        expect(popup).toBeInTheDocument();

        /*
         * Landing on the picked swatch is what makes the field usable: the
         * arrows move from there, Enter or Space chooses.
         */
        expect(document.activeElement).toBe(getSwatch(popup, "Red"));
      },
    );

    test("a keyboard user can open it, arrow to a color and choose it, end to end", () => {
      const onChange: MockFunction = renderColorPicker();
      const trigger: HTMLElement = getColorTrigger();

      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      act(() => {
        fireEvent.keyDown(document.activeElement as HTMLElement, {
          key: "ArrowRight",
        });
      });

      // The arrow picks as it moves, and the popover stays for more.
      expect(onChange).toHaveBeenLastCalledWith(new Color("#d97706"));
      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

      // Enter or Space on a radio button is its click: the choice is made.
      act(() => {
        fireEvent.click(getSwatch(popup, "Orange"), { detail: 0 });
      });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(trigger).toHaveTextContent("Orange");
    });

    test("a keyboard user can open Custom color and type a brand code", () => {
      const onChange: MockFunction = renderColorPicker();
      const trigger: HTMLElement = getColorTrigger();

      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      act(() => {
        fireEvent.click(within(popup).getByTestId("color-picker-custom"), {
          detail: 0,
        });
      });

      const codeBox: HTMLElement =
        within(popup).getByTestId("color-picker-code");

      expect(document.activeElement).toBe(codeBox);

      act(() => {
        fireEvent.change(codeBox, { target: { value: "#32a852" } });
      });

      expect(onChange).toHaveBeenLastCalledWith(new Color("#32a852"));

      // Escape puts the user back where they were, with the value kept.
      act(() => {
        fireEvent.keyDown(codeBox, { key: "Escape" });
      });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(trigger).toHaveTextContent("#32a852");
    });

    test("an opening key is claimed, so nothing downstream acts on it too", () => {
      renderColorPicker();

      const trigger: HTMLElement = getColorTrigger();

      /*
       * fireEvent returns false when a cancelable event had preventDefault
       * called on it: nothing around the field acts on the same key.
       */
      expect(fireEvent.keyDown(trigger, { key: "Enter" })).toBe(false);
      expect(fireEvent.keyDown(trigger, { key: " " })).toBe(false);
    });

    test("Enter on an already open field moves focus in rather than closing it", () => {
      renderColorPicker();

      const trigger: HTMLElement = getColorTrigger();

      fireEvent.click(trigger);

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      // A pointer user's popup opens under their cursor and leaves focus alone.
      expect(popup.contains(document.activeElement)).toBe(false);

      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });

      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();
      expect(popup.contains(document.activeElement)).toBe(true);
    });

    test("keys that are not opening keys are left alone", () => {
      renderColorPicker();

      const trigger: HTMLElement = getColorTrigger();

      expect(fireEvent.keyDown(trigger, { key: "Tab" })).toBe(true);
      expect(fireEvent.keyDown(trigger, { key: "a" })).toBe(true);
      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    test("a readOnly field opens for neither pointer nor keyboard", () => {
      renderColorPicker({ readOnly: true });

      const trigger: HTMLElement = getColorTrigger();

      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    test("a disabled field opens for neither pointer nor keyboard", () => {
      renderColorPicker({ disabled: true });

      const trigger: HTMLElement = getColorTrigger();

      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    });

    test("the field advertises the popup it controls", () => {
      renderColorPicker();

      const trigger: HTMLElement = getColorTrigger();

      expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("aria-controls");

      fireEvent.click(trigger);

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger.getAttribute("aria-controls")).toEqual(popup.id);
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
  /*
   * The two surfaces a form's color field ships on: inside a form, where
   * Enter is a submit, and inside a modal, where Escape is a dismissal.
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

    test("the color is reachable by Tab and set with the arrows, and posts nothing", async () => {
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

      const field: HTMLElement = getColorField("color-value");
      const radios: Array<HTMLElement> = within(field).getAllByRole("radio");

      // One Tab stop for the whole group: the first color while none is set.
      expect(
        radios.filter((radio: HTMLElement): boolean => {
          return radio.getAttribute("tabindex") === "0";
        }),
      ).toEqual([radios[0]]);

      radios[0]!.focus();

      act(() => {
        fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
      });

      expect(document.activeElement).toBe(radios[1]);
      expect(radios[1]).toHaveAttribute("aria-checked", "true");

      /*
       * The keys pick and do nothing else: no submit, so no "Label Color is
       * required." for a field being filled in right now.
       */
      await waitFor(() => {
        expect(screen.queryByText("Label Color is required.")).toBeNull();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("Escape in the color field's open Custom color closes it without taking the modal with it", () => {
      const onClose: MockFunction = getJestMockFunction();

      render(
        <Modal title="Create New Label" onClose={onClose}>
          <ColorPicker
            dataTestId="color-value"
            value="#ef4444"
            onChange={getJestMockFunction()}
          />
        </Modal>,
      );

      const field: HTMLElement = getColorField("color-value");
      const custom: HTMLElement = within(field).getByTestId(
        "color-picker-custom",
      );

      custom.focus();

      // Enter on the button: a click with no pointer.
      act(() => {
        fireEvent.click(custom, { detail: 0 });
      });

      const codeBox: HTMLElement =
        within(field).getByTestId("color-picker-code");

      expect(document.activeElement).toBe(codeBox);

      act(() => {
        fireEvent.keyDown(codeBox, { key: "Escape" });
      });

      expect(
        within(field).queryByTestId("color-picker-custom-panel"),
      ).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(document.activeElement).toBe(custom);
    });

    test("Escape in a row's color popover closes it without taking the modal with it", () => {
      const onClose: MockFunction = getJestMockFunction();

      render(
        <Modal title="Create Custom Field" onClose={onClose}>
          <ColorPicker
            layout="compact"
            dataTestId="color-value"
            onChange={getJestMockFunction()}
            tabIndex={0}
          />
        </Modal>,
      );

      const trigger: HTMLElement = getColorTrigger();

      trigger.focus();
      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "Escape",
      });

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
