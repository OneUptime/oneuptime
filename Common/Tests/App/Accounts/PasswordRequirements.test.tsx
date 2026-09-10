import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import french from "../../../../App/FeatureSet/Accounts/src/Locales/fr.json";
import PasswordRequirements from "../../../../App/FeatureSet/Accounts/src/Components/PasswordRequirements/PasswordRequirements";

const VALID_PASSWORD: string = "violet river lantern";

function renderRequirements(password: string, error?: string): void {
  render(
    <PasswordRequirements
      id="requirements"
      password={password}
      error={error}
    />,
  );
}

describe("Password requirements progress", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  test.each([
    ["", 0],
    ["r", 1],
    ["river", 5],
    ["🌲river lantern", 14],
    ["🌲 river lantern", 15],
    [VALID_PASSWORD, 20],
    ["violet river lantern".repeat(5), 100],
    ["violet river lantern".repeat(5) + "!", 101],
  ])(
    "shows Unicode character progress for %p",
    (password: string, length: number) => {
      renderRequirements(password);
      const progress: HTMLElement = screen.getByRole("progressbar", {
        name: "Password length",
      });
      expect(progress).toHaveAttribute("aria-valuemin", "0");
      expect(progress).toHaveAttribute("aria-valuemax", "15");
      expect(progress).toHaveAttribute(
        "aria-valuenow",
        String(Math.min(length, 15)),
      );
      expect(progress).toHaveAttribute(
        "aria-valuetext",
        `${length} / 15 characters minimum`,
      );
      expect(
        screen.getByText(`${length} / 15 characters minimum`),
      ).toBeVisible();
      expect(progress.firstElementChild).toHaveStyle({
        width: `${(Math.min(length, 15) / 15) * 100}%`,
      });
    },
  );

  test("shows requirements before typing with a polite accessible status", () => {
    renderRequirements("");
    const status: HTMLElement = screen.getByRole("status");
    expect(status).toHaveAttribute("id", "requirements");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    const checklist: HTMLElement = screen.getByRole("list");
    const items: Array<HTMLElement> =
      within(checklist).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(
      "Incomplete: Between 15 and 100 characters",
    );
    expect(items[1]).toHaveTextContent(
      "Incomplete: Avoid common or repeated patterns",
    );
    expect(items[2]).toHaveTextContent(
      "Special characters are optional. Try !, @, # or $.",
    );
    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
  });

  test("translates progress and preserves spoken completion states containing colons", async () => {
    await i18n.changeLanguage("fr");
    renderRequirements("river!");
    const progress: HTMLElement = screen.getByRole("progressbar", {
      name: french["Password length"],
    });
    expect(progress).toHaveAttribute("aria-valuenow", "6");
    expect(progress).toHaveAttribute(
      "aria-valuetext",
      french["{{length}} / {{minimum}} characters minimum"]
        .replace("{{length}}", "6")
        .replace("{{minimum}}", "15"),
    );
    const items: Array<HTMLElement> = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(french["Incomplete:"]);
    expect(items[1]).toHaveTextContent(french["Complete:"]);
    expect(items[2]).toHaveTextContent(
      french["Special character included (optional)"],
    );
  });

  test("updates each check independently and reverses progress when edited", () => {
    const { rerender } = render(
      <PasswordRequirements id="requirements" password="river" />,
    );
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Incomplete:");
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Complete:");

    rerender(
      <PasswordRequirements id="requirements" password="PasswordPassword" />,
    );
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Complete:");
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Incomplete:");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Password meets requirements",
    );
    expect(screen.getByRole("progressbar").firstElementChild).toHaveClass(
      "bg-amber-500",
    );

    rerender(
      <PasswordRequirements id="requirements" password={VALID_PASSWORD} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password meets requirements",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Complete:");
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Complete:");

    rerender(<PasswordRequirements id="requirements" password="r" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Password meets requirements",
    );
    rerender(<PasswordRequirements id="requirements" password="" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Incomplete:");
  });

  test.each(["!", "@", "#", "$", "_", "-", "£", "＋", "。", "🔒"])(
    "recognizes the optional special character %s without displaying the password",
    (symbol: string) => {
      const password: string = VALID_PASSWORD + symbol;
      renderRequirements(password);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Special character included (optional)",
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "Password meets requirements",
      );
      expect(screen.getByRole("status")).not.toHaveTextContent(password);
    },
  );

  test.each([
    VALID_PASSWORD,
    "café rivière forêt",
    "雨の中で踊る小さな青い鳥たちの歌",
  ])(
    "keeps a valid passphrase without special characters complete (%p)",
    (password: string) => {
      renderRequirements(password);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Password meets requirements",
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "Special characters are optional.",
      );
      expect(screen.getByRole("status")).not.toHaveTextContent(
        "Special character included",
      );
    },
  );

  test("removes the special-character check when the character is deleted", () => {
    const { rerender } = render(
      <PasswordRequirements
        id="requirements"
        password={VALID_PASSWORD + "!"}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Special character included",
    );
    rerender(
      <PasswordRequirements id="requirements" password={VALID_PASSWORD} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Special characters are optional.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password meets requirements",
    );
  });

  test.each([
    " ".repeat(15),
    "!".repeat(15),
    "Password123456789!",
    "abcabcabcabcabc",
    "123456789012345",
  ])(
    "does not imply completion for predictable or blank full-length input (%p)",
    (password: string) => {
      renderRequirements(password);
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "15",
      );
      expect(screen.getAllByRole("listitem")[1]).toHaveTextContent(
        "Incomplete:",
      );
      expect(screen.getByRole("status")).not.toHaveTextContent(
        "Password meets requirements",
      );
    },
  );

  test("clears length completion and explains exceeding the maximum", () => {
    renderRequirements(VALID_PASSWORD.repeat(5) + "!");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Incomplete:");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password cannot be more than 100 characters.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Password meets requirements",
    );
  });

  test("retains progress alongside a single external validation error", () => {
    renderRequirements(VALID_PASSWORD, "Password cannot be used.");
    expect(screen.getAllByText("Password cannot be used.")).toHaveLength(1);
    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "Password cannot be used.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "15",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Password meets requirements",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
