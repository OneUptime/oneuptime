import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import * as React from "react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import FeedCard from "../../../UI/Components/Feed/FeedCard";
import { FeedOptions } from "../../../UI/Components/Feed/FeedOptions";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "../../../UI/Components/Feed/useFeedOptions";
import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";

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
 * The card every dashboard activity feed is drawn in: the header keeps the
 * feed's main action (an incident's Actions) and one ⋯ for the rest - sort,
 * filter, Refresh - and the body says when the feed is filtered. These drive
 * it with the real useFeedOptions, as the feeds do.
 */

type SetOptionsMock = ReturnType<
  typeof jest.fn<(options: FeedOptions) => void>
>;
type RefreshMock = ReturnType<typeof jest.fn<() => Promise<void>>>;

const EVENT_TYPES: Array<string> = [
  "IncidentCreated",
  "PublicNote",
  "PrivateNote",
];

interface HarnessProps {
  onSetOptions: (options: FeedOptions) => void;
  onRefresh: () => Promise<void>;
  withActions?: boolean | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: EVENT_TYPES,
    getEventTypeIcon: (): IconProp => {
      return IconProp.Circle;
    },
    resetKey: "incident-1",
  });

  return (
    <FeedCard
      title="Incident Feed"
      description="Everything that happened to this incident."
      feedOptions={{
        ...feedOptions,
        setOptions: (options: FeedOptions): void => {
          props.onSetOptions(options);
          feedOptions.setOptions(options);
        },
      }}
      onRefresh={props.onRefresh}
      actions={
        props.withActions ? (
          <MoreMenu
            key="actions"
            elementToBeShownInsteadOfButton={<span>Actions</span>}
          >
            {[
              <MoreMenuItem
                key="note"
                text="Add Private Note"
                icon={IconProp.Lock}
                onClick={() => {}}
              />,
            ]}
          </MoreMenu>
        ) : undefined
      }
    >
      <div data-testid="feed-body">{feedOptions.optionsKey}</div>
    </FeedCard>
  );
};

interface Rendered {
  onSetOptions: SetOptionsMock;
  onRefresh: RefreshMock;
}

const renderCard: (withActions?: boolean) => Rendered = (
  withActions: boolean = false,
): Rendered => {
  const onSetOptions: SetOptionsMock =
    jest.fn<(options: FeedOptions) => void>();
  const onRefresh: RefreshMock = jest.fn<() => Promise<void>>(() => {
    return Promise.resolve();
  });

  render(
    <Harness
      onSetOptions={onSetOptions}
      onRefresh={onRefresh}
      withActions={withActions}
    />,
  );

  return { onSetOptions, onRefresh };
};

const getCard: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("card");
};

const getMoreButton: () => HTMLElement = (): HTMLElement => {
  return within(screen.getByTestId("feed-more-menu")).getByRole("button", {
    name: "More options",
  });
};

const pickFromMenu: (name: string, role?: string) => void = (
  name: string,
  role: string = "menuitem",
): void => {
  fireEvent.click(getMoreButton());
  fireEvent.click(within(screen.getByRole("menu")).getByRole(role, { name }));
};

const openFilterDialog: () => HTMLElement = (): HTMLElement => {
  pickFromMenu("Filter by event type");

  return screen.getByRole("dialog", { name: "Filter by event type" });
};

const applyEventTypes: (labels: Array<string>) => void = (
  labels: Array<string>,
): void => {
  const dialog: HTMLElement = openFilterDialog();

  for (const label of labels) {
    fireEvent.click(within(dialog).getByRole("checkbox", { name: label }));
  }

  fireEvent.click(
    within(dialog).getByRole("button", { name: "Apply Filters" }),
  );
};

afterEach(() => {
  cleanup();
});

describe("FeedCard", () => {
  describe("the header", () => {
    test("shows the title, the description, and a lone ⋯ for a feed with no actions", () => {
      renderCard();

      expect(
        within(getCard()).getByTestId("card-details-heading"),
      ).toHaveTextContent("Incident Feed");
      expect(
        within(getCard()).getByTestId("card-description"),
      ).toHaveTextContent("Everything that happened to this incident.");

      const menuButtons: Array<HTMLElement> = within(getCard())
        .getAllByRole("button")
        .filter((button: HTMLElement): boolean => {
          return button.getAttribute("aria-haspopup") === "menu";
        });

      expect(menuButtons).toEqual([getMoreButton()]);
      // Filter, sort and Refresh are no longer buttons of their own.
      expect(
        within(getCard()).queryByRole("button", { name: "Refresh" }),
      ).toBeNull();
      expect(
        within(getCard()).queryByRole("button", { name: /Filter/ }),
      ).toBeNull();
      expect(screen.queryByTestId("card-button")).toBeNull();
    });

    test("keeps the feed's main action in sight, before the ⋯", () => {
      renderCard(true);

      const actions: HTMLElement = within(getCard()).getByRole("button", {
        name: "Actions",
      });
      const more: HTMLElement = getMoreButton();

      expect(
        actions.compareDocumentPosition(more) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const menuButtons: Array<HTMLElement> = within(getCard())
        .getAllByRole("button")
        .filter((button: HTMLElement): boolean => {
          return button.getAttribute("aria-haspopup") === "menu";
        });

      expect(menuButtons).toEqual([actions, more]);
    });

    test("renders the feed itself in the body, with no filter box while unfiltered", () => {
      renderCard();

      expect(screen.getByTestId("feed-body")).toHaveTextContent(/^DESC\|$/);
      expect(screen.queryByTestId("feed-filter-summary")).toBeNull();
    });
  });

  describe("sorting", () => {
    test("Oldest first from the ⋯ reverses the feed", () => {
      const { onSetOptions } = renderCard();

      pickFromMenu("Oldest first", "menuitemradio");

      expect(onSetOptions).toHaveBeenCalledTimes(1);
      expect(onSetOptions).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      });
      expect(screen.getByTestId("feed-body")).toHaveTextContent(/^ASC\|$/);
      // A reversed, unfiltered feed needs no box.
      expect(screen.queryByTestId("feed-filter-summary")).toBeNull();

      fireEvent.click(getMoreButton());
      expect(
        within(screen.getByRole("menu")).getByRole("menuitemradio", {
          name: "Oldest first",
        }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("filtering", () => {
    test("Filter by event type opens the dialog; Apply Filters narrows the feed in one change and shows the box", () => {
      const { onSetOptions } = renderCard();

      applyEventTypes(["Public Note", "Incident Created"]);

      expect(onSetOptions).toHaveBeenCalledTimes(1);
      expect(onSetOptions).toHaveBeenCalledWith({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "PublicNote"],
      });
      expect(
        screen.queryByRole("dialog", { name: "Filter by event type" }),
      ).toBeNull();
      expect(screen.getByTestId("feed-body")).toHaveTextContent(
        "DESC|IncidentCreated,PublicNote",
      );

      const box: HTMLElement = screen.getByTestId("feed-filter-summary");

      expect(within(box).getByText("Showing 2 of 3 event types")).toBeVisible();
      // In the body, above the feed.
      expect(
        box.compareDocumentPosition(screen.getByTestId("feed-body")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("applying what is already applied changes nothing", () => {
      const { onSetOptions } = renderCard();

      const dialog: HTMLElement = openFilterDialog();

      fireEvent.click(
        within(dialog).getByRole("button", { name: "Apply Filters" }),
      );

      expect(onSetOptions).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("dialog", { name: "Filter by event type" }),
      ).toBeNull();
    });

    test("Cancel leaves the feed as it was", () => {
      const { onSetOptions } = renderCard();

      const dialog: HTMLElement = openFilterDialog();

      fireEvent.click(
        within(dialog).getByRole("checkbox", { name: "Public Note" }),
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(onSetOptions).not.toHaveBeenCalled();
      expect(screen.queryByTestId("feed-filter-summary")).toBeNull();
    });

    test("Edit Filters reopens the dialog with the applied ticks", () => {
      const { onSetOptions } = renderCard();

      applyEventTypes(["Private Note"]);
      onSetOptions.mockClear();

      fireEvent.click(
        within(screen.getByTestId("feed-filter-summary")).getByRole("button", {
          name: "Edit Filters",
        }),
      );

      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Filter by event type",
      });

      expect(
        within(dialog).getByRole("checkbox", { name: "Private Note" }),
      ).toBeChecked();

      fireEvent.click(
        within(dialog).getByRole("checkbox", { name: "Public Note" }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Apply Filters" }),
      );

      // The checklist's order goes in; the feed reads them in its own order.
      expect(onSetOptions).toHaveBeenCalledWith({
        sortOrder: SortOrder.Descending,
        eventTypes: ["PrivateNote", "PublicNote"],
      });
      expect(screen.getByTestId("feed-body")).toHaveTextContent(
        /^DESC\|PublicNote,PrivateNote$/,
      );
      expect(
        within(screen.getByTestId("feed-filter-summary")).getByText(
          "Showing 2 of 3 event types",
        ),
      ).toBeVisible();
    });

    test("keeps the sort order through a filter change", () => {
      const { onSetOptions } = renderCard();

      pickFromMenu("Oldest first", "menuitemradio");
      applyEventTypes(["Public Note"]);

      expect(onSetOptions).toHaveBeenLastCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["PublicNote"],
      });
    });

    test("Clear Filters shows every event type again, removes the box, and hands focus to the ⋯", async () => {
      const { onSetOptions } = renderCard();

      applyEventTypes(["Public Note"]);
      onSetOptions.mockClear();

      const clear: HTMLElement = within(
        screen.getByTestId("feed-filter-summary"),
      ).getByRole("button", { name: "Clear Filters" });

      act(() => {
        clear.focus();
      });
      fireEvent.click(clear);

      expect(onSetOptions).toHaveBeenCalledTimes(1);
      expect(onSetOptions).toHaveBeenCalledWith({
        sortOrder: SortOrder.Descending,
        eventTypes: [],
      });
      expect(screen.queryByTestId("feed-filter-summary")).toBeNull();

      // Not dropped on the page with the button that went away.
      await waitFor(() => {
        expect(getMoreButton()).toHaveFocus();
      });
    });

    test("applying nothing from Edit Filters removes the box and hands focus to the ⋯", async () => {
      renderCard();

      applyEventTypes(["Public Note"]);

      const edit: HTMLElement = within(
        screen.getByTestId("feed-filter-summary"),
      ).getByRole("button", { name: "Edit Filters" });

      act(() => {
        edit.focus();
      });
      fireEvent.click(edit);

      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Filter by event type",
      });

      fireEvent.click(within(dialog).getByRole("button", { name: "Show all" }));
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Apply Filters" }),
      );

      expect(screen.queryByTestId("feed-filter-summary")).toBeNull();
      await waitFor(() => {
        expect(getMoreButton()).toHaveFocus();
      });
    });
  });

  describe("refreshing", () => {
    test("Refresh in the ⋯ re-reads the feed, once", () => {
      const { onRefresh, onSetOptions } = renderCard();

      pickFromMenu("Refresh");

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onSetOptions).not.toHaveBeenCalled();
    });

    test("a failed refresh is the feed's to show, not an unhandled rejection", async () => {
      const onRefresh: RefreshMock = jest.fn<() => Promise<void>>(() => {
        return Promise.reject(new Error("The API is restarting."));
      });
      const unhandled: Array<unknown> = [];
      const onUnhandled: (reason: unknown) => void = (
        reason: unknown,
      ): void => {
        unhandled.push(reason);
      };

      process.on("unhandledRejection", onUnhandled);

      try {
        render(
          <Harness
            onSetOptions={jest.fn<(options: FeedOptions) => void>()}
            onRefresh={onRefresh}
          />,
        );

        pickFromMenu("Refresh");

        await act(async () => {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 0);
          });
        });

        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });
});
