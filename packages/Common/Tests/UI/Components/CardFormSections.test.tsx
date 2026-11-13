import "@testing-library/jest-dom";
import { withProductText } from "../../../UI/Utils/ProductText";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import Card, {
  CARD_FORM_SECTION_FRAME_CLASS_NAME,
  CARD_FORM_SECTION_PADDING_CLASS_NAME,
  CARD_FRAME_CLASS_NAME,
  CARD_SECTION_CLASS_NAME,
  CARD_SECTION_TITLE_CLASS_NAME,
  CARD_TITLE_CLASS_NAME,
} from "../../../UI/Components/Card/Card";
import CardSections from "../../../UI/Components/Card/CardSections";
import CardFormSections, {
  CARD_FORM_SECTIONS_TEST_ID,
} from "../../../UI/Components/Card/CardFormSections";
import CardGrid from "../../../UI/Components/Card/CardGrid";
import {
  CardSurface,
  useCardSurface,
  useIsCardFormSection,
  useIsCardSection,
} from "../../../UI/Components/Card/CardSurface";
import Modal from "../../../UI/Components/Modal/Modal";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
} from "../../ResponsiveVisibility";
import { resolveMargin, resolvePadding } from "../../ResponsiveSpacing";
import { resolveFrame } from "../../ResponsiveFrame";
import { classesWithoutDarkTheme } from "../Styles/DarkThemeCoverage";

/*
 * A form's cards are the sections of the form they are in, at every width.
 *
 * Create Monitor's criteria step drew its Monitor Target, Test Monitor and
 * Monitor Criteria cards inside the page's card (and inside the edit
 * dialog): cards inside a card, which the maintainer asked to remove
 * everywhere. #5482 drew them as sections on phones, where each frame and
 * its padding came off the width of every field in them, and left them
 * cards from sm up.
 *
 * A card drawn in CardFormSections is a section of the card or dialog it is
 * in at every width - no frame but a rule above it, no side padding, no gap
 * under it, a section's title - the look a phone already had.
 *
 * jsdom has no stylesheet: these read the classes the way the cascade does
 * (ResponsiveFrame, ResponsiveSpacing).
 */

afterEach(() => {
  cleanup();
});

const SM_WIDTH_IN_PX: number = 640;
const LAPTOP_SMALL_WIDTH_IN_PX: number = 1024;

const EVERY_WIDTH: Array<number> = [
  320,
  PHONE_WIDTH_IN_PX,
  390,
  639,
  SM_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  LAPTOP_SMALL_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  1536,
];

interface DrawnCard {
  // The element that carries the gap under the card.
  box: HTMLElement;
  // The frame: border, corners, shadow.
  frame: HTMLElement;
  // The padding inside the frame.
  padding: HTMLElement;
  title: HTMLElement | null;
}

function drawnCard(card: HTMLElement): DrawnCard {
  const frame: HTMLElement = card.firstElementChild as HTMLElement;

  return {
    box: card,
    frame: frame,
    padding: frame.firstElementChild as HTMLElement,
    title: within(card).queryAllByTestId("card-details-heading")[0] || null,
  };
}

function cardTitled(title: string): DrawnCard {
  const heading: HTMLElement = screen
    .getAllByTestId("card-details-heading")
    .find((element: HTMLElement): boolean => {
      return element.textContent === title;
    })!;

  return drawnCard(heading.closest("[data-testid='card']") as HTMLElement);
}

function tokens(className: string): Array<string> {
  return className.split(/\s+/).filter(Boolean);
}

describe("a card in CardFormSections", () => {
  test("is marked as one, inside the element CardFormSections draws", () => {
    render(
      <CardFormSections className="mt-5 space-y-6">
        <Card title="Monitor Target">
          <p>body</p>
        </Card>
      </CardFormSections>,
    );

    const holder: HTMLElement = screen.getByTestId(CARD_FORM_SECTIONS_TEST_ID);
    const card: DrawnCard = cardTitled("Monitor Target");

    expect(holder).toHaveClass("mt-5", "space-y-6");
    expect(card.box.parentElement).toBe(holder);
    expect(card.box).toHaveAttribute("data-card-surface", "form-section");
  });

  test("has no frame but a rule above it, at every width: no sides, no corners, no shadow", () => {
    render(
      <CardFormSections>
        <Card title="Monitor Target" />
      </CardFormSections>,
    );

    const card: DrawnCard = cardTitled("Monitor Target");

    expect(card.frame).toHaveClass(
      ...tokens(CARD_FORM_SECTION_FRAME_CLASS_NAME),
    );

    for (const width of EVERY_WIDTH) {
      expect([width, resolveFrame(card.frame.className, width)]).toEqual([
        width,
        {
          border: { top: 1, right: 0, bottom: 0, left: 0 },
          radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          shadow: null,
        },
      ]);
    }
  });

  test("its rule is a section's: the one a card in CardSections has", () => {
    expect(tokens(CARD_FORM_SECTION_FRAME_CLASS_NAME)).toEqual(
      tokens(CARD_SECTION_CLASS_NAME),
    );
  });

  test("has no side padding and no gap under it at any width: the card or dialog around it pads it, what holds it spaces it", () => {
    render(
      <CardFormSections>
        <Card title="Monitor Target">
          <p>body</p>
        </Card>
      </CardFormSections>,
    );

    const card: DrawnCard = cardTitled("Monitor Target");

    expect(card.padding).toHaveClass(
      ...tokens(CARD_FORM_SECTION_PADDING_CLASS_NAME),
    );

    for (const width of EVERY_WIDTH) {
      // Its title as far under the rule as space-y-6 puts the rule under the card above.
      expect([width, resolvePadding(card.padding.className, width)]).toEqual([
        width,
        { top: 24, right: 0, bottom: 0, left: 0 },
      ]);
      expect([width, resolveMargin(card.box.className, width)]).toEqual([
        width,
        { top: 0, right: 0, bottom: 0, left: 0 },
      ]);
    }
  });

  test("its title is a section's at every width, a step below the title of the card it is in", () => {
    render(
      <CardFormSections>
        <Card title="Monitor Criteria" />
      </CardFormSections>,
    );

    const title: HTMLElement = cardTitled("Monitor Criteria").title!;

    // Its words are the product's own, readable in a recording of the setup pages (#6834).
    expect(title.className).toBe(
      withProductText(CARD_SECTION_TITLE_CLASS_NAME),
    );
    expect(title).toHaveClass("text-base", "leading-6");
    // No larger title from sm up: it was a card's there.
    expect(
      tokens(title.className).filter((token: string): boolean => {
        return token.includes(":");
      }),
    ).toEqual([]);
    expect(tokens(CARD_TITLE_CLASS_NAME)).toContain("text-lg");
  });

  test("with no header, its body starts as far under its rule as a title would", () => {
    render(
      <CardFormSections>
        <Card isHeaderHidden={true}>
          <p data-testid="headerless-body">body</p>
        </Card>
      </CardFormSections>,
    );

    const card: DrawnCard = drawnCard(screen.getByTestId("card"));

    for (const width of [PHONE_WIDTH_IN_PX, LAPTOP_WIDTH_IN_PX]) {
      expect([width, resolvePadding(card.padding.className, width)]).toEqual([
        width,
        { top: 24, right: 0, bottom: 0, left: 0 },
      ]);
    }
  });

  test("paints no ground of its own, and its rule keeps the dark theme", () => {
    expect(
      tokens(CARD_FORM_SECTION_FRAME_CLASS_NAME).filter(
        (token: string): boolean => {
          return token.startsWith("bg-") || token.includes(":");
        },
      ),
    ).toEqual([]);
    expect(
      classesWithoutDarkTheme(tokens(CARD_FORM_SECTION_FRAME_CLASS_NAME)),
    ).toEqual([]);
  });

  test("next to a card on a page, it is a card no longer from sm up: the frame a card has is gone", () => {
    render(
      <>
        <div data-testid="plain">
          <Card title="Daily limits">
            <p>body</p>
          </Card>
        </div>
        <CardFormSections dataTestId="in-form">
          <Card title="Monitor Target">
            <p>body</p>
          </Card>
        </CardFormSections>
      </>,
    );

    const plain: DrawnCard = drawnCard(
      within(screen.getByTestId("plain")).getByTestId("card"),
    );
    const inForm: DrawnCard = drawnCard(
      within(screen.getByTestId("in-form")).getByTestId("card"),
    );

    expect(plain.frame).toHaveClass(...tokens(CARD_FRAME_CLASS_NAME));

    for (const width of [SM_WIDTH_IN_PX, LAPTOP_WIDTH_IN_PX]) {
      expect(resolveFrame(plain.frame.className, width)).toEqual({
        border: { top: 1, right: 1, bottom: 1, left: 1 },
        radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
        shadow: "shadow-sm",
      });
      expect(resolveFrame(inForm.frame.className, width).border).toEqual({
        top: 1,
        right: 0,
        bottom: 0,
        left: 0,
      });
      expect(resolveMargin(plain.box.className, width).bottom).toBe(20);
      expect(resolveMargin(inForm.box.className, width).bottom).toBe(0);
    }
  });
});

describe("where a card is a section of a form, and where it is not", () => {
  test("outside CardFormSections a card is drawn exactly as before", () => {
    render(<Card title="Daily limits" />);

    const card: DrawnCard = cardTitled("Daily limits");

    expect(card.box).not.toHaveAttribute("data-card-surface");
    expect(card.box).toHaveClass("mb-5");
    expect(card.frame).toHaveClass(...tokens(CARD_FRAME_CLASS_NAME));
    expect(card.title).toHaveClass(...tokens(CARD_TITLE_CLASS_NAME));
  });

  test("the surface it gives is its own: not CardSections'", () => {
    const seen: Array<string> = [];

    const Probe: FunctionComponent = (): ReactElement => {
      seen.push(
        `${useCardSurface()} section=${useIsCardSection()} formSection=${useIsCardFormSection()}`,
      );
      return <></>;
    };

    render(
      <CardFormSections>
        <Probe />
      </CardFormSections>,
    );

    expect(seen).toEqual([
      `${CardSurface.FormSection} section=false formSection=true`,
    ]);
  });

  test("a card that fills a box keeps its frame: a CardGrid cell's, or fillHeight", () => {
    render(
      <CardFormSections>
        <Card title="Filled" fillHeight={true} />
        <CardGrid columns={2}>
          <Card title="In a row" />
          <Card title="Beside it" />
        </CardGrid>
      </CardFormSections>,
    );

    for (const title of ["Filled", "In a row", "Beside it"]) {
      const card: DrawnCard = cardTitled(title);

      expect([title, card.box.getAttribute("data-card-surface")]).toEqual([
        title,
        null,
      ]);
      expect(
        resolveFrame(card.frame.className, LAPTOP_WIDTH_IN_PX).border,
      ).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    }
  });

  test("in CardSections, a card is that card's section", () => {
    render(
      <CardFormSections>
        <CardSections>
          <Card title="A section" />
        </CardSections>
      </CardFormSections>,
    );

    expect(cardTitled("A section").box).toHaveAttribute(
      "data-card-surface",
      "section",
    );
  });

  test("a dialog opened from one starts a surface of its own: its cards are cards", () => {
    render(
      <CardFormSections>
        <Card title="Test Monitor">
          <Modal title="Test Monitor" onClose={() => {}}>
            <Card title="In the dialog" />
          </Modal>
        </Card>
      </CardFormSections>,
    );

    expect(cardTitled("Test Monitor").box).toHaveAttribute(
      "data-card-surface",
      "form-section",
    );

    const inDialog: DrawnCard = cardTitled("In the dialog");

    expect(inDialog.box).not.toHaveAttribute("data-card-surface");
    expect(inDialog.frame).toHaveClass(...tokens(CARD_FRAME_CLASS_NAME));
  });

  test("a card in one of its cards is a section of the form too, never a card in a card", () => {
    render(
      <CardFormSections>
        <Card title="Monitor Criteria">
          <Card title="Custom criteria" />
        </Card>
      </CardFormSections>,
    );

    expect(cardTitled("Custom criteria").box).toHaveAttribute(
      "data-card-surface",
      "form-section",
    );
  });
});
