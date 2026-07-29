import InfoCard from "../../../UI/Components/InfoCard/InfoCard";
/*
 * The package entry, not the `/extend-expect` subpath the older tests use:
 * the matchers are already registered by Tests/jest.setup.ts, and only this
 * specifier resolves to the type augmentation that makes them visible to
 * TypeScript.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * InfoCard is the stat card used across the product. Most of them are inert
 * containers, a handful navigate somewhere when clicked, and the network
 * summary strips use them as toggles that filter the table below.
 *
 * The three have to stay distinguishable to a screen reader and to the
 * keyboard, and the distinctions are all driven off which props were passed —
 * so that is what these cover, end to end through a real render.
 */

/*
 * The card's own root element. Taken off the render container rather than
 * walked up from the title, because a card with no click handler has no role
 * to query it by — which is exactly what several of these assert.
 */
function getCard(): HTMLElement {
  return document.body.firstElementChild!.firstElementChild as HTMLElement;
}

describe("InfoCard", () => {
  describe("a card with no click handler", () => {
    test("renders its title and value", () => {
      render(<InfoCard title="Devices Up" value="12" />);

      expect(screen.getByText("Devices Up")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
    });

    /*
     * The majority of InfoCards in the product are read-only. Announcing one
     * as a button would put a tab stop on every tile of every dashboard.
     */
    test("is not a button, and is not focusable", () => {
      render(<InfoCard title="Devices Up" value="12" />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(getCard()).not.toHaveAttribute("tabindex");
      expect(getCard()).not.toHaveAttribute("aria-pressed");
      expect(getCard()).not.toHaveAttribute("aria-label");
    });

    test("does not look clickable", () => {
      render(<InfoCard title="Devices Up" value="12" />);

      expect(getCard()).not.toHaveClass("cursor-pointer");
    });
  });

  describe("a card that navigates when clicked", () => {
    /*
     * The pre-existing clickable cards — the Home overview stats, the
     * Kubernetes and Proxmox summaries — all navigate. They pass onClick and
     * no isSelected.
     */
    test("is a real button, reachable by keyboard", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          onClick={() => {
            // no-op
          }}
        />,
      );

      const card: HTMLElement = screen.getByRole("button");
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).toHaveClass("cursor-pointer");
    });

    /*
     * The regression this guards: `aria-pressed="false"` asserts the control
     * is a toggle that is currently off. On a card that navigates away, that
     * is a state activating it can never reach — the user is told to expect
     * something the product never does.
     */
    test("is not announced as an unpressed toggle", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");
    });

    test("keeps the plain border", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(screen.getByRole("button")).toHaveClass("border-gray-200");
    });
  });

  describe("a card used as a toggle", () => {
    test("announces itself as pressed when selected", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          isSelected={true}
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    /*
     * Explicit `false` is a real state here — the tile exists, it is simply
     * not the one the table is filtered by — so it must still announce as a
     * toggle, unlike the navigation card above.
     */
    test("announces itself as unpressed when explicitly not selected", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          isSelected={false}
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    /*
     * Tailwind emits both border-colour utilities at the same specificity, so
     * a selected card that merely *added* a border colour would leave the
     * winner up to stylesheet order. The class is swapped.
     */
    test("swaps its border rather than stacking a second one", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          isSelected={true}
          onClick={() => {
            // no-op
          }}
        />,
      );

      const card: HTMLElement = screen.getByRole("button");
      expect(card).toHaveClass("border-indigo-500");
      expect(card).not.toHaveClass("border-gray-200");
    });

    test("carries the caller's label for screen readers", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          isSelected={true}
          ariaLabel="Devices Up: 12. Showing these in the list below."
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(
        screen.getByRole("button", {
          name: "Devices Up: 12. Showing these in the list below.",
        }),
      ).toBeInTheDocument();
    });

    // A label on an inert card would announce a control that is not there.
    test("ignores the label when there is nothing to activate", () => {
      render(
        <InfoCard title="Devices Up" value="12" ariaLabel="Should not apply" />,
      );

      expect(getCard()).not.toHaveAttribute("aria-label");
    });

    // Selection styling is meaningless without a handler to toggle it.
    test("a non-clickable card ignores isSelected", () => {
      render(<InfoCard title="Devices Up" value="12" isSelected={true} />);

      expect(getCard()).toHaveClass("border-gray-200");
      expect(getCard()).not.toHaveAttribute("aria-pressed");
    });
  });

  describe("activation", () => {
    test("a click fires the handler", () => {
      const onClick: () => void = jest.fn();
      render(<InfoCard title="Devices Up" value="12" onClick={onClick} />);

      fireEvent.click(screen.getByRole("button"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    /*
     * A div with an onClick is invisible to the keyboard. Enter and Space are
     * what a real button responds to, and both have to work here or the tiles
     * are mouse-only.
     */
    test("Enter fires the handler", () => {
      const onClick: () => void = jest.fn();
      render(<InfoCard title="Devices Up" value="12" onClick={onClick} />);

      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    test("Space fires the handler", () => {
      const onClick: () => void = jest.fn();
      render(<InfoCard title="Devices Up" value="12" onClick={onClick} />);

      fireEvent.keyDown(screen.getByRole("button"), { key: " " });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    /*
     * Space scrolls the page by default. Without preventDefault, activating a
     * tile from the keyboard would also jump the view down a screen.
     */
    test("Space does not also scroll the page", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          onClick={() => {
            // no-op
          }}
        />,
      );

      // fireEvent returns false when the handler called preventDefault.
      const notCancelled: boolean = fireEvent.keyDown(
        screen.getByRole("button"),
        { key: " ", cancelable: true },
      );

      expect(notCancelled).toBe(false);
    });

    test("Enter does not swallow the default either way it is used", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(
        fireEvent.keyDown(screen.getByRole("button"), {
          key: "Enter",
          cancelable: true,
        }),
      ).toBe(false);
    });

    test.each([["Tab"], ["Escape"], ["a"], ["ArrowDown"], ["Shift"]])(
      "%s does not activate it",
      (key: string) => {
        const onClick: () => void = jest.fn();
        render(<InfoCard title="Devices Up" value="12" onClick={onClick} />);

        const notCancelled: boolean = fireEvent.keyDown(
          screen.getByRole("button"),
          { key: key, cancelable: true },
        );

        expect(onClick).not.toHaveBeenCalled();
        // And the key still does whatever it normally does.
        expect(notCancelled).toBe(true);
      },
    );
  });

  describe("styling passthrough", () => {
    test("the caller's className still lands on the card", () => {
      render(<InfoCard title="Devices Up" value="12" className="col-span-2" />);

      expect(getCard()).toHaveClass("col-span-2");
    });

    test("the caller's text class still wraps the value", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          textClassName="text-emerald-600"
        />,
      );

      expect(screen.getByText("12")).toHaveClass("text-emerald-600");
    });

    /*
     * A keyboard user has to be able to see which card they are on — the
     * focus ring is the only cue, since the card has no other focus styling.
     */
    test("a clickable card shows a focus ring", () => {
      render(
        <InfoCard
          title="Devices Up"
          value="12"
          onClick={() => {
            // no-op
          }}
        />,
      );

      expect(screen.getByRole("button")).toHaveClass("focus-visible:ring-2");
    });

    test("an inert card does not", () => {
      render(<InfoCard title="Devices Up" value="12" />);

      expect(getCard()).not.toHaveClass("focus-visible:ring-2");
    });
  });
});
