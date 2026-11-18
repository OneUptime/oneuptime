import ExplainedPill from "../../../UI/Components/Pill/ExplainedPill";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

/*
 * AN EXPLAINED PILL WHOSE REASON A PAGE WORDED ITSELF (#9511).
 *
 * The Users list's Email Not Sent explains itself in OneUptime's words,
 * then the mail service's answer as it said it, then what to do: words the
 * page has already put in the reader's language around words nobody may
 * translate. So the pill takes its explanation as given (never looked up
 * again), draws it in the tooltip as the page laid it out - the mail
 * service's words set apart - while a screen reader still hears the same
 * text as the button's description, and names its tone as a status chip
 * does.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        // A lookup that shows it happened.
        translateString: (value: string | undefined): string | undefined => {
          return value === undefined ? value : `[looked up] ${value}`;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
        language: "en",
      };
    },
  };
});

jest.setTimeout(30000);

const REASON: string =
  "Their invitation email was not sent. 535 5.7.8 Authentication failed";

async function tooltipsShown(): Promise<Array<HTMLElement>> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });

  return screen.queryAllByRole("tooltip");
}

afterEach(() => {
  cleanup();
});

describe("an explained pill a page words itself", () => {
  test("an explanation in the reader's words is drawn as given, never looked up again", () => {
    render(
      <ExplainedPill
        text="Email Not Sent"
        explanation={REASON}
        isExplanationTranslated={true}
        tone={PillTone.Danger}
        dataTestId="explained"
      />,
    );

    expect(screen.getByTestId("explained")).toHaveAccessibleDescription(REASON);
  });

  test("an English explanation is still looked up, as before", () => {
    render(
      <ExplainedPill
        text="Adds nothing"
        explanation="This rule adds nothing when it matches."
        tone={PillTone.Warning}
        dataTestId="explained"
      />,
    );

    expect(screen.getByTestId("explained")).toHaveAccessibleDescription(
      "[looked up] This rule adds nothing when it matches.",
    );
  });

  test("names its tone as a status chip does", () => {
    render(
      <ExplainedPill
        text="Email Not Sent"
        explanation={REASON}
        isExplanationTranslated={true}
        tone={PillTone.Danger}
        dataTestId="explained"
      />,
    );

    expect(
      screen
        .getByTestId("explained")
        .querySelector('[data-testid="pill"]')
        ?.getAttribute("data-tone"),
    ).toBe(PillTone.Danger);
  });

  test("pressed, its tooltip draws the page's own layout, and the screen reader hears the text", async () => {
    render(
      <ExplainedPill
        text="Email Not Sent"
        explanation={REASON}
        isExplanationTranslated={true}
        explanationContent={
          <div>
            <p>Their invitation email was not sent.</p>
            <p dir="auto" data-testid="as-said">
              535 5.7.8 Authentication failed
            </p>
          </div>
        }
        tone={PillTone.Danger}
        dataTestId="explained"
      />,
    );

    const pill: HTMLElement = screen.getByTestId("explained");

    fireEvent.mouseEnter(pill);
    fireEvent.click(pill);

    // A rich tooltip opens after a short delay.
    await screen.findByTestId("as-said");

    const shown: Array<HTMLElement> = await tooltipsShown();

    expect(shown).toHaveLength(1);
    expect(screen.getByTestId("as-said")).toHaveAttribute("dir", "auto");
    expect(shown[0]).toHaveTextContent("535 5.7.8 Authentication failed");
    // Read once, from the node that is always there.
    expect(pill).toHaveAccessibleDescription(REASON);
  });
});
