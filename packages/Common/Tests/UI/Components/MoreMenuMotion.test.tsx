import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

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
 * The menu mounts closed and opens on the next animation frame, so anything
 * asserting the settled look has to let that frame run first — the same
 * choreography Modal.test.tsx flushes.
 */
type FlushEntranceFrameFunction = () => Promise<void>;

const flushEntranceFrame: FlushEntranceFrameFunction =
  async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

type RenderMenuFunction = (isOpeningUpwards?: boolean) => HTMLElement;

const renderMenuTrigger: RenderMenuFunction = (
  isOpeningUpwards?: boolean,
): HTMLElement => {
  render(
    <MoreMenu
      dataTestId="more-menu-trigger"
      isOpeningUpwards={isOpeningUpwards}
    >
      <MoreMenuItem
        key="first"
        text="First action"
        onClick={() => {
          return;
        }}
      />
      <MoreMenuItem
        key="second"
        text="Second action"
        onClick={() => {
          return;
        }}
      />
    </MoreMenu>,
  );

  return screen.getByTestId("more-menu-trigger");
};

describe("MoreMenu entrance motion", () => {
  test("the menu mounts faded and shrunk towards its top-right origin", () => {
    const trigger: HTMLElement = renderMenuTrigger();

    fireEvent.click(trigger);

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("opacity-0", "scale-95", "origin-top-right");
    expect(menu).toHaveClass(
      "transition",
      "duration-150",
      "ease-out",
      "motion-reduce:transition-none",
    );
  });

  test("after the entrance frame the menu is opaque with no lingering transform", async () => {
    const trigger: HTMLElement = renderMenuTrigger();

    fireEvent.click(trigger);
    await flushEntranceFrame();

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("opacity-100");

    /*
     * A settled menu carries no transform class at all: a lingering scale
     * would make it the containing block for position:fixed descendants —
     * the same invariant Modal pins.
     */
    expect(menu.className).not.toMatch(/(^|\s)(sm:)?(scale|translate)-/);
  });

  test("closing and reopening starts the entrance from the closed state again", async () => {
    const trigger: HTMLElement = renderMenuTrigger();

    fireEvent.click(trigger);
    await flushEntranceFrame();

    expect(screen.getByRole("menu")).toHaveClass("opacity-100");

    // Toggle closed, then straight back open.
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toHaveClass("opacity-0", "scale-95");

    await flushEntranceFrame();

    expect(screen.getByRole("menu")).toHaveClass("opacity-100");
  });
});

/*
 * The menu is absolutely positioned and has no flipping logic of its own,
 * so the direction is the caller's to declare. It matters for more than
 * looks: the session replay transport is the LAST row of the player card,
 * and in theater that card fills a fullscreen element with
 * `overflow-hidden` — a menu opening downwards from there is drawn outside
 * the fullscreen element, where it cannot be scrolled to or clicked at
 * all. Both directions are pinned by their class tokens so a refactor of
 * the (one, long) className template cannot quietly drop one of them.
 */
describe("MoreMenu opening direction", () => {
  test("opens downwards by default, anchored under its trigger", () => {
    const trigger: HTMLElement = renderMenuTrigger();

    fireEvent.click(trigger);

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("mt-2", "origin-top-right");
    expect(menu).not.toHaveClass("bottom-full", "mb-2", "origin-bottom-right");
  });

  test("opens upwards when the caller says it sits at the bottom of its surface", () => {
    const trigger: HTMLElement = renderMenuTrigger(true);

    fireEvent.click(trigger);

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("bottom-full", "mb-2", "origin-bottom-right");
    expect(menu).not.toHaveClass("mt-2", "origin-top-right");
  });

  test("isOpeningUpwards={false} is the downward menu, not a third state", () => {
    const trigger: HTMLElement = renderMenuTrigger(false);

    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toHaveClass("mt-2", "origin-top-right");
  });

  test.each([
    { label: "downwards", isOpeningUpwards: false },
    { label: "upwards", isOpeningUpwards: true },
  ])(
    "the entrance still runs and settles when the menu opens $label",
    async ({ isOpeningUpwards }: { isOpeningUpwards: boolean }) => {
      const trigger: HTMLElement = renderMenuTrigger(isOpeningUpwards);

      fireEvent.click(trigger);

      const menu: HTMLElement = screen.getByRole("menu");

      expect(menu).toHaveClass("opacity-0", "scale-95");
      expect(menu).toHaveClass(
        "transition",
        "duration-150",
        "ease-out",
        "motion-reduce:transition-none",
      );

      await flushEntranceFrame();

      const settled: HTMLElement = screen.getByRole("menu");

      expect(settled).toHaveClass("opacity-100");
      /* The Modal invariant holds either way: no lingering transform. */
      expect(settled.className).not.toMatch(/(^|\s)(sm:)?(scale|translate)-/);
      /* And the direction survives the entrance frame. */
      expect(settled).toHaveClass(
        isOpeningUpwards ? "origin-bottom-right" : "origin-top-right",
      );
    },
  );
});
