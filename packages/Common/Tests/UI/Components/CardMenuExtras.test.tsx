import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useLayoutEffect } from "react";
import Card from "../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../UI/Components/Card/CardMoreMenu";
import CardSections from "../../../UI/Components/Card/CardSections";
import {
  CardMenuExtraItem,
  CardMenuExtras,
  mergeCardMenuExtraItems,
  useCardMenuExtras,
} from "../../../UI/Components/Card/CardMenuExtras";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import Modal from "../../../UI/Components/Modal/Modal";
import SideOver from "../../../UI/Components/SideOver/SideOver";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * What a card's content adds to the card's ⋯ menu: a table's "Reset
 * column widths" (Table/ColumnResize), where the table keeps its other
 * options. The card holds the items, every ⋯ in its header draws them after
 * its own and says it is there (menuCount) - a table with no ⋯ to keep its
 * reset in draws it at its header's end instead. A section of a card is the
 * card's; a dialog or a side panel opened from a card is not.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const item: (
  key: string,
  text: string,
  onClick?: () => void,
) => CardMenuExtraItem = (
  key: string,
  text: string,
  onClick?: () => void,
): CardMenuExtraItem => {
  return {
    key: key,
    text: text,
    icon: IconProp.ArrowUturnLeft,
    onClick: onClick || ((): void => {}),
  };
};

describe("the items a card's ⋯ adds", () => {
  test("one an item key, in the order their keys came", () => {
    expect(
      mergeCardMenuExtraItems([
        ["table-a", item("reset", "Reset column widths")],
        ["feed", item("export", "Export")],
        ["table-b", item("reset", "Reset column widths")],
      ]).map((merged: CardMenuExtraItem): string => {
        return merged.key;
      }),
    ).toEqual(["reset", "export"]);
  });

  test("one item for two owners runs both owners' onClick", () => {
    const first: jest.Mock<() => void> = jest.fn<() => void>();
    const second: jest.Mock<() => void> = jest.fn<() => void>();
    const merged: Array<CardMenuExtraItem> = mergeCardMenuExtraItems([
      ["table-a", item("reset", "Reset column widths", first)],
      ["table-b", item("reset", "Reset column widths", second)],
    ]);

    merged[0]!.onClick();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("an item of one owner is that item, as it is", () => {
    const only: CardMenuExtraItem = item("reset", "Reset column widths");

    expect(mergeCardMenuExtraItems([["table", only]])[0]).toBe(only);
    expect(mergeCardMenuExtraItems([])).toEqual([]);
  });
});

// A part of a card that adds an item while it is drawn, as a table does.
const Owner: (props: {
  ownerId: string;
  item: CardMenuExtraItem | null;
  onExtras?: ((extras: CardMenuExtras | null) => void) | undefined;
}) => ReactElement = (props: {
  ownerId: string;
  item: CardMenuExtraItem | null;
  onExtras?: ((extras: CardMenuExtras | null) => void) | undefined;
}): ReactElement => {
  const extras: CardMenuExtras | null = useCardMenuExtras();
  const setItem: CardMenuExtras["setItem"] | undefined = extras?.setItem;

  props.onExtras?.(extras);

  useLayoutEffect(() => {
    if (!setItem || !props.item) {
      return undefined;
    }

    setItem(props.ownerId, props.item);

    return () => {
      setItem(props.ownerId, null);
    };
  }, [setItem, props.item, props.ownerId]);

  return <p>Owner</p>;
};

const moreMenu: () => ReactElement = (): ReactElement => {
  return (
    <CardMoreMenu key="more">
      {[
        <MoreMenuItem
          key="refresh"
          text="Refresh"
          icon={IconProp.Refresh}
          onClick={() => {}}
        />,
      ]}
    </CardMoreMenu>
  );
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
  });

  return screen.getByRole("menu");
};

const menuItems: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((element: HTMLElement): string => {
      return (element.textContent || "").trim();
    });
};

describe("a card and its ⋯", () => {
  test("its ⋯ draws what the card holds adds, after its own items", () => {
    const reset: jest.Mock<() => void> = jest.fn<() => void>();
    const resetItem: CardMenuExtraItem = item(
      "reset",
      "Reset column widths",
      reset,
    );

    render(
      <Card title="Services" buttons={[moreMenu()]}>
        <Owner ownerId="table" item={resetItem} />
      </Card>,
    );

    const menu: HTMLElement = openMenu();

    expect(menuItems(menu)).toEqual(["Refresh", "Reset column widths"]);

    act(() => {
      fireEvent.click(within(menu).getByText("Reset column widths"));
    });

    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("an item taken back is gone from the ⋯", () => {
    const resetItem: CardMenuExtraItem = item("reset", "Reset column widths");
    const view: ReturnType<typeof render> = render(
      <Card title="Services" buttons={[moreMenu()]}>
        <Owner ownerId="table" item={resetItem} />
      </Card>,
    );

    view.rerender(
      <Card title="Services" buttons={[moreMenu()]}>
        <Owner ownerId="table" item={null} />
      </Card>,
    );

    expect(menuItems(openMenu())).toEqual(["Refresh"]);
  });

  test("the card knows how many ⋯ its header draws: a table with none keeps its reset itself", () => {
    let seen: CardMenuExtras | null = null;

    const view: ReturnType<typeof render> = render(
      <Card title="Services" buttons={[moreMenu()]}>
        <Owner
          ownerId="table"
          item={null}
          onExtras={(extras: CardMenuExtras | null) => {
            seen = extras;
          }}
        />
      </Card>,
    );

    expect(seen).not.toBeNull();
    expect(seen!.menuCount).toBe(1);

    view.rerender(
      <Card title="Services">
        <Owner
          ownerId="table"
          item={null}
          onExtras={(extras: CardMenuExtras | null) => {
            seen = extras;
          }}
        />
      </Card>,
    );

    expect(seen!.menuCount).toBe(0);
  });

  test("outside any card there is nothing to add to", () => {
    let seen: CardMenuExtras | null | undefined = undefined;

    render(
      <Owner
        ownerId="table"
        item={item("reset", "Reset column widths")}
        onExtras={(extras: CardMenuExtras | null) => {
          seen = extras;
        }}
      />,
    );

    expect(seen).toBeNull();
  });

  test("a ⋯ outside any card draws only its own items", () => {
    render(moreMenu());

    expect(menuItems(openMenu())).toEqual(["Refresh"]);
  });

  test("a section of a card is the card's: its table's reset is in the card's ⋯", () => {
    render(
      <Card title="Services" buttons={[moreMenu()]}>
        <CardSections>
          <Card title="Section">
            <Owner
              ownerId="table"
              item={item("reset", "Reset column widths")}
            />
          </Card>
        </CardSections>
      </Card>,
    );

    expect(menuItems(openMenu())).toEqual(["Refresh", "Reset column widths"]);
  });

  test("a dialog opened from a card is a page of its own: its content adds nothing to the card's ⋯", () => {
    let seen: CardMenuExtras | null | undefined = undefined;

    render(
      <Card title="Services" buttons={[moreMenu()]}>
        <Modal title="Pick" onSubmit={() => {}} onClose={() => {}}>
          <Owner
            ownerId="table"
            item={item("reset", "Reset column widths")}
            onExtras={(extras: CardMenuExtras | null) => {
              seen = extras;
            }}
          />
        </Modal>
      </Card>,
    );

    expect(seen).toBeNull();
    expect(menuItems(openMenu())).toEqual(["Refresh"]);
  });

  test("so is a side panel", () => {
    let seen: CardMenuExtras | null | undefined = undefined;

    render(
      <Card title="Services" buttons={[moreMenu()]}>
        <SideOver
          title="Details"
          description="More about it"
          onClose={() => {}}
          onSubmit={() => {}}
        >
          <Owner
            ownerId="table"
            item={item("reset", "Reset column widths")}
            onExtras={(extras: CardMenuExtras | null) => {
              seen = extras;
            }}
          />
        </SideOver>
      </Card>,
    );

    expect(seen).toBeNull();
  });
});
