import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import Route from "../../../Types/API/Route";
import Link from "../../../UI/Components/Link/Link";

/*
 * Link's optional dataTestId lands on whatever Link draws - a link, a
 * script-only control or plain text - and nothing is added without one.
 */
describe("Link dataTestId", () => {
  afterEach(() => {
    cleanup();
  });

  test("a link with a destination carries it", () => {
    render(
      <Link to={new Route("/accounts/sso")} dataTestId="sso-login">
        Sign in with SSO
      </Link>,
    );

    const link: HTMLElement = screen.getByTestId("sso-login");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/accounts/sso");
  });

  test("a control with only an action carries it", () => {
    render(
      <Link onClick={() => {}} dataTestId="action">
        Do it
      </Link>,
    );

    expect(screen.getByTestId("action")).toHaveAttribute("role", "button");
  });

  test("plain text carries it", () => {
    render(<Link dataTestId="text">Just text</Link>);

    expect(screen.getByTestId("text").tagName).toBe("SPAN");
  });

  test("nothing is added without one", () => {
    const { container } = render(
      <Link to={new Route("/accounts/login")}>Sign in</Link>,
    );

    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});
