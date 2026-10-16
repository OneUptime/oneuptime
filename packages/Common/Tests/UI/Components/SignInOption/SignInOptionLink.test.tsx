import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../../Types/API/Route";
import IconProp from "../../../../Types/Icon/IconProp";
import Navigation from "../../../../UI/Utils/Navigation";
import SignInOptionLink from "../../../../UI/Components/SignInOption/SignInOptionLink";
import { getSignInOptionClassName } from "../../../../UI/Components/SignInOption/SignInOptionStyle";

/*
 * Another way to sign in that is a page of its own (single sign-on, or the
 * password form from the single sign-on page): drawn as a sign-in option,
 * still a link.
 */

const renderOption: () => HTMLElement = (): HTMLElement => {
  render(
    <SignInOptionLink
      to={new Route("/accounts/sso")}
      id="sso-login"
      dataTestId="sso-login"
      icon={IconProp.ShieldCheck}
      title="Sign in with SSO"
    />,
  );

  return screen.getByRole("link", { name: "Sign in with SSO" });
};

describe("SignInOptionLink", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("is a link, named by its words, to the page it opens", () => {
    const option: HTMLElement = renderOption();

    expect(option.tagName).toBe("A");
    expect(option).toHaveAttribute("href", "/accounts/sso");
    expect(option).toHaveAttribute("id", "sso-login");
    expect(option).toHaveAttribute("data-testid", "sso-login");
    expect(option).toHaveAccessibleName("Sign in with SSO");
    // A link, not a script-only control.
    expect(option).not.toHaveAttribute("role");
  });

  test("looks like every other way in: a full-width outlined button", () => {
    const option: HTMLElement = renderOption();

    for (const name of getSignInOptionClassName("ready").split(" ")) {
      expect(option).toHaveClass(name);
    }
    expect(option).toHaveClass("w-full", "border", "bg-white");
    expect(option).not.toHaveClass("text-indigo-500");
  });

  test("draws its icon before its words, and keeps the icon out of its name", () => {
    const option: HTMLElement = renderOption();
    const icon: SVGElement | null = option.querySelector("svg");
    const words: HTMLElement = screen.getByText("Sign in with SSO");

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("h-5", "w-5");
    expect(option.textContent).toBe("Sign in with SSO");
    /*
     * At the start of the words, inside them (SignInOptionLabel): a label
     * that wraps keeps its icon beside its first words.
     */
    expect(Array.from(option.children)).toEqual([words]);
    expect(words.firstElementChild).toContainElement(icon);
  });

  /*
   * A label is laid out by its own first letter. The page around it is laid
   * out left to right in every language, so a Persian label that ends in a
   * Latin word - "ورود با SSO" - was read starting from "SSO".
   */
  test("lays its words out by their own direction", () => {
    renderOption();

    expect(screen.getByText("Sign in with SSO")).toHaveAttribute("dir", "auto");
  });

  test("a click opens the page inside the app", () => {
    const option: HTMLElement = renderOption();

    fireEvent.click(option);

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(
      (jest.mocked(Navigation.navigate).mock.calls[0]![0] as Route).toString(),
    ).toBe("/accounts/sso");
  });

  test("a Cmd or Ctrl click is left to the browser, which opens a new tab", () => {
    const option: HTMLElement = renderOption();

    fireEvent.click(option, { metaKey: true });
    fireEvent.click(option, { ctrlKey: true });

    expect(Navigation.navigate).not.toHaveBeenCalled();
  });
});
