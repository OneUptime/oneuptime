/*
 * A control that explains another rather than doing something - a field's
 * help (i) (InfoTooltip), a defined word's definition (DefinedTerm) -
 * carries this attribute, and a dialog never starts its focus there
 * (Modal's pickInitialFocusElement), as it never starts on a link: a form
 * whose first field has a defined word in its title opened with the focus
 * on the word, a Tab short of the field it is for (#7360). Tab still
 * reaches it, in its place.
 */
export const DIALOG_ASIDE_ATTRIBUTE: string = "data-dialog-aside";

export const isDialogAside: (element: Element) => boolean = (
  element: Element,
): boolean => {
  return element.getAttribute(DIALOG_ASIDE_ATTRIBUTE) === "true";
};
