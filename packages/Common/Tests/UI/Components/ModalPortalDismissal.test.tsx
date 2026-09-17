import AutocompleteTextInput from "../../../UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";
import OperatorSelector from "../../../UI/Components/Filters/OperatorSelector";
import FilterOperator from "../../../UI/Components/Filters/Types/FilterOperator";
import ColorPicker from "../../../UI/Components/Forms/Fields/ColorPicker";
import IconPicker from "../../../UI/Components/Forms/Fields/IconPicker";
import Modal from "../../../UI/Components/Modal/Modal";
import IconProp from "../../../Types/Icon/IconProp";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The reported bug (issue #3133): in the "Dashboard Variables" modal, clicking
 * a suggested Attribute Key closed the whole modal and dropped the half-filled
 * variable on the floor.
 *
 * The cause is not in the autocomplete. Every dropdown in this codebase portals
 * its menu to document.body so a scroll container cannot clip it, and React
 * dispatches synthetic events through the REACT tree rather than the DOM tree.
 * So a click on a portalled option still bubbles into Modal's backdrop handler
 * — which decided "outside" by asking whether the panel DOM-contains the event
 * target. A portalled option never is, so every such pick read as a backdrop
 * click and dismissed the dialog.
 *
 * That makes this a Modal-level contract rather than a per-dropdown quirk, and
 * these tests state it once for each portalling surface that can appear in a
 * modal body. Crucially they fire mousedown *and* click: Modal only dismisses
 * on a press that both starts and ends outside, so a click-only test passes
 * even with the bug fully present — which is exactly why it went unnoticed.
 */

const SUGGESTIONS: Array<string> = [
  "k8s.cluster.name",
  "k8s.namespace.name",
  "service.name",
];

const TEXT_OPERATORS: Array<FilterOperator> = [
  FilterOperator.Contains,
  FilterOperator.EqualTo,
  FilterOperator.StartsWith,
];

const DROPDOWN_OPTIONS: Array<DropdownOption> = [
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
];

/*
 * The layer a user actually presses is the one the panel is centred in — the
 * tinted sheet behind it is aria-hidden and inert.
 */
type GetBackdropLayerFunction = () => HTMLElement;

const getBackdropLayer: GetBackdropLayerFunction = (): HTMLElement => {
  return screen.getByTestId("modal").parentElement!;
};

/*
 * A real pointer press is mousedown-then-click. Modal tracks both ends, so
 * anything that only fires `click` cannot observe this bug at all.
 */
type PressFunction = (element: HTMLElement) => void;

const press: PressFunction = (element: HTMLElement): void => {
  fireEvent.mouseDown(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
};

/*
 * A press that begins on one element and ends on another. The browser reports
 * the click against the nearest common ancestor of the two, which for anything
 * inside the dialog is the backdrop layer itself — so the click alone cannot
 * tell a drag from a dismissal, and the modal has to watch both ends.
 */
type DragPressFunction = (from: HTMLElement, to: HTMLElement) => void;

const dragPress: DragPressFunction = (
  from: HTMLElement,
  to: HTMLElement,
): void => {
  fireEvent.mouseDown(from);
  fireEvent.mouseUp(to);
  fireEvent.click(getBackdropLayer().parentElement!);
};

interface PortalHarness {
  onClose: () => void;
}

type RenderInModalFunction = (children: ReactElement) => PortalHarness;

const renderInModal: RenderInModalFunction = (
  children: ReactElement,
): PortalHarness => {
  const onClose: () => void = jest.fn();

  render(
    <Modal title="Dashboard Variables" onClose={onClose}>
      {children}
    </Modal>,
  );

  return { onClose: onClose };
};

describe("Modal dismissal and portalled dropdown menus", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the contract: a portalled pick is not a backdrop press", () => {
    /*
     * States the rule in isolation, with no real dropdown involved: any child
     * a modal body portals out of the panel keeps its clicks to itself. Every
     * component test below is a specific instance of this one.
     */
    test("clicking any child portalled to document.body leaves the modal open", () => {
      const onClose: () => void = jest.fn();
      const onPick: () => void = jest.fn();

      render(
        <Modal title="Dashboard Variables" onClose={onClose}>
          <div>
            {createPortal(
              <button
                type="button"
                data-testid="portalled-option"
                onClick={onPick}
              >
                pick me
              </button>,
              document.body,
            )}
          </div>
        </Modal>,
      );

      const option: HTMLElement = screen.getByTestId("portalled-option");

      // Premise of the bug: the option is genuinely outside the panel's DOM.
      expect(screen.getByTestId("modal").contains(option)).toBe(false);
      expect(option.parentElement).toBe(document.body);

      press(option);

      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("a portalled press does not arm the next backdrop click", () => {
      const onClose: () => void = jest.fn();

      render(
        <Modal title="Dashboard Variables" onClose={onClose}>
          <div>
            {createPortal(
              <button type="button" data-testid="portalled-option">
                pick me
              </button>,
              document.body,
            )}
          </div>
        </Modal>,
      );

      /*
       * Modal remembers where a press started so a drag out of the panel is not
       * a dismissal. A portalled mousedown must not leave that memory set to
       * "outside", or the user's very next click anywhere would close the
       * dialog.
       */
      fireEvent.mouseDown(screen.getByTestId("portalled-option"));
      fireEvent.click(screen.getByTestId("modal-title"));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("AutocompleteTextInput — the surface in the reported bug", () => {
    test("picking a suggestion sets the value and keeps the modal open", () => {
      const onChange: (value: string) => void = jest.fn();
      const harness: PortalHarness = renderInModal(
        <AutocompleteTextInput
          dataTestId="attribute-key"
          suggestions={SUGGESTIONS}
          onChange={onChange}
        />,
      );

      fireEvent.focus(screen.getByTestId("attribute-key"));

      const option: HTMLElement = screen.getAllByRole("option")[1]!;

      expect(screen.getByTestId("modal").contains(option)).toBe(false);

      press(option);

      // Both halves of the report: the value lands *and* the dialog survives.
      expect(onChange).toHaveBeenCalledWith("k8s.namespace.name");
      expect(screen.getByTestId("attribute-key")).toHaveValue(
        "k8s.namespace.name",
      );
      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("picking several suggestions in a row never closes the modal", () => {
      const values: Array<string> = [];
      const harness: PortalHarness = renderInModal(
        <AutocompleteTextInput
          dataTestId="attribute-key"
          suggestions={SUGGESTIONS}
          onChange={(value: string) => {
            values.push(value);
          }}
        />,
      );

      /*
       * A user correcting themselves: pick, retype to search again, pick a
       * different one. Retyping is what reopens the menu and widens the list
       * back out, since a picked value filters the suggestions down to itself.
       */
      const input: HTMLElement = screen.getByTestId("attribute-key");

      fireEvent.focus(input);
      press(screen.getAllByRole("option")[0]!);

      fireEvent.change(input, { target: { value: "service" } });
      press(screen.getAllByRole("option")[0]!);

      fireEvent.change(input, { target: { value: "k8s.n" } });
      press(screen.getAllByRole("option")[0]!);

      expect(values).toEqual([
        "k8s.cluster.name",
        "service",
        "service.name",
        "k8s.n",
        "k8s.namespace.name",
      ]);
      expect(input).toHaveValue("k8s.namespace.name");
      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("the menu closes on pick without taking the dialog with it", () => {
      renderInModal(
        <AutocompleteTextInput
          dataTestId="attribute-key"
          suggestions={SUGGESTIONS}
        />,
      );

      fireEvent.focus(screen.getByTestId("attribute-key"));
      press(screen.getAllByRole("option")[0]!);

      expect(screen.queryByTestId("attribute-key-suggestions")).toBeNull();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("picking the loading row's replacement after suggestions arrive still keeps the modal", () => {
      const onChange: (value: string) => void = jest.fn();
      const onClose: () => void = jest.fn();

      const { rerender } = render(
        <Modal title="Dashboard Variables" onClose={onClose}>
          <AutocompleteTextInput
            dataTestId="attribute-key"
            suggestions={[]}
            isLoadingSuggestions={true}
            loadingMessage="Loading attributes..."
            onChange={onChange}
          />
        </Modal>,
      );

      fireEvent.focus(screen.getByTestId("attribute-key"));
      expect(screen.getByTestId("attribute-key-suggestions")).toHaveTextContent(
        "Loading attributes...",
      );

      // Suggestions land asynchronously in the real dashboard.
      rerender(
        <Modal title="Dashboard Variables" onClose={onClose}>
          <AutocompleteTextInput
            dataTestId="attribute-key"
            suggestions={SUGGESTIONS}
            isLoadingSuggestions={false}
            onChange={onChange}
          />
        </Modal>,
      );

      press(screen.getAllByRole("option")[0]!);

      expect(onChange).toHaveBeenCalledWith("k8s.cluster.name");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("OperatorSelector", () => {
    test("picking an operator keeps the modal open", () => {
      const onChange: (value: FilterOperator) => void = jest.fn();
      const harness: PortalHarness = renderInModal(
        <OperatorSelector
          value={FilterOperator.Contains}
          options={TEXT_OPERATORS}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /contains/i }));

      const option: HTMLElement = screen.getByRole("option", {
        name: "starts with",
      });

      expect(screen.getByTestId("modal").contains(option)).toBe(false);

      press(option);

      expect(onChange).toHaveBeenCalledWith(FilterOperator.StartsWith);
      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
  });

  /*
   * ColorPicker and IconPicker share UseAnchoredFieldPopup, whose own
   * outside-click guard is a native capture-phase document listener — it never
   * touches React propagation, so both were as exposed as the autocomplete.
   * They reach a modal through FormField's Color and Icon schema types, which
   * is to say through every ModelFormModal that edits a label or an incident
   * role: picking a colour used to throw the whole form away.
   */
  describe("ColorPicker", () => {
    test("pressing inside the colour popup keeps the modal open", () => {
      const harness: PortalHarness = renderInModal(
        <ColorPicker
          dataTestId="color-value"
          placeholder="Pick a color"
          onChange={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("color-value"));

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      expect(screen.getByTestId("modal").contains(popup)).toBe(false);

      // The hex field: the part of the popup a user is most likely to press.
      press(popup.querySelector("input") as HTMLElement);

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();
    });
  });

  describe("IconPicker", () => {
    test("picking an icon keeps the modal open", () => {
      const onChange: (value: IconProp | null) => void = jest.fn();
      const harness: PortalHarness = renderInModal(
        <IconPicker
          dataTestId="icon-value"
          placeholder="No icon"
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByTestId("icon-value"));

      const popup: HTMLElement = screen.getByTestId("icon-picker-popup");
      const iconCell: HTMLElement = popup.querySelector(
        `[title="${IconProp.Alert}"]`,
      ) as HTMLElement;

      expect(screen.getByTestId("modal").contains(popup)).toBe(false);
      expect(iconCell).not.toBeNull();

      press(iconCell);

      expect(onChange).toHaveBeenLastCalledWith(IconProp.Alert);
      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
  });

  describe("Dropdown (react-select portalled menu)", () => {
    test("picking an option keeps the modal open", () => {
      const onChange: (
        value: DropdownValue | Array<DropdownValue> | null,
      ) => void = jest.fn();
      const harness: PortalHarness = renderInModal(
        <Dropdown
          options={DROPDOWN_OPTIONS}
          onChange={onChange}
          placeholder="Select an environment"
        />,
      );

      fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

      const option: HTMLElement = screen.getByText("Staging");

      /*
       * react-select is configured with menuPortalTarget={document.body}, so
       * its option is outside the panel exactly like the hand-rolled menus.
       *
       * This one was never broken: react-select's own `onMenuMouseDown` calls
       * stopPropagation, so the press never armed Modal's backdrop tracking.
       * That immunity is incidental to a third-party implementation detail
       * rather than something this codebase decided, which is precisely why it
       * is worth pinning — a react-select upgrade that drops it would otherwise
       * reintroduce the bug on every dropdown in every modal, silently.
       */
      expect(screen.getByTestId("modal").contains(option)).toBe(false);

      press(option);

      expect(onChange).toHaveBeenCalledWith("staging");
      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });
  });

  describe("genuine backdrop dismissal still works", () => {
    /*
     * The fix narrows what counts as a backdrop press, so the far more common
     * behaviour it sits next to has to be pinned down just as hard — a fix that
     * made modals undismissable would be a worse bug than the one it replaced.
     */
    test("a press that starts and ends on the backdrop closes the modal", () => {
      const harness: PortalHarness = renderInModal(<div>Modal content</div>);

      press(getBackdropLayer());

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("a press on the scroll layer that holds the backdrop closes the modal", () => {
      const harness: PortalHarness = renderInModal(<div>Modal content</div>);

      // The 'fixed inset-0 overflow-y-auto' layer the handlers are bound to.
      press(getBackdropLayer().parentElement!);

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("a press inside the panel does not close the modal", () => {
      const harness: PortalHarness = renderInModal(<div>Modal content</div>);

      press(screen.getByText("Modal content"));

      expect(harness.onClose).not.toHaveBeenCalled();
    });

    test("backdrop dismissal still works after a portalled pick", () => {
      const harness: PortalHarness = renderInModal(
        <AutocompleteTextInput
          dataTestId="attribute-key"
          suggestions={SUGGESTIONS}
        />,
      );

      fireEvent.focus(screen.getByTestId("attribute-key"));
      press(screen.getAllByRole("option")[0]!);

      expect(harness.onClose).not.toHaveBeenCalled();

      // The dialog is still dismissable the ordinary way.
      press(getBackdropLayer());

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("a press that starts on the backdrop and ends on the panel is a drag, not a dismissal", () => {
      const harness: PortalHarness = renderInModal(<div>Modal content</div>);

      /*
       * Pressing outside and releasing inside — reaching for the backdrop,
       * changing your mind, letting go over the form. The click lands on the
       * backdrop layer either way, so before the modal tracked the release this
       * discarded whatever had been typed.
       */
      dragPress(getBackdropLayer(), screen.getByText("Modal content"));

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("a press that starts on the panel and ends on the backdrop is a drag too", () => {
      const harness: PortalHarness = renderInModal(<div>Modal content</div>);

      // Selecting text in the body and releasing past the panel edge.
      dragPress(screen.getByText("Modal content"), getBackdropLayer());

      expect(harness.onClose).not.toHaveBeenCalled();
    });

    test("a release on a portalled menu does not dismiss the dialog either", () => {
      const harness: PortalHarness = renderInModal(
        <div>
          {createPortal(
            <button type="button" data-testid="portalled-option">
              pick me
            </button>,
            document.body,
          )}
        </div>,
      );

      dragPress(getBackdropLayer(), screen.getByTestId("portalled-option"));

      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    test("dismissing an open picker leaves the modal behind it standing", () => {
      const harness: PortalHarness = renderInModal(
        <ColorPicker
          dataTestId="color-value"
          placeholder="Pick a color"
          onChange={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("color-value"));
      expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

      /*
       * The popup covers a good part of the backdrop, so "click off it to put
       * it away" is the obvious gesture — and one press used to close the
       * picker and the form behind it together. Dismissal belongs to the
       * topmost layer that is open.
       */
      press(getBackdropLayer());

      expect(screen.queryByTestId("color-picker-popup")).toBeNull();
      expect(harness.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("modal")).toBeInTheDocument();

      // With the picker gone, the very next backdrop press dismisses as usual.
      press(getBackdropLayer());

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });

    test("the close button still closes a modal holding a portalled menu", () => {
      const harness: PortalHarness = renderInModal(
        <AutocompleteTextInput
          dataTestId="attribute-key"
          suggestions={SUGGESTIONS}
        />,
      );

      fireEvent.focus(screen.getByTestId("attribute-key"));
      fireEvent.click(screen.getByTestId("close-button"));

      expect(harness.onClose).toHaveBeenCalledTimes(1);
    });
  });
});
