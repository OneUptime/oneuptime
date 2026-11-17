import EnabledPill from "../../../UI/Components/Pill/EnabledPill";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";

/*
 * A rule someone switched off is a choice, not a fault (#9184): Disabled is
 * the grey Paused tone with a hollow dot, never red.
 */
describe("<EnabledPill />", () => {
  test("an enabled rule is a green Enabled", () => {
    render(<EnabledPill isEnabled={true} />);

    expect(screen.getByTestId("pill")).toHaveAttribute("data-tone", "success");
    expect(screen.getByTestId("pill-text")).toHaveTextContent("Enabled");
  });

  test.each([false, undefined, null])(
    "a rule that is not enabled (%s) is a grey Disabled with a hollow dot",
    (isEnabled: boolean | undefined | null) => {
      render(<EnabledPill isEnabled={isEnabled} />);

      expect(screen.getByTestId("pill")).toHaveAttribute("data-tone", "paused");
      expect(screen.getByTestId("pill-text")).toHaveTextContent("Disabled");
      expect(screen.getByTestId("pill-dot")).toHaveAttribute(
        "data-hollow",
        "true",
      );
    },
  );

  test("takes a test id and a class for where it sits", () => {
    render(
      <EnabledPill isEnabled={true} dataTestId="rule-on" className="ml-2" />,
    );

    expect(screen.getByTestId("rule-on")).toHaveClass("ml-2");
  });
});
