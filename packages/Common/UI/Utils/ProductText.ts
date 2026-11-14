/*
 * THE PRODUCT'S OWN WORDS, MARKED FOR A RECORDING (issue #6834).
 *
 * On OneUptime Cloud, a person who accepted analytics may have their use of
 * the Dashboard's first-run pages recorded, so the team can see where
 * people get stuck. Those recordings mask every word on the page - the
 * Dashboard shows customers' monitors, incidents, logs, names and keys -
 * except the words that are OneUptime's own interface: a button's label,
 * a heading, a menu entry, a form field's label, a guided setup's step.
 *
 * A component marks those words with this class, on the element that holds
 * them. The browser recorder (packages/App/FeatureSet/BrowserRecorder,
 * Masking.UNMASK_CLASS_NAME, the same string) records text inside it as
 * written; everything else stays masked. Rules for a component:
 *
 *   - mark only text the product wrote: a translated label, never a value
 *     read from a record - a monitor's name, a person's email, a project's
 *     name;
 *   - when a marked element also shows a value, put PRIVATE_TEXT_CLASS_NAME
 *     on the value's element: the closer one wins, so the value stays
 *     masked inside a revealed heading;
 *   - a form control's value and text is never revealed, marked or not.
 *
 * Nothing changes for anybody who is not recorded: it is a class name with
 * no style, and a self-hosted server never loads the recorder at all.
 */

export const PRODUCT_TEXT_CLASS_NAME: string = "oneuptime-unmask";

// The recorder's own mask class: wins over PRODUCT_TEXT_CLASS_NAME further out.
export const PRIVATE_TEXT_CLASS_NAME: string = "oneuptime-mask";

// A class list with the product-text class added, for an element's className.
export const withProductText: (className?: string | undefined) => string = (
  className?: string | undefined,
): string => {
  return className
    ? `${className} ${PRODUCT_TEXT_CLASS_NAME}`
    : PRODUCT_TEXT_CLASS_NAME;
};
