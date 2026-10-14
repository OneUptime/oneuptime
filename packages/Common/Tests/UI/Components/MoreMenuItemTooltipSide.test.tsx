import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Where a menu item's tooltip opens.
 *
 * A tooltip opens above its trigger. On a menu item that covered every item
 * above it while it was read - a locked Delete's reason, the longest a menu
 * has, hid Show ID and View Logs. A menu item's tooltip now opens to the
 * left, beside the menu (a row's or a card's menu sits at its right edge),
 * moving right, then above or below, when that side has no room - as on a
 * phone, where it opens above the item as before.
 *
 * Tippy is stubbed to record what it was asked: jsdom has no layout, so the
 * side Popper would pick there says nothing.
 */

interface TippyProps {
  placement?: string;
  popperOptions?: {
    modifiers?: Array<{ name: string; options?: Record<string, unknown> }>;
  };
  children?: ReactElement;
}

const tippyCalls: Array<TippyProps> = [];

jest.mock("@tippyjs/react", () => {
  return {
    __esModule: true,
    default: (props: TippyProps): ReactElement | null => {
      tippyCalls.push(props);
      return props.children || null;
    },
  };
});

import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import MoreMenuItem, {
  MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS,
  MENU_ITEM_TOOLTIP_PLACEMENT,
} from "../../../UI/Components/MoreMenu/MoreMenuItem";

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  return undefined;
};

const fallbacksOf: (props: TippyProps) => unknown = (
  props: TippyProps,
): unknown => {
  return props.popperOptions?.modifiers?.find((modifier: { name: string }) => {
    return modifier.name === "flip";
  })?.options?.["fallbackPlacements"];
};

afterEach(() => {
  cleanup();
  tippyCalls.length = 0;
});

describe("a tooltip", () => {
  test("opens above its trigger unless told otherwise, and leaves Popper's flip alone", () => {
    render(
      <Tooltip text="Copy the link">
        <button type="button">Copy</button>
      </Tooltip>,
    );

    expect(tippyCalls.length).toBeGreaterThan(0);
    expect(tippyCalls[0]!.placement).toBe("top");
    expect(tippyCalls[0]!.popperOptions).toBeUndefined();
  });

  test("opens on the side it is given, moving to the fallbacks in their order", () => {
    render(
      <Tooltip
        text="Copy the link"
        placement="left"
        fallbackPlacements={["right", "top"]}
      >
        <button type="button">Copy</button>
      </Tooltip>,
    );

    expect(tippyCalls[0]!.placement).toBe("left");
    expect(fallbacksOf(tippyCalls[0]!)).toEqual(["right", "top"]);
  });
});

describe("a menu item's tooltip", () => {
  test("opens beside the menu, then on the other side, then above or below", () => {
    expect(MENU_ITEM_TOOLTIP_PLACEMENT).toBe("left");
    expect(MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS).toEqual([
      "right",
      "top",
      "bottom",
    ]);
  });

  test("a locked item's reason opens beside the menu, not over the items above it", () => {
    render(
      <MoreMenuItem
        text="Delete"
        isDestructive={true}
        isDisabled={true}
        tooltip="The monitor's only status event can't be deleted."
        onClick={noop}
      />,
    );

    expect(tippyCalls[0]!.placement).toBe(MENU_ITEM_TOOLTIP_PLACEMENT);
    expect(fallbacksOf(tippyCalls[0]!)).toEqual(
      MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS,
    );
  });

  test("so does the tooltip of an item that can be used", () => {
    render(
      <MoreMenuItem text="Show ID" tooltip="The event's ID" onClick={noop} />,
    );

    expect(tippyCalls[0]!.placement).toBe(MENU_ITEM_TOOLTIP_PLACEMENT);
    expect(fallbacksOf(tippyCalls[0]!)).toEqual(
      MENU_ITEM_TOOLTIP_FALLBACK_PLACEMENTS,
    );
  });

  test("an item with nothing to say has no tooltip at all", () => {
    render(<MoreMenuItem text="Show ID" onClick={noop} />);

    expect(tippyCalls).toEqual([]);
  });
});
