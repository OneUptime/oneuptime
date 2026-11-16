/*
 * What a status page's subscribe pages say once the form has done its job
 * (#9027): subscribed, a link sent to confirm or to manage a subscription,
 * changes saved. It was one centred gray-400 sentence - 2.5:1 on the page,
 * with no icon and no heading - so the only sign the subscription worked
 * looked like disabled text.
 *
 * The panel is drawn here as each page draws it, and its words are held to
 * WCAG AA's 4.5:1 in both themes. The pages' wiring (which panel says what)
 * is held by App's SubscribeManageLinkCopyWiring, and the real Email page
 * shows it after Subscribe in StatusPageSubscribeOnePage.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import SubscribeConfirmation, {
  SUBSCRIBE_CONFIRMATION_MESSAGE_CLASS_NAME,
  SUBSCRIBE_CONFIRMATION_TEST_ID,
  SUBSCRIBE_CONFIRMATION_TITLE_CLASS_NAME,
  SubscribeConfirmationTone,
} from "../../../../App/FeatureSet/StatusPage/src/Components/Subscribe/SubscribeConfirmation";
import {
  DARK_SURFACES,
  LIGHT_SURFACES,
  TOO_LIGHT_GRAY_TEXT,
  WCAG_AA_TEXT,
  darkContrastOf,
  lightContrastOf,
  shadeOf,
} from "../../UI/GrayTextContrast";

afterEach(() => {
  cleanup();
});

const EMAIL_SENT: string =
  "We have sent an email to this address. Open the link in it to confirm your subscription. If you don't see it, check your spam folder.";

describe("the panel, drawn", () => {
  test("a next step: its heading says what to do, and a screen reader hears it as a status", () => {
    render(
      <SubscribeConfirmation
        title="Check your email"
        message={EMAIL_SENT}
        icon={IconProp.Email}
        tone={SubscribeConfirmationTone.NextStep}
      />,
    );

    const panel: HTMLElement = screen.getByRole("status");

    expect(panel).toHaveAttribute(
      "data-testid",
      SUBSCRIBE_CONFIRMATION_TEST_ID,
    );
    expect(panel).toHaveAttribute("data-tone", "next-step");
    expect(
      within(panel).getByRole("heading", { name: "Check your email" }),
    ).toHaveClass(...SUBSCRIBE_CONFIRMATION_TITLE_CLASS_NAME.split(" "));
    expect(within(panel).getByText(EMAIL_SENT)).toHaveClass(
      ...SUBSCRIBE_CONFIRMATION_MESSAGE_CLASS_NAME.split(" "),
    );
    // Its icon is decoration: the heading and the sentence say it all.
    expect(panel.querySelector("svg")).not.toBeNull();
    expect(panel.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // A card on the page, not words floating in 80px of nothing.
    expect(panel).toHaveClass("bg-white", "rounded-xl", "shadow");
    expect(panel.innerHTML).not.toMatch(TOO_LIGHT_GRAY_TEXT);
  });

  test("done: no heading to repeat the sentence, a green tick, the sentence alone", () => {
    render(
      <SubscribeConfirmation
        message="You have been subscribed successfully."
        icon={IconProp.CheckCircle}
        tone={SubscribeConfirmationTone.Done}
      />,
    );

    const panel: HTMLElement = screen.getByRole("status");

    expect(panel).toHaveAttribute("data-tone", "done");
    expect(within(panel).queryByRole("heading")).toBeNull();
    expect(
      within(panel).getByText("You have been subscribed successfully."),
    ).toBeVisible();
    expect(panel.innerHTML).toContain("text-green-600");
  });

  test("words in the reader's language are drawn as given", () => {
    render(
      <SubscribeConfirmation
        title="Prüfen Sie Ihre E-Mails"
        message="Wir haben eine E-Mail an diese Adresse gesendet."
        icon={IconProp.Email}
        tone={SubscribeConfirmationTone.NextStep}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Prüfen Sie Ihre E-Mails" }),
    ).toBeVisible();
    expect(
      screen.getByText("Wir haben eine E-Mail an diese Adresse gesendet."),
    ).toBeVisible();
  });
});

const WORDS: Array<[string, string]> = [
  ["its heading", SUBSCRIBE_CONFIRMATION_TITLE_CLASS_NAME],
  ["its sentence", SUBSCRIBE_CONFIRMATION_MESSAGE_CLASS_NAME],
];

describe.each(WORDS)(
  "%s reads: WCAG AA in both themes",
  (_name: string, className: string) => {
    const shade: string = shadeOf(className, "text-gray-");

    test.each(LIGHT_SURFACES)(
      "at least 4.5:1 on %s",
      (_surface: string, surface: string) => {
        expect(lightContrastOf(shade, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      },
    );

    test.each(DARK_SURFACES)(
      "at least 4.5:1 on %s in the dark theme",
      (_surface: string, surface: string) => {
        expect(darkContrastOf(shade, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      },
    );

    test("never gray-400 or lighter, what the old sentence was", () => {
      expect(className).not.toMatch(TOO_LIGHT_GRAY_TEXT);
    });
  },
);
