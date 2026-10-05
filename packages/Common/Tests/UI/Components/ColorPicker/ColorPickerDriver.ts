import { act, fireEvent, screen, within } from "@testing-library/react";

/*
 * Drives the color field (Common/UI/Components/Forms/Fields/ColorPicker) the
 * way a person does - a swatch clicked, Custom color opened and a code typed
 * - for every suite that renders it, so a change to how the field is drawn
 * is made here once rather than in every test that picks a color.
 *
 * A field is found by its data-testid (the field's dataTestId, "color-picker"
 * when it has none); its color is its data-value: lowercase #rrggbb, "" for
 * none.
 */

export type ColorFieldScope = HTMLElement | undefined;

// The one color field in scope (the document when no scope is given).
export const getColorField: (
  testId?: string,
  scope?: ColorFieldScope,
) => HTMLElement = (
  testId: string = "color-picker",
  scope?: ColorFieldScope,
): HTMLElement => {
  return scope ? within(scope).getByTestId(testId) : screen.getByTestId(testId);
};

// What the field holds: lowercase #rrggbb, or "" for no color.
export const colorOf: (field: HTMLElement) => string = (
  field: HTMLElement,
): string => {
  return field.getAttribute("data-value") || "";
};

// The radio of a swatch by its name ("Teal"), or the clear choice's words.
export const getSwatch: (field: HTMLElement, name: string) => HTMLElement = (
  field: HTMLElement,
  name: string,
): HTMLElement => {
  return within(field).getByRole("radio", { name });
};

// The checked radio, if any: a swatch, or "No color".
export const getCheckedSwatch: (field: HTMLElement) => HTMLElement | null = (
  field: HTMLElement,
): HTMLElement | null => {
  return (
    within(field)
      .queryAllByRole("radio")
      .find((radio: HTMLElement): boolean => {
        return radio.getAttribute("aria-checked") === "true";
      }) || null
  );
};

export const pickSwatch: (field: HTMLElement, name: string) => void = (
  field: HTMLElement,
  name: string,
): void => {
  act(() => {
    fireEvent.click(getSwatch(field, name));
  });
};

// The Custom color button of an inline field.
export const getCustomButton: (field: HTMLElement) => HTMLElement = (
  field: HTMLElement,
): HTMLElement => {
  return within(field).getByTestId("color-picker-custom");
};

// The open Custom color panel of an inline field, opening it first.
export const openCustomPanel: (field: HTMLElement) => HTMLElement = (
  field: HTMLElement,
): HTMLElement => {
  const existing: HTMLElement | null = within(field).queryByTestId(
    "color-picker-custom-panel",
  );

  if (existing) {
    return existing;
  }

  act(() => {
    fireEvent.click(getCustomButton(field), { detail: 1 });
  });

  return within(field).getByTestId("color-picker-custom-panel");
};

// The code box of an open Custom color panel.
export const getCodeBox: (panel: HTMLElement) => HTMLInputElement = (
  panel: HTMLElement,
): HTMLInputElement => {
  return within(panel).getByTestId("color-picker-code") as HTMLInputElement;
};

/*
 * Types a code into the Custom color panel and presses Enter, as a person
 * with a brand color does. Works on an inline field (opening its panel) and
 * on an open compact popover (passed as the scope).
 */
export const typeColorCode: (panelScope: HTMLElement, code: string) => void = (
  panelScope: HTMLElement,
  code: string,
): void => {
  const panel: HTMLElement =
    panelScope.getAttribute("data-testid") === "color-picker-custom-panel"
      ? panelScope
      : within(panelScope).queryByTestId("color-picker-custom-panel") ||
        openCustomPanel(panelScope);
  const codeBox: HTMLInputElement = getCodeBox(panel);

  act(() => {
    fireEvent.focus(codeBox);
    fireEvent.change(codeBox, { target: { value: code } });
    fireEvent.keyDown(codeBox, { key: "Enter" });
  });
};

// A compact field's trigger.
export const getTrigger: (field: HTMLElement) => HTMLElement = (
  field: HTMLElement,
): HTMLElement => {
  return within(field).getByTestId("color-picker-trigger");
};

// Opens a compact field's popover with a click and returns it.
export const openPopover: (field: HTMLElement) => HTMLElement = (
  field: HTMLElement,
): HTMLElement => {
  act(() => {
    fireEvent.click(getTrigger(field));
  });

  return screen.getByTestId("color-picker-popup");
};
