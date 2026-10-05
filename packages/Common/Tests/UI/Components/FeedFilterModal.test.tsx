import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import FeedFilterModal from "../../../UI/Components/Feed/FeedFilterModal";
import {
  DEFAULT_FEED_OPTIONS,
  FeedEventTypeOption,
  FeedOptions,
} from "../../../UI/Components/Feed/FeedOptions";

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
 * The dialog a feed's ⋯ menu ("Filter by event type") and its filter box
 * ("Edit Filters") open: a table's filter dialog for one thing, the event
 * types. Ticks are held until Apply Filters, so a visit costs the feed one
 * read, and Cancel leaves the feed as it was.
 */

type OnApplyMock = ReturnType<
  typeof jest.fn<(eventTypes: Array<string>) => void>
>;
type OnCloseMock = ReturnType<typeof jest.fn<() => void>>;

const EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = [
  { value: "IncidentCreated", label: "Incident Created", icon: IconProp.Alert },
  {
    value: "IncidentStateChanged",
    label: "Incident State Changed",
    icon: IconProp.ArrowCircleRight,
  },
  { value: "PublicNote", label: "Public Note", icon: IconProp.Announcement },
];

const getDialog: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("dialog", { name: "Filter by event type" });
};

const getCheckbox: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  return within(getDialog()).getByRole("checkbox", { name });
};

const getApply: () => HTMLElement = (): HTMLElement => {
  return within(getDialog()).getByRole("button", { name: "Apply Filters" });
};

interface RenderedModal {
  onApply: OnApplyMock;
  onClose: OnCloseMock;
  rerender: (value: FeedOptions) => void;
}

const renderModal: (value?: FeedOptions) => RenderedModal = (
  value: FeedOptions = DEFAULT_FEED_OPTIONS,
): RenderedModal => {
  const onApply: OnApplyMock = jest.fn<(eventTypes: Array<string>) => void>();
  const onClose: OnCloseMock = jest.fn<() => void>();

  const { rerender } = render(
    <FeedFilterModal
      value={value}
      eventTypeOptions={EVENT_TYPE_OPTIONS}
      onApply={onApply}
      onClose={onClose}
    />,
  );

  return {
    onApply,
    onClose,
    rerender: (nextValue: FeedOptions): void => {
      rerender(
        <FeedFilterModal
          value={nextValue}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onApply={onApply}
          onClose={onClose}
        />,
      );
    },
  };
};

afterEach(() => {
  cleanup();
});

describe("FeedFilterModal", () => {
  test("is a dialog named Filter by event type, holding the feed's checklist", () => {
    renderModal();

    const dialog: HTMLElement = getDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByRole("group", { name: "Event types" }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
    expect(getApply()).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeVisible();
  });

  test("starts from the event types the feed is filtered by", () => {
    renderModal({
      sortOrder: SortOrder.Ascending,
      eventTypes: ["PublicNote"],
    });

    expect(getCheckbox("Public Note")).toBeChecked();
    expect(getCheckbox("Incident Created")).not.toBeChecked();
    expect(
      within(getDialog()).getByTestId("feed-options-event-type-summary"),
    ).toHaveTextContent("Showing 1 of 3 event types.");
  });

  test("holds the ticks until Apply Filters, then hands them over once, in the checklist's order", () => {
    const { onApply, onClose } = renderModal();

    fireEvent.click(getCheckbox("Public Note"));
    fireEvent.click(getCheckbox("Incident Created"));

    // Nothing reaches the feed while the reader is still ticking.
    expect(onApply).not.toHaveBeenCalled();
    expect(getCheckbox("Public Note")).toBeChecked();
    expect(getCheckbox("Incident Created")).toBeChecked();

    fireEvent.click(getApply());

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(["IncidentCreated", "PublicNote"]);
    // Applying is the dialog's job done; closing it is the caller's.
    expect(onClose).not.toHaveBeenCalled();
  });

  test("applies an emptied checklist as no filter", () => {
    const { onApply } = renderModal({
      sortOrder: SortOrder.Descending,
      eventTypes: ["IncidentCreated", "PublicNote"],
    });

    fireEvent.click(
      within(getDialog()).getByRole("button", { name: "Show all" }),
    );

    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(getApply());

    expect(onApply).toHaveBeenCalledWith([]);
  });

  test("Cancel hands nothing over", () => {
    const { onApply, onClose } = renderModal();

    fireEvent.click(getCheckbox("Public Note"));
    fireEvent.click(
      within(getDialog()).getByRole("button", { name: "Cancel" }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  test("Escape closes it without applying", () => {
    const { onApply, onClose } = renderModal();

    fireEvent.click(getCheckbox("Public Note"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  test("keeps the reader's ticks when the feed re-renders under it", () => {
    const { onApply, rerender } = renderModal();

    fireEvent.click(getCheckbox("Public Note"));

    // A refresh of the feed behind the dialog hands it the same options again.
    rerender({ ...DEFAULT_FEED_OPTIONS });

    expect(getCheckbox("Public Note")).toBeChecked();

    fireEvent.click(getApply());

    expect(onApply).toHaveBeenCalledWith(["PublicNote"]);
  });

  test("does not hand the caller's own list back to be changed", () => {
    const eventTypes: Array<string> = ["PublicNote"];
    const { onApply } = renderModal({
      sortOrder: SortOrder.Descending,
      eventTypes,
    });

    fireEvent.click(getCheckbox("Incident Created"));
    fireEvent.click(getApply());

    expect(eventTypes).toEqual(["PublicNote"]);
    expect(onApply.mock.calls[0]![0]).not.toBe(eventTypes);
  });

  test("puts focus in the dialog, on the first box, when it opens", () => {
    renderModal();

    expect(getDialog().contains(document.activeElement)).toBe(true);
    expect(within(getDialog()).getAllByRole("checkbox")[0]).toHaveFocus();
  });
});
