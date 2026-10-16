import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import IconProp from "../../../../Types/Icon/IconProp";
import Icon from "../../../../UI/Components/Icon/Icon";
import SignInOptionLabel from "../../../../UI/Components/SignInOption/SignInOptionLabel";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_ICON_CLASS,
  SIGN_IN_OPTION_ICON_SLOT_CLASS,
  SIGN_IN_OPTION_LABEL_CLASS,
} from "../../../../UI/Components/SignInOption/SignInOptionStyle";

/*
 * The words of a sign-in option with their icon at the start of the first
 * line (SignInOptionLabel). The words and the icon are one run of text, the
 * option's only child: a label too long for one line - Spanish "Iniciar
 * sesión con una clave de acceso" on a phone - wraps into balanced lines and
 * keeps its icon beside its first words. As two flex items, the words took
 * the whole width once they wrapped, and left the icon at the button's edge.
 * (The browser suite in packages/E2E/SignInOptions measures it.)
 */

const SPANISH_PASSKEY: string = "Iniciar sesión con una clave de acceso";

const classesOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(" ").filter((name: string) => {
    return name.length > 0;
  });
};

const renderOption: (title: string) => HTMLElement = (
  title: string,
): HTMLElement => {
  render(
    <button
      type="button"
      data-testid="option"
      className={getSignInOptionClassName("ready")}
    >
      <SignInOptionLabel
        icon={
          <Icon
            icon={IconProp.Fingerprint}
            className={SIGN_IN_OPTION_ICON_CLASS}
            data-testid="option-icon"
          />
        }
        title={title}
      />
    </button>,
  );

  return screen.getByTestId("option");
};

describe("SignInOptionLabel", () => {
  afterEach(() => {
    cleanup();
  });

  test("is the option's only child: the words, with their icon inside them", () => {
    const option: HTMLElement = renderOption("Sign in with a passkey");
    const words: HTMLElement = screen.getByText("Sign in with a passkey");

    expect(Array.from(option.children)).toEqual([words]);
    expect(words).toContainElement(screen.getByTestId("option-icon"));
  });

  test("the icon comes first, in a slot of its own before the words", () => {
    renderOption("Sign in with a passkey");
    const words: HTMLElement = screen.getByText("Sign in with a passkey");
    const slot: Element = words.firstElementChild as Element;

    expect(slot).toContainElement(screen.getByTestId("option-icon"));
    expect(words.childNodes).toHaveLength(2);
    expect(words.childNodes[1]!.nodeType).toBe(Node.TEXT_NODE);
    expect(words.childNodes[1]!.textContent).toBe("Sign in with a passkey");
  });

  test("the icon's slot sits in the line, before the words, and is hidden from assistive technology", () => {
    renderOption("Sign in with a passkey");
    const slot: Element = screen.getByText("Sign in with a passkey")
      .firstElementChild as Element;

    for (const name of classesOf(SIGN_IN_OPTION_ICON_SLOT_CLASS)) {
      expect(slot).toHaveClass(name);
    }
    expect(slot).toHaveClass("inline-block", "me-2");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("option-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("the option is named by its words alone", () => {
    const option: HTMLElement = renderOption("Sign in with a passkey");

    expect(option).toHaveAccessibleName("Sign in with a passkey");
    expect(option.textContent).toBe("Sign in with a passkey");
  });

  test("a long label balances its lines when it wraps, and may narrow to the button", () => {
    renderOption(SPANISH_PASSKEY);
    const words: HTMLElement = screen.getByText(SPANISH_PASSKEY);

    for (const name of classesOf(SIGN_IN_OPTION_LABEL_CLASS)) {
      expect(words).toHaveClass(name);
    }
    expect(words).toHaveClass("text-balance", "min-w-0", "break-words");
  });

  /*
   * The sign-in pages are laid out left to right in every language. A label
   * is laid out by its own first letter: a Persian one that ends in a Latin
   * word - "ورود با SSO" - was read starting from "SSO", and its icon leads
   * from the right.
   */
  test("lays its words, icon included, out by their own direction", () => {
    renderOption("ورود با کلید عبور");
    const words: HTMLElement = screen.getByText("ورود با کلید عبور");

    expect(words).toHaveAttribute("dir", "auto");
    expect(words).toContainElement(screen.getByTestId("option-icon"));
  });

  test("takes any icon: a logo drawn by the page itself", () => {
    render(
      <a href="/identity/microsoft/sign-in" data-testid="microsoft">
        <SignInOptionLabel
          icon={
            <svg
              aria-hidden="true"
              data-testid="logo"
              className={SIGN_IN_OPTION_ICON_CLASS}
            />
          }
          title="Sign in with Microsoft"
        />
      </a>,
    );

    const words: HTMLElement = screen.getByText("Sign in with Microsoft");

    expect(words.firstElementChild).toContainElement(
      screen.getByTestId("logo"),
    );
    expect(screen.getByTestId("microsoft")).toHaveAccessibleName(
      "Sign in with Microsoft",
    );
  });
});
