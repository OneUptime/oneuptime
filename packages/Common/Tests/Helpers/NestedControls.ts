/*
 * Controls drawn inside other controls, read from a rendered DOM. The
 * rendered side of the nested-controls guard (Tests/UI/Components/
 * NestedControlsGuard.test.ts reads the source); component tests call
 * findNestedControls on what they render.
 *
 * Why it matters: a button, a link, an option or a tab is ONE control to a
 * screen reader. Its content is read as its name and nothing inside it is
 * offered as a control of its own (ARIA calls these roles' children
 * presentational), so a Clear button drawn inside a dropdown's value button
 * was simply not there for someone who cannot see it. A button inside a
 * button is also invalid HTML, which React reports as "validateDOMNesting:
 * <button> cannot appear as a descendant of <button>", and a press on the
 * inner one reaches the outer one too unless every handler remembers to
 * stop it.
 *
 * Plain DOM only, no testing-library, so any suite can use it.
 */

/*
 * Roles that make an element one control whose content is its name: what a
 * control must never be drawn inside. Every role ARIA gives presentational
 * children that is also a widget, plus link and menuitem, whose content is
 * their name too.
 */
export const SINGLE_CONTROL_ROLES: ReadonlyArray<string> = [
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "switch",
  "tab",
];

/*
 * Every role a person operates: the single controls above, and the ones that
 * take text.
 */
export const CONTROL_ROLES: ReadonlyArray<string> = [
  ...SINGLE_CONTROL_ROLES,
  "combobox",
  "searchbox",
  "spinbutton",
  "textbox",
];

// Elements that are controls by their tag.
const CONTROL_TAGS: ReadonlyArray<string> = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
];

// Elements that are one control by their tag.
const SINGLE_CONTROL_TAGS: ReadonlyArray<string> = ["a", "button"];

function roleOf(element: Element): string {
  return (element.getAttribute("role") || "").trim().toLowerCase();
}

/*
 * Whether a person can operate the element: a control by its tag (an `a`
 * only with an href, an input unless hidden), by its role, or by a tabindex
 * that puts it in the Tab order.
 */
export function isControl(element: Element): boolean {
  const tag: string = element.tagName.toLowerCase();
  const role: string = roleOf(element);

  if (role === "presentation" || role === "none") {
    return false;
  }

  if (CONTROL_ROLES.includes(role)) {
    return true;
  }

  if (CONTROL_TAGS.includes(tag)) {
    if (tag === "a") {
      return element.hasAttribute("href");
    }

    if (tag === "input") {
      return (element.getAttribute("type") || "").toLowerCase() !== "hidden";
    }

    return true;
  }

  const tabIndex: string | null = element.getAttribute("tabindex");

  return tabIndex !== null && Number(tabIndex) >= 0;
}

// Whether the element is one control, whose content is its name.
export function isSingleControl(element: Element): boolean {
  const tag: string = element.tagName.toLowerCase();
  const role: string = roleOf(element);

  if (role === "presentation" || role === "none") {
    return false;
  }

  if (SINGLE_CONTROL_ROLES.includes(role)) {
    return true;
  }

  if (!SINGLE_CONTROL_TAGS.includes(tag) || role !== "") {
    return false;
  }

  return tag === "button" || element.hasAttribute("href");
}

export interface NestedControl {
  // The control drawn inside another one.
  inner: Element;
  // The nearest single control around it.
  outer: Element;
}

/*
 * Every control under `root` (root included) drawn inside a single control,
 * each paired with the nearest single control around it. Empty when nothing
 * is nested.
 */
export function findNestedControls(root: Element): Array<NestedControl> {
  const found: Array<NestedControl> = [];
  const candidates: Array<Element> = [
    root,
    ...Array.from(root.querySelectorAll("*")),
  ];

  for (const element of candidates) {
    if (!isControl(element)) {
      continue;
    }

    let ancestor: Element | null = element.parentElement;

    while (ancestor) {
      if (isSingleControl(ancestor)) {
        found.push({ inner: element, outer: ancestor });
        break;
      }

      ancestor = ancestor.parentElement;
    }
  }

  return found;
}

// A short, readable name for an element: `button "Clear selection"`.
export function describeControl(element: Element): string {
  const tag: string = element.tagName.toLowerCase();
  const role: string = roleOf(element);
  const name: string = (
    element.getAttribute("aria-label") ||
    element.textContent ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  return `${tag}${role ? `[role=${role}]` : ""} "${name}"`;
}

// The nestings, one readable line each, for an assertion message.
export function describeNestedControls(
  nested: Array<NestedControl>,
): Array<string> {
  return nested.map((pair: NestedControl): string => {
    return `${describeControl(pair.inner)} inside ${describeControl(pair.outer)}`;
  });
}
