import useComponentOutsideClick, {
  isInsideComponent,
} from "../../../UI/Types/UseComponentOutsideClick";
import Dropdown, {
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import { openDropdown } from "../../DropdownPicks";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * The hook behind almost every popover in the product — NavBar, SideMenu,
 * MoreMenu, ProjectPicker, NotificationBell, the column selector, both
 * saved-views dropdowns — and until now it had no tests of its own. It got
 * them when a change to it shipped a regression that all 4,604 tests in
 * Common/Tests/UI were blind to: a right-click inside an open panel left the
 * "this gesture started inside" flag armed, and the next click that arrived
 * without a mousedown of its own — a keyboard user pressing Enter on a control
 * elsewhere, or code calling element.click() — was swallowed, leaving the
 * panel open over the page.
 *
 * So the cases here are written as a pair of opposing pressures: the drag-out
 * gesture the suppression exists to protect, and every route by which a
 * dismissal must still get through.
 */

const PANEL_TEXT: string = "panel contents";

const Harness: FunctionComponent = (): ReactElement => {
  const { ref, isComponentVisible } = useComponentOutsideClick(true);

  return (
    <div>
      <div ref={ref}>
        {isComponentVisible ? (
          <div>
            <p>{PANEL_TEXT}</p>
            <input aria-label="inside box" />
          </div>
        ) : null}
      </div>
      {/*
       * A real control the user could tab to and activate. It deliberately
       * does nothing of its own, so a test that finds the panel closed after
       * activating it is reading the hook and not this button.
       */}
      <button type="button">outside control</button>
    </div>
  );
};

function isOpen(): boolean {
  return screen.queryByText(PANEL_TEXT) !== null;
}

function insideBox(): HTMLElement {
  return screen.getByLabelText("inside box");
}

function outsideControl(): HTMLElement {
  return screen.getByRole("button", { name: "outside control" });
}

/*
 * A real pointer click always carries detail >= 1; jsdom defaults it to 0,
 * which is the value a keyboard activation or element.click() produces. The
 * distinction is load-bearing here, so it is never left to the default.
 */
function pointerClick(target: HTMLElement | Document): void {
  fireEvent.click(target as HTMLElement, { detail: 1 });
}

describe("useComponentOutsideClick — dismissing on an outside click", () => {
  afterEach(() => {
    cleanup();
  });

  test("a plain click outside closes the component", () => {
    render(<Harness />);

    fireEvent.mouseDown(document.body);
    pointerClick(document.body);

    expect(isOpen()).toBe(false);
  });

  test("a click inside leaves it open", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox());
    pointerClick(insideBox());

    expect(isOpen()).toBe(true);
  });
});

describe("useComponentOutsideClick — a drag that leaves the component", () => {
  afterEach(() => {
    cleanup();
  });

  test("selecting text inside and releasing outside does not dismiss", () => {
    render(<Harness />);

    /*
     * The browser fires the click on the common ancestor of press and
     * release, which is outside. Dismissing on that discards whatever the
     * user was selecting — a half-typed search, most often.
     */
    fireEvent.mouseDown(insideBox());
    pointerClick(document.body);

    expect(isOpen()).toBe(true);
  });

  test("the reprieve lasts exactly one click", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox());
    pointerClick(document.body);
    expect(isOpen()).toBe(true);

    // The next outside click is nobody's drag, and must land.
    pointerClick(document.body);

    expect(isOpen()).toBe(false);
  });
});

describe("useComponentOutsideClick — presses that never become a click", () => {
  afterEach(() => {
    cleanup();
  });

  test("a right-click inside does not arm the suppression", () => {
    render(<Harness />);

    /*
     * Right and middle presses fire mousedown and then go to contextmenu or
     * auxclick — no click ever arrives to spend the flag. Deliberately NO
     * outside mousedown before the activation below: one of those would reset
     * the flag by itself and the case would pass either way.
     */
    fireEvent.mouseDown(insideBox(), { button: 2 });
    fireEvent.contextMenu(insideBox());

    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });

  test("a middle-click inside does not arm the suppression", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox(), { button: 1 });

    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });

  test("an outside press of its own also clears a stale flag", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox(), { button: 2 });
    fireEvent.contextMenu(insideBox());

    /*
     * The second line of defence, and the reason the two cases above avoid it:
     * a fresh press anywhere re-answers "did this gesture start inside", so an
     * ordinary click that follows one is never suppressed.
     */
    fireEvent.mouseDown(document.body);
    pointerClick(document.body);

    expect(isOpen()).toBe(false);
  });

  test("a keyboard-activated control outside still dismisses", () => {
    render(<Harness />);

    // An ordinary primary press inside, whose release never became a click.
    fireEvent.mouseDown(insideBox());

    /*
     * Enter on a focused control dispatches a click with no mousedown and a
     * detail of 0. No press can be responsible for it, so no press may
     * suppress it — this is the case the regression landed on.
     */
    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });

  test("a programmatic element.click() outside still dismisses", () => {
    render(<Harness />);

    fireEvent.mouseDown(insideBox());

    // What LogExport does with a temporary anchor to start a download.
    const anchor: HTMLAnchorElement = document.createElement("a");
    document.body.appendChild(anchor);

    // Not a fireEvent, so React needs to be told to flush what it triggers.
    act(() => {
      anchor.click();
    });

    expect(isOpen()).toBe(false);

    anchor.remove();
  });

  test("a press inside whose release never lands leaves nothing armed", () => {
    render(<Harness />);

    // Dragged into a native drag, or the target unmounted mid-gesture.
    fireEvent.mouseDown(insideBox());

    fireEvent.click(outsideControl(), { detail: 0 });

    expect(isOpen()).toBe(false);
  });
});

/*
 * A popover that holds the shared Dropdown - a filter chip's operator (#9294).
 * The Dropdown draws its open menu at the end of the document, outside the
 * popover, so a pick there used to read as a click outside and close the
 * popover with the pick half made.
 */
const PopoverWithDropdown: FunctionComponent<{
  onPick: (value: DropdownValue | Array<DropdownValue> | null) => void;
}> = (props: {
  onPick: (value: DropdownValue | Array<DropdownValue> | null) => void;
}): ReactElement => {
  const { ref, isComponentVisible } = useComponentOutsideClick(true);

  return (
    <div>
      <div ref={ref}>
        {isComponentVisible ? (
          <div>
            <p>{PANEL_TEXT}</p>
            <Dropdown
              ariaLabel="Status operator"
              options={[
                { value: "is", label: "is" },
                { value: "is_not", label: "is not" },
              ]}
              isClearable={false}
              onChange={props.onPick}
            />
          </div>
        ) : null}
      </div>
      <button type="button">outside control</button>
    </div>
  );
};

describe("useComponentOutsideClick — a Dropdown inside the component", () => {
  afterEach(() => {
    cleanup();
  });

  test("a pick in the Dropdown's menu, drawn over the page, leaves it open", () => {
    const picks: Array<DropdownValue | Array<DropdownValue> | null> = [];

    render(
      <PopoverWithDropdown
        onPick={(value: DropdownValue | Array<DropdownValue> | null) => {
          picks.push(value);
        }}
      />,
    );

    openDropdown(screen.getByRole("combobox", { name: "Status operator" }));

    const option: HTMLElement = screen.getByRole("option", { name: "is not" });

    // The menu is not inside the component: it is drawn at the document's end.
    expect(screen.getByText(PANEL_TEXT).parentElement!.contains(option)).toBe(
      false,
    );

    fireEvent.mouseDown(option, { button: 0 });
    pointerClick(option);

    expect(picks).toEqual(["is_not"]);
    expect(isOpen()).toBe(true);
  });

  test("a click outside still closes it after a pick", () => {
    render(<PopoverWithDropdown onPick={() => {}} />);

    openDropdown(screen.getByRole("combobox", { name: "Status operator" }));
    pointerClick(screen.getByRole("option", { name: "is" }));
    expect(isOpen()).toBe(true);

    fireEvent.mouseDown(outsideControl(), { button: 0 });
    pointerClick(outsideControl());

    expect(isOpen()).toBe(false);
  });

  test("isInsideComponent reads a tooltip as part of the component its trigger is in", () => {
    const component: HTMLDivElement = document.createElement("div");
    const trigger: HTMLButtonElement = document.createElement("button");
    component.appendChild(trigger);
    const elsewhere: HTMLButtonElement = document.createElement("button");

    // A tooltip as Tippy draws it on the body: its instance on its root.
    const tooltipOf: (reference: Element | undefined) => HTMLElement = (
      reference: Element | undefined,
    ): HTMLElement => {
      const root: HTMLDivElement = document.createElement("div");
      root.setAttribute("data-tippy-root", "");
      (root as HTMLDivElement & { _tippy?: unknown })._tippy = { reference };
      const link: HTMLAnchorElement = document.createElement("a");
      link.href = "/incidents/1";
      link.append("Database down");
      root.appendChild(link);
      return root;
    };

    const triggersTooltip: HTMLElement = tooltipOf(trigger);
    const elsewhereTooltip: HTMLElement = tooltipOf(elsewhere);
    const ownerlessTooltip: HTMLElement = tooltipOf(undefined);

    document.body.append(
      component,
      elsewhere,
      triggersTooltip,
      elsewhereTooltip,
      ownerlessTooltip,
    );

    // The words of the link in a tooltip, as a press on them targets.
    const wordsIn: (root: HTMLElement) => Node = (root: HTMLElement): Node => {
      return root.querySelector("a")!.firstChild!;
    };

    expect(isInsideComponent(component, wordsIn(triggersTooltip))).toBe(true);
    expect(isInsideComponent(component, triggersTooltip)).toBe(true);
    expect(isInsideComponent(component, wordsIn(elsewhereTooltip))).toBe(false);
    expect(isInsideComponent(component, wordsIn(ownerlessTooltip))).toBe(false);

    component.remove();
    elsewhere.remove();
    triggersTooltip.remove();
    elsewhereTooltip.remove();
    ownerlessTooltip.remove();
  });

  test("isInsideComponent reads the component, the Dropdown's menu, and nothing else", () => {
    const component: HTMLDivElement = document.createElement("div");
    const inside: HTMLSpanElement = document.createElement("span");
    component.appendChild(inside);

    const portal: HTMLDivElement = document.createElement("div");
    portal.className = "ou-select__menu-portal";
    const menuText: Text = document.createTextNode("is not");
    portal.appendChild(menuText);

    const elsewhere: HTMLDivElement = document.createElement("div");

    document.body.append(component, portal, elsewhere);

    expect(isInsideComponent(component, inside)).toBe(true);
    // A text node in the menu counts, as a click on an option's words does.
    expect(isInsideComponent(component, menuText)).toBe(true);
    expect(isInsideComponent(component, elsewhere)).toBe(false);
    expect(isInsideComponent(null, inside)).toBe(false);
    expect(isInsideComponent(component, null)).toBe(false);

    component.remove();
    portal.remove();
    elsewhere.remove();
  });
});

/*
 * Every tooltip is drawn on the page's body (TooltipLayer, #9769), so a
 * rich one whose trigger is in a menu is no longer inside the menu in the
 * page. A press on what it holds is still a press inside the menu.
 */
const TOOLTIP_PANEL_TEXT: string = "uptime panel";

const MenuWithRichTooltip: FunctionComponent = (): ReactElement => {
  const { ref, isComponentVisible } = useComponentOutsideClick(true);

  return (
    <div>
      <div ref={ref} data-testid="menu">
        {isComponentVisible ? (
          <div>
            <p>{TOOLTIP_PANEL_TEXT}</p>
            <Tooltip
              richContent={
                <div>
                  <button type="button">Database down</button>
                </div>
              }
            >
              <button type="button">Tuesday</button>
            </Tooltip>
          </div>
        ) : null}
      </div>
      <button type="button">outside control</button>
    </div>
  );
};

describe("useComponentOutsideClick — a tooltip drawn on the page's body", () => {
  afterEach(() => {
    cleanup();
  });

  const isMenuOpen: () => boolean = (): boolean => {
    return screen.queryByText(TOOLTIP_PANEL_TEXT) !== null;
  };

  test("a press in a tooltip whose trigger is in the menu leaves the menu open", async () => {
    render(<MenuWithRichTooltip />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Tuesday" }));
    await act(async () => {
      // A rich tooltip waits 120ms to show.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 250);
      });
    });

    const incident: HTMLElement = screen.getByRole("button", {
      name: "Database down",
    });

    // Drawn on the body, outside the menu.
    expect(screen.getByTestId("menu")).not.toContainElement(incident);

    fireEvent.mouseDown(incident, { button: 0 });
    pointerClick(incident);

    expect(isMenuOpen()).toBe(true);

    // A press anywhere else still closes it.
    fireEvent.mouseDown(outsideControl(), { button: 0 });
    pointerClick(outsideControl());

    expect(isMenuOpen()).toBe(false);
  });
});
