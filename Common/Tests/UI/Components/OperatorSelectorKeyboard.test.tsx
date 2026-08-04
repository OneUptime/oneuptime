import OperatorSelector from "../../../UI/Components/Filters/OperatorSelector";
import FilterOperator, {
  FilterOperatorLabel,
} from "../../../UI/Components/Filters/Types/FilterOperator";
import "@testing-library/jest-dom/extend-expect";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The operator menu is portalled to document.body so the scrollable modal body
 * cannot clip it. That portal takes the options out of Modal's focus trap
 * (Modal collects focusables with modalRef.current.querySelectorAll), so the
 * selector has to be keyboard operable on its own: focus moves into the menu on
 * open, arrows/Home/End walk the options, Enter/Space picks one, and Escape or
 * Tab closes and hands focus back to the trigger without the surrounding modal
 * ever seeing the key.
 */

const OPTIONS: Array<FilterOperator> = [
  FilterOperator.Contains,
  FilterOperator.DoesNotContain,
  FilterOperator.StartsWith,
  FilterOperator.EndsWith,
];

const MENU_TEST_ID: string = "operator-selector-menu";
const AFTER_SELECTOR_TEST_ID: string = "after-selector";

// Keys that made it all the way up to a document-level listener, in order.
const documentKeys: Array<string> = [];

const documentKeyDownListener: (event: KeyboardEvent) => void = (
  event: KeyboardEvent,
): void => {
  documentKeys.push(event.key);
};

interface SelectorHarness {
  trigger: HTMLElement;
  onChange: (value: FilterOperator) => void;
}

interface SelectorWithSiblingHarness extends SelectorHarness {
  afterInput: HTMLElement;
}

type RenderSelectorFunction = (
  value: FilterOperator,
  options: Array<FilterOperator>,
) => SelectorHarness;

const renderSelector: RenderSelectorFunction = (
  value: FilterOperator,
  options: Array<FilterOperator>,
): SelectorHarness => {
  const onChange: (value: FilterOperator) => void = jest.fn();

  render(
    <OperatorSelector value={value} options={options} onChange={onChange} />,
  );

  /*
   * The options carry role="option", so the only element still exposed as a
   * button is the trigger itself.
   */
  return { trigger: screen.getByRole("button"), onChange: onChange };
};

type RenderSelectorWithSiblingFunction = (
  value: FilterOperator,
  options: Array<FilterOperator>,
) => SelectorWithSiblingHarness;

/*
 * Same selector, but with a real tabbable element after it. That sibling is
 * what makes the Tab assertions behavioural: if the menu did not swallow Tab,
 * focus would land on this input instead of on the trigger, and the menu would
 * still be open.
 */
const renderSelectorWithSibling: RenderSelectorWithSiblingFunction = (
  value: FilterOperator,
  options: Array<FilterOperator>,
): SelectorWithSiblingHarness => {
  const onChange: (value: FilterOperator) => void = jest.fn();

  render(
    <div>
      <OperatorSelector value={value} options={options} onChange={onChange} />
      <input data-testid={AFTER_SELECTOR_TEST_ID} />
    </div>,
  );

  return {
    trigger: screen.getByRole("button"),
    onChange: onChange,
    afterInput: screen.getByTestId(AFTER_SELECTOR_TEST_ID),
  };
};

type GetOptionsFunction = () => Array<HTMLElement>;

const getOptions: GetOptionsFunction = (): Array<HTMLElement> => {
  return screen.getAllByRole("option");
};

type QueryMenuFunction = () => HTMLElement | null;

const queryMenu: QueryMenuFunction = (): HTMLElement | null => {
  return screen.queryByTestId(MENU_TEST_ID);
};

type OpenMenuOnFirstOptionFunction = (
  user: UserEvent,
  trigger: HTMLElement,
  expectedOptionCount: number,
) => Promise<Array<HTMLElement>>;

/*
 * Opens the menu with ArrowDown, which makes option 0 the active one, and
 * parks DOM focus there.
 *
 * TODO(operator-selector-focus-on-open): the explicit focus() call below should
 * be redundant — ArrowDown is supposed to move focus onto the first option all
 * by itself, and the six "focus on open" tests in this file assert exactly that
 * and currently FAIL (the component sets activeIndex before menuPosition
 * exists, so the roving-focus effect runs while the portal is still unmounted
 * and never re-runs). The override is here so the rest of the keyboard contract
 * (roving arrows, Home/End, Enter/Space, Escape, Tab) is exercised from the
 * state the component intends, instead of every one of those tests failing for
 * that same single reason. Delete this call together with the fix — once open
 * really does move focus, it is a no-op.
 */
const openMenuOnFirstOption: OpenMenuOnFirstOptionFunction = async (
  user: UserEvent,
  trigger: HTMLElement,
  expectedOptionCount: number,
): Promise<Array<HTMLElement>> => {
  trigger.focus();
  await user.keyboard("{ArrowDown}");

  const options: Array<HTMLElement> = getOptions();

  // Guard the override: the menu really did open with the options we expect.
  expect(options).toHaveLength(expectedOptionCount);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  options[0]?.focus();

  return options;
};

describe("OperatorSelector keyboard contract", () => {
  beforeEach(() => {
    documentKeys.length = 0;
    document.addEventListener("keydown", documentKeyDownListener);
  });

  afterEach(() => {
    document.removeEventListener("keydown", documentKeyDownListener);
    cleanup();
  });

  test("ArrowDown on the closed trigger opens the menu and focuses the first option", async () => {
    const user: UserEvent = userEvent.setup();
    // The current value is the third option, so "first" cannot be a coincidence.
    const harness: SelectorHarness = renderSelector(
      FilterOperator.StartsWith,
      OPTIONS,
    );

    harness.trigger.focus();
    expect(queryMenu()).toBeNull();

    await user.keyboard("{ArrowDown}");

    const options: Array<HTMLElement> = getOptions();

    expect(queryMenu()).not.toBeNull();
    expect(options).toHaveLength(OPTIONS.length);
    expect(document.activeElement).toBe(options[0]);
  });

  test("ArrowUp on the closed trigger opens the menu and focuses the last option", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    harness.trigger.focus();

    await user.keyboard("{ArrowUp}");

    const options: Array<HTMLElement> = getOptions();

    expect(queryMenu()).not.toBeNull();
    expect(document.activeElement).toBe(options[options.length - 1]);
  });

  test("opening by click focuses the option matching the current value", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.StartsWith,
      OPTIONS,
    );

    await user.click(harness.trigger);

    const options: Array<HTMLElement> = getOptions();

    expect(document.activeElement).toBe(options[2]);
    expect(document.activeElement?.textContent).toBe(
      FilterOperatorLabel[FilterOperator.StartsWith],
    );
  });

  test("opening by click falls back to the first option when the value is not in the options", async () => {
    const user: UserEvent = userEvent.setup();
    // "is" is a perfectly valid operator, just not one of the text operators.
    const harness: SelectorHarness = renderSelector(FilterOperator.Is, OPTIONS);

    await user.click(harness.trigger);

    const options: Array<HTMLElement> = getOptions();

    expect(document.activeElement).toBe(options[0]);
  });

  test("Enter on the closed trigger opens the menu and focuses the option matching the value", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * A keyboard user Tabs onto the trigger and presses Enter. There is no
     * explicit Enter handling — native button activation runs onClick, which is
     * the same openMenu() path as a mouse click.
     */
    const harness: SelectorHarness = renderSelector(
      FilterOperator.StartsWith,
      OPTIONS,
    );

    harness.trigger.focus();

    await user.keyboard("{Enter}");

    const options: Array<HTMLElement> = getOptions();

    expect(queryMenu()).not.toBeNull();
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(options[2]);
  });

  test("Space on the closed trigger opens the menu and focuses the option matching the value", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.EndsWith,
      OPTIONS,
    );

    harness.trigger.focus();

    await user.keyboard("[Space]");

    const options: Array<HTMLElement> = getOptions();

    expect(queryMenu()).not.toBeNull();
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(options[options.length - 1]);
  });

  test("reopening the menu after a close focuses the selected option again", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * closeMenu() resets activeIndex to -1, so the second open is a different
     * state transition (-1 -> selectedIndex) from the first (-1 -> selectedIndex
     * on a component that has never rendered a menu). A fix that only makes the
     * very first open work would slip through without this.
     */
    const harness: SelectorHarness = renderSelector(
      FilterOperator.StartsWith,
      OPTIONS,
    );

    await user.click(harness.trigger);
    expect(queryMenu()).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(queryMenu()).toBeNull();

    await user.click(harness.trigger);

    const options: Array<HTMLElement> = getOptions();

    expect(queryMenu()).not.toBeNull();
    expect(document.activeElement).toBe(options[2]);
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("ArrowDown and ArrowUp move focus one option at a time and wrap at both ends", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[1]);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[2]);

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(options[1]);

    // Walk off the top: 1 -> 0 -> wraps round to the last option.
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(options[options.length - 1]);

    // And off the bottom again, back to the first.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[0]);

    // Walking the list must not commit anything on its own.
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(queryMenu()).not.toBeNull();
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("true");

    /*
     * This is real roving DOM focus, not the aria-activedescendant pattern. A
     * "fix" that swapped to activedescendant would stop moving focus and would
     * re-break the portal-versus-focus-trap problem this component exists to
     * solve, so pin the absence of the attribute too.
     */
    const menu: HTMLElement = screen.getByTestId(MENU_TEST_ID);

    expect(menu.getAttribute("aria-activedescendant")).toBeNull();
  });

  test("the arrow keys are prevented so the scrollable modal body underneath does not scroll", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    /*
     * The menu is overflow-auto and sits above a modal body that is
     * overflow-y-auto; an un-prevented arrow scrolls one of them out from under
     * the user. fireEvent returns false when a handler called preventDefault().
     */
    const arrowDownDefaultAllowed: boolean = fireEvent.keyDown(
      options[0] as HTMLElement,
      { key: "ArrowDown" },
    );

    expect(arrowDownDefaultAllowed).toBe(false);
    expect(document.activeElement).toBe(options[1]);

    const arrowUpDefaultAllowed: boolean = fireEvent.keyDown(
      options[1] as HTMLElement,
      { key: "ArrowUp" },
    );

    expect(arrowUpDefaultAllowed).toBe(false);
    expect(document.activeElement).toBe(options[0]);

    expect(queryMenu()).not.toBeNull();
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("Home and End jump to the first and last option and are prevented", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(options[options.length - 1]);

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(options[0]);

    // End from anywhere, not just from the top.
    await user.keyboard("{ArrowDown}{End}");
    expect(document.activeElement).toBe(options[options.length - 1]);

    // Home/End scroll their container by default; the menu has to swallow both.
    const homeDefaultAllowed: boolean = fireEvent.keyDown(
      options[options.length - 1] as HTMLElement,
      { key: "Home" },
    );

    expect(homeDefaultAllowed).toBe(false);
    expect(document.activeElement).toBe(options[0]);

    const endDefaultAllowed: boolean = fireEvent.keyDown(
      options[0] as HTMLElement,
      { key: "End" },
    );

    expect(endDefaultAllowed).toBe(false);
    expect(document.activeElement).toBe(options[options.length - 1]);
  });

  test("arrows still work when focus sits on the menu container instead of an option", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * Clicking the menu's own padding leaves DOM focus on the listbox div (it
     * is tabIndex={-1} and owns the keydown handler). Arrows must still pull
     * focus back onto a real option from there.
     */
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    await user.click(harness.trigger);

    const menu: HTMLElement = screen.getByTestId(MENU_TEST_ID);
    const options: Array<HTMLElement> = getOptions();

    menu.focus();
    expect(document.activeElement).toBe(menu);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[1]);

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(options[0]);

    expect(queryMenu()).not.toBeNull();
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("Enter on the focused option selects it, closes the menu and restores focus", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options[1]);

    await user.keyboard("{Enter}");

    expect(harness.onChange).toHaveBeenCalledTimes(1);
    expect(harness.onChange).toHaveBeenCalledWith(OPTIONS[1]);
    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(harness.trigger.getAttribute("aria-controls")).toBeNull();

    /*
     * The component is controlled: props.value has not changed, so the trigger
     * must still read "contains". Optimistically painting the picked operator
     * would desync the button from the filter the parent actually holds.
     */
    expect(harness.trigger.textContent).toBe(
      FilterOperatorLabel[FilterOperator.Contains],
    );
    expect(harness.trigger.textContent).not.toBe(
      FilterOperatorLabel[FilterOperator.DoesNotContain],
    );
  });

  test("Space on the focused option selects it, closes the menu and restores focus", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(options[options.length - 1]);

    await user.keyboard("[Space]");

    expect(harness.onChange).toHaveBeenCalledTimes(1);
    expect(harness.onChange).toHaveBeenCalledWith(OPTIONS[OPTIONS.length - 1]);
    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(harness.trigger.getAttribute("aria-controls")).toBeNull();
    expect(harness.trigger.textContent).toBe(
      FilterOperatorLabel[FilterOperator.Contains],
    );
  });

  test("Escape inside the menu closes it, restores focus and is swallowed before the modal sees it", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * Escape is handled by the component's document-level CAPTURE listener,
     * which stops propagation there — so it is that safety net, not the menu's
     * own onKeyDown, that runs for this scenario. What matters either way is
     * that the surrounding modal's document Escape handler never sees the key,
     * otherwise dismissing the operator menu would dismiss the filter modal.
     */
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    await openMenuOnFirstOption(user, harness.trigger, OPTIONS.length);

    /*
     * Positive guard on the exact propagation path the negative assertion is
     * about: a key pressed on an option inside the PORTAL (a document.body
     * subtree, outside the RTL container) does reach a document listener when
     * the component does not stop it.
     */
    documentKeys.length = 0;
    await user.keyboard("{ArrowDown}");
    expect(documentKeys).toEqual(["ArrowDown"]);

    documentKeys.length = 0;
    await user.keyboard("{Escape}");

    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(documentKeys).toEqual([]);
  });

  test("Tab closes the menu and hands focus back to the trigger instead of moving on", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorWithSiblingHarness = renderSelectorWithSibling(
      FilterOperator.Contains,
      OPTIONS,
    );

    await openMenuOnFirstOption(user, harness.trigger, OPTIONS.length);

    documentKeys.length = 0;

    await user.tab();

    /*
     * user-event only performs the native tab move when the keydown was not
     * prevented, so landing on the trigger rather than on the sibling input is
     * the observable proof that the menu swallowed the key.
     */
    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(document.activeElement).not.toBe(harness.afterInput);
    expect(harness.onChange).not.toHaveBeenCalled();
    // The modal re-traps Tab from a document listener; it must not see this one.
    expect(documentKeys).toEqual([]);
  });

  test("Shift+Tab closes the menu and hands focus back to the trigger too", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * handleMenuKeyDown branches on event.key === "Tab", which is identical for
     * a backwards tab, so a user reversing out of the menu must not escape the
     * portal backwards either.
     */
    const harness: SelectorWithSiblingHarness = renderSelectorWithSibling(
      FilterOperator.Contains,
      OPTIONS,
    );

    await openMenuOnFirstOption(user, harness.trigger, OPTIONS.length);

    documentKeys.length = 0;

    await user.tab({ shift: true });

    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(document.activeElement).not.toBe(harness.afterInput);
    expect(harness.onChange).not.toHaveBeenCalled();
    /*
     * The bare Shift keydown is unbound, so it legitimately travels to the
     * document — which doubles as the positive guard that the negative below is
     * about a real propagation path. The Tab itself must not follow it.
     */
    expect(documentKeys).toEqual(["Shift"]);
    expect(documentKeys).not.toContain("Tab");
  });

  test("Tab pressed inside the menu has its default prevented", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    // fireEvent returns false when a handler called preventDefault().
    const defaultAllowed: boolean = fireEvent.keyDown(
      options[0] as HTMLElement,
      { key: "Tab" },
    );

    expect(defaultAllowed).toBe(false);
    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
  });

  test("the trigger advertises the listbox and flips aria-expanded / aria-controls", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.StartsWith,
      OPTIONS,
    );

    expect(harness.trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(harness.trigger.getAttribute("aria-controls")).toBeNull();

    await user.click(harness.trigger);

    const menu: HTMLElement = screen.getByTestId(MENU_TEST_ID);

    expect(menu.id).toBeTruthy();
    expect(harness.trigger.id).toBeTruthy();
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("true");
    expect(harness.trigger.getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.getAttribute("role")).toBe("listbox");
    expect(menu.getAttribute("aria-labelledby")).toBe(harness.trigger.id);

    await user.keyboard("{Escape}");

    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(harness.trigger.getAttribute("aria-controls")).toBeNull();
  });

  test("exactly one option is aria-selected and it is the current value", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.EndsWith,
      OPTIONS,
    );

    await user.click(harness.trigger);

    const options: Array<HTMLElement> = getOptions();
    const selected: Array<HTMLElement> = options.filter(
      (option: HTMLElement): boolean => {
        return option.getAttribute("aria-selected") === "true";
      },
    );

    expect(options).toHaveLength(OPTIONS.length);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe(
      FilterOperatorLabel[FilterOperator.EndsWith],
    );
  });

  test("the options are unreachable from the ambient tab order", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * The portal is appended at the end of document.body, so without
     * tabIndex={-1} plus the menu's Tab handling a user tabbing forward from
     * the trigger would fall into the options — or, worse, tab straight past a
     * still-open menu into the rest of the form.
     */
    const harness: SelectorWithSiblingHarness = renderSelectorWithSibling(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    await user.tab();

    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(options).not.toContain(document.activeElement);

    await user.tab();

    // One tab past the selector lands on the next real control, nothing between.
    expect(document.activeElement).toBe(harness.afterInput);
    expect(options).not.toContain(document.activeElement);
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("a single-option list survives the wraparound arithmetic", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * The modulo maths degenerates at optionCount === 1: (0 + 1) % 1 === 0 and
     * (0 - 1 + 1) % 1 === 0. Nothing may go negative, crash, or close the menu.
     */
    const harness: SelectorHarness = renderSelector(FilterOperator.Contains, [
      FilterOperator.Contains,
    ]);

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      1,
    );

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Home}{End}");

    expect(queryMenu()).not.toBeNull();
    expect(getOptions()).toHaveLength(1);
    expect(document.activeElement).toBe(options[0]);
    expect(harness.onChange).not.toHaveBeenCalled();

    // And the only option is still selectable after all that walking.
    await user.keyboard("{Enter}");

    expect(harness.onChange).toHaveBeenCalledTimes(1);
    expect(harness.onChange).toHaveBeenCalledWith(FilterOperator.Contains);
    expect(queryMenu()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
  });

  test("an unbound key inside the menu is left alone and still reaches the document", async () => {
    const user: UserEvent = userEvent.setup();
    /*
     * The menu sits above the modal in a portal; it must only consume the keys
     * it actually implements. A handler that swallowed everything would break
     * typing in the filter's value input and any global shortcut.
     */
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    const options: Array<HTMLElement> = await openMenuOnFirstOption(
      user,
      harness.trigger,
      OPTIONS.length,
    );

    documentKeys.length = 0;

    const defaultAllowed: boolean = fireEvent.keyDown(
      options[0] as HTMLElement,
      { key: "a" },
    );

    expect(defaultAllowed).toBe(true);
    expect(documentKeys).toEqual(["a"]);
    expect(queryMenu()).not.toBeNull();
    expect(document.activeElement).toBe(options[0]);
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("an empty options list cannot be opened by any means and does not crash", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      [],
    );

    harness.trigger.focus();

    await user.keyboard("{ArrowDown}");
    expect(queryMenu()).toBeNull();

    await user.keyboard("{ArrowUp}");
    expect(queryMenu()).toBeNull();

    // Both native button activations route through onClick -> openMenu().
    await user.keyboard("{Enter}");
    expect(queryMenu()).toBeNull();

    await user.keyboard("[Space]");
    expect(queryMenu()).toBeNull();

    await user.click(harness.trigger);
    expect(queryMenu()).toBeNull();

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(harness.trigger.getAttribute("aria-controls")).toBeNull();
    expect(harness.onChange).not.toHaveBeenCalled();
    // The trigger itself still renders and still says what the value is.
    expect(harness.trigger.textContent).toBe(
      FilterOperatorLabel[FilterOperator.Contains],
    );
  });

  test("keys pressed on the closed trigger neither open the menu nor swallow Escape", async () => {
    const user: UserEvent = userEvent.setup();
    const harness: SelectorHarness = renderSelector(
      FilterOperator.Contains,
      OPTIONS,
    );

    harness.trigger.focus();
    documentKeys.length = 0;

    await user.keyboard("{Escape}{Home}{End}");

    expect(queryMenu()).toBeNull();
    expect(harness.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(harness.onChange).not.toHaveBeenCalled();
    /*
     * While the menu is closed the surrounding modal owns Escape, so the key
     * must still travel to the document.
     */
    expect(documentKeys).toEqual(["Escape", "Home", "End"]);
  });
});
