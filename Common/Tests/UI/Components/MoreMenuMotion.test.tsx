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

type RenderMenuFunction = () => HTMLElement;

const renderMenuTrigger: RenderMenuFunction = (): HTMLElement => {
  render(
    <MoreMenu dataTestId="more-menu-trigger">
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
