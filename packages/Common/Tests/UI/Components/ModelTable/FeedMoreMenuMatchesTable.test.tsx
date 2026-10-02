import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * "The filter, sort, and refresh should be combined into a More button in the
 * feeds component, just like we have in the modal table. In the modal table,
 * you have the More button in the card header with three dots. It should be
 * exactly the same."
 *
 * These render the REAL BaseModelTable's card header and a feed's ⋯ menu side
 * by side and hold them to the same markup: the same three-dots button, the
 * same menu panel, the same items - so a restyle of one is a restyle of both.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FeedMoreMenu from "../../../../UI/Components/Feed/FeedMoreMenu";
import {
  DEFAULT_FEED_OPTIONS,
  FeedOptions,
} from "../../../../UI/Components/Feed/FeedOptions";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const NAME_FILTER: Filter<Monitor> = {
  title: "Name",
  type: FieldType.Text,
  field: { name: true },
} as unknown as Filter<Monitor>;

const renderTable: () => void = (): void => {
  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      return {
        data: [
          { _id: "monitor-1", name: "Checkout API" },
        ] as unknown as Array<Monitor>,
        count: 1,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  const props: BaseModelTableProps<Monitor> = {
    modelType: Monitor,
    id: "feed-parity-table",
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: "feed-parity-table",
    urlStateKey: "feed-parity-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [NAME_FILTER],
    cardProps: { title: "Monitors", description: "All monitors" },
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    showRefreshButton: true,
    viewPageRoute: undefined,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;

  render(<BaseModelTable<Monitor> {...props} />);
};

const renderFeedMenu: () => void = (): void => {
  render(
    <FeedMoreMenu
      value={DEFAULT_FEED_OPTIONS}
      onChange={jest.fn<(options: FeedOptions) => void>()}
      onFilterClick={jest.fn<() => void>()}
      onRefresh={jest.fn<() => void>()}
    />,
  );
};

/*
 * An element's markup without the ids each instance makes up for itself, or
 * the roving tab stop, which sits on whichever item comes first in its menu.
 */
const withoutIds: (element: Element) => string = (element: Element): string => {
  return element.outerHTML
    .replace(/ id="[^"]*"/g, "")
    .replace(/ aria-controls="[^"]*"/g, "")
    .replace(/ aria-labelledby="[^"]*"/g, "")
    .replace(/ tabindex="[^"]*"/g, "");
};

interface MenuParts {
  trigger: string;
  panelClass: string;
  refreshItem: string;
  filterItemClass: string;
}

const readOpenMenu: () => MenuParts = (): MenuParts => {
  const trigger: HTMLElement = screen.getByRole("button", {
    name: "More options",
  });
  const triggerMarkup: string = withoutIds(trigger);

  fireEvent.click(trigger);

  const menu: HTMLElement = screen.getByRole("menu");
  const refresh: HTMLElement = within(menu).getByRole("menuitem", {
    name: "Refresh",
  });
  const filter: HTMLElement = within(menu)
    .getAllByRole("menuitem")
    .find((item: HTMLElement): boolean => {
      return (item.textContent || "").startsWith("Filter");
    })!;

  return {
    trigger: triggerMarkup,
    panelClass: menu.className,
    refreshItem: withoutIds(refresh),
    filterItemClass: filter.className,
  };
};

afterEach(() => {
  cleanup();
});

describe("a feed's ⋯ is the table's card-header ⋯", () => {
  test("the same three-dots button, menu panel and items", async () => {
    renderTable();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "More options" }),
      ).toBeInTheDocument();
    });

    const table: MenuParts = readOpenMenu();

    cleanup();
    renderFeedMenu();

    const feed: MenuParts = readOpenMenu();

    // The trigger: tag, classes, icon, name - everything but its id.
    expect(feed.trigger).toBe(table.trigger);
    expect(feed.panelClass).toBe(table.panelClass);
    // Refresh is the same item in both, down to its icon.
    expect(feed.refreshItem).toBe(table.refreshItem);
    // The table's "Filter" and the feed's "Filter by event type" look alike.
    expect(feed.filterItemClass).toBe(table.filterItemClass);
  });

  test("both name the button More options and draw it with no label", async () => {
    renderTable();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "More options" }),
      ).toBeInTheDocument();
    });

    const tableTrigger: HTMLElement = screen.getByRole("button", {
      name: "More options",
    });

    expect(tableTrigger.textContent).toBe("");
    expect(tableTrigger).toHaveAttribute("aria-haspopup", "menu");

    cleanup();
    renderFeedMenu();

    const feedTrigger: HTMLElement = screen.getByRole("button", {
      name: "More options",
    });

    expect(feedTrigger.textContent).toBe("");
    expect(feedTrigger).toHaveAttribute("aria-haspopup", "menu");
  });
});
