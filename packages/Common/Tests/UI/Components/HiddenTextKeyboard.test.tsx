import HiddenText from "../../../UI/Components/HiddenText/HiddenText";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A SECRET'S REVEAL, COPY AND HIDE, FROM THE KEYBOARD (#7339).
 *
 * "Click to reveal" and "Hide" were clickable boxes that nothing could
 * focus: a keyboard could not reveal an API key, a SCIM token or the
 * license key at all, and Hide had no name for a screen reader to say,
 * whatever language the page was in. Each is a button now, named in the
 * reader's words, and the focus follows the toggle: from the reveal button
 * to the revealed secret's first control, and from Hide back to the reveal
 * button, so a keyboard never loses its place on a button that is gone.
 *
 * A long secret wraps inside its box, which is never wider than its cell:
 * on Settings > License the revealed key used to push Copy and Hide out of
 * sight on a phone, and on a Persian page Hide was cut off.
 */

const SECRET: string = "olk_live_7f3a9c2e5b1d48e0a6f2c9b7d3e1a5f8";

afterEach(() => {
  cleanup();
});

describe("HiddenText from the keyboard", () => {
  test("the reveal control is a button named Click to reveal, inside the box tests find it by", () => {
    render(<HiddenText text={SECRET} isCopyable={true} />);

    const reveal: HTMLElement = screen.getByRole("button", {
      name: "Click to reveal",
    });

    expect(reveal.tagName).toBe("BUTTON");
    expect(reveal).toHaveAttribute("type", "button");
    expect(screen.getByRole("hidden-text")).toContainElement(reveal);
    // Nothing of the secret is on the page before it is revealed.
    expect(document.body.textContent).not.toContain(SECRET);
  });

  test("Tab reaches the reveal button and Enter reveals the secret, with the focus on Copy", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(<HiddenText text={SECRET} isCopyable={true} />);

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Click to reveal" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("revealed-text")).toHaveTextContent(SECRET);
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();
  });

  test("Space reveals it too, and with no copy button the focus lands on Hide", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(<HiddenText text={SECRET} />);

    await user.tab();
    await user.keyboard(" ");

    expect(screen.getByRole("revealed-text")).toHaveTextContent(SECRET);
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveFocus();
  });

  test("Hide is a button named Hide, and the focus goes back to the reveal button", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(<HiddenText text={SECRET} isCopyable={true} />);

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();

    const hide: HTMLElement = screen.getByRole("button", { name: "Hide" });

    expect(hide).toHaveFocus();
    expect(hide).toHaveAttribute("data-testid", "hide-text-icon");
    expect(hide).toHaveAttribute("type", "button");

    await user.keyboard("{Enter}");

    expect(screen.queryByRole("revealed-text")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Click to reveal" }),
    ).toHaveFocus();
  });

  test("Shift+Tab from Hide goes back to Copy: both are in the tab order, in reading order", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(<HiddenText text={SECRET} isCopyable={true} />);

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();
  });

  test("a click with the focus elsewhere reveals the secret and leaves the focus where it was", () => {
    render(
      <div>
        <input aria-label="Search" />
        <HiddenText text={SECRET} isCopyable={true} />
      </div>,
    );

    const search: HTMLElement = screen.getByRole("textbox", { name: "Search" });

    search.focus();
    fireEvent.click(screen.getByRole("hidden-text"));

    expect(screen.getByRole("revealed-text")).toHaveTextContent(SECRET);
    expect(search).toHaveFocus();

    fireEvent.click(screen.getByTestId("hide-text-icon"));

    expect(screen.queryByRole("revealed-text")).toBeNull();
    expect(search).toHaveFocus();
  });

  test("neither box grows wider than its cell, so a long secret wraps beside Copy and Hide", () => {
    render(<HiddenText text={SECRET} isCopyable={true} />);

    const box: HTMLElement = screen.getByRole("hidden-text");

    expect(box).toHaveClass("max-w-full");
    expect(screen.getByRole("button", { name: "Click to reveal" })).toHaveClass(
      "max-w-full",
    );

    fireEvent.click(box);

    const revealed: HTMLElement = screen.getByRole("revealed-text");

    expect(revealed).toHaveClass("break-all");
    expect(revealed.parentElement).toHaveClass("max-w-full");
    // The buttons keep their size: only the secret wraps.
    expect(
      screen.getByRole("button", { name: "Hide" }).parentElement,
    ).toHaveClass("flex-shrink-0");
  });
});
