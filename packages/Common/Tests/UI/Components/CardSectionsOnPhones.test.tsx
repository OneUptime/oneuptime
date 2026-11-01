import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import Card, {
  CARD_FRAME_CLASS_NAME,
  CARD_PADDING_CLASS_NAME,
  CARD_SECTION_ON_PHONES_FRAME_CLASS_NAME,
  CARD_SECTION_ON_PHONES_GAP_CLASS_NAME,
  CARD_SECTION_ON_PHONES_HEADERLESS_PADDING_CLASS_NAME,
  CARD_SECTION_ON_PHONES_PADDING_CLASS_NAME,
  CARD_SECTION_ON_PHONES_TITLE_CLASS_NAME,
  CARD_SECTION_TITLE_CLASS_NAME,
  CARD_TITLE_CLASS_NAME,
  CARD_HEADERLESS_PADDING_CLASS_NAME,
} from "../../../UI/Components/Card/Card";
import CardSections from "../../../UI/Components/Card/CardSections";
import CardSectionsOnPhones, {
  CARD_SECTIONS_ON_PHONES_TEST_ID,
} from "../../../UI/Components/Card/CardSectionsOnPhones";
import CardGrid from "../../../UI/Components/Card/CardGrid";
import {
  CardSurface,
  useCardSurface,
  useIsCardSection,
  useIsCardSectionOnPhones,
} from "../../../UI/Components/Card/CardSurface";
import Modal from "../../../UI/Components/Modal/Modal";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
} from "../../ResponsiveVisibility";
import { resolveMargin, resolvePadding } from "../../ResponsiveSpacing";
import { resolveFrame } from "../../ResponsiveFrame";
import {
  classesWithoutDarkTheme,
  isRemappedForDarkTheme,
} from "../Styles/DarkThemeCoverage";

/*
 * "The criteria editor on phones is still nested several boxes deep: a
 * redesign." Create Monitor's criteria step drew its Monitor Target, Test
 * Monitor and Monitor Criteria cards inside the page's card (and inside the
 * edit dialog): on a phone each frame and its padding came off the width of
 * every field in it.
 *
 * A card drawn in CardSectionsOnPhones is a section of the card or dialog
 * it is in below sm - no frame but a rule above it, no side padding, no gap
 * under it, a section's title - and from sm up the card it always was,
 * class for class.
 *
 * jsdom has no stylesheet: these read the classes the way the cascade does
 * (ResponsiveFrame, ResponsiveSpacing).
 */

afterEach(() => {
  cleanup();
});

const SM_WIDTH_IN_PX: number = 640;
const LAPTOP_SMALL_WIDTH_IN_PX: number = 1024;

const FROM_SM_UP: Array<number> = [
  SM_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  LAPTOP_SMALL_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
];

const PHONE_WIDTHS: Array<number> = [320, PHONE_WIDTH_IN_PX, 390, 639];

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

describe("a card in CardSectionsOnPhones, on a phone", () => {
  test("is marked as one, inside the element CardSectionsOnPhones draws", () => {
    render(
      <CardSectionsOnPhones className="mt-5 space-y-6">
        <Card title="Monitor Target">
          <p>body</p>
        </Card>
      </CardSectionsOnPhones>,
    );

    const holder: HTMLElement = screen.getByTestId(
      CARD_SECTIONS_ON_PHONES_TEST_ID,
    );
    const card: DrawnCard = cardTitled("Monitor Target");

    expect(holder).toHaveClass("mt-5", "space-y-6");
    expect(card.box.parentElement).toBe(holder);
    expect(card.box).toHaveAttribute("data-card-surface", "section-on-phones");
  });

  test("has no frame but a rule above it: no sides, no corners, no shadow", () => {
    render(
      <CardSectionsOnPhones>
        <Card title="Monitor Target" />
      </CardSectionsOnPhones>,
    );

    const card: DrawnCard = cardTitled("Monitor Target");

    expect(card.frame).toHaveClass(
      ...tokens(CARD_SECTION_ON_PHONES_FRAME_CLASS_NAME),
    );

    for (const width of PHONE_WIDTHS) {
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

  test("has no side padding and no gap under it: the card around it pads it, what holds it spaces it", () => {
    render(
      <CardSectionsOnPhones>
        <Card title="Monitor Target">
          <p>body</p>
        </Card>
      </CardSectionsOnPhones>,
    );

    const card: DrawnCard = cardTitled("Monitor Target");

    expect(card.padding).toHaveClass(
      ...tokens(CARD_SECTION_ON_PHONES_PADDING_CLASS_NAME),
    );

    for (const width of PHONE_WIDTHS) {
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

  test("its title is a section's, a step below the title of the card it is in", () => {
    render(
      <CardSectionsOnPhones>
        <Card title="Monitor Criteria" />
      </CardSectionsOnPhones>,
    );

    const title: HTMLElement = cardTitled("Monitor Criteria").title!;

    expect(title).toHaveClass(
      ...tokens(CARD_SECTION_ON_PHONES_TITLE_CLASS_NAME),
    );
    expect(title).toHaveClass(...tokens(CARD_SECTION_TITLE_CLASS_NAME));
    expect(title).toHaveClass("text-base");
  });

  test("a card with no header has no padding of its own on a phone either", () => {
    render(
      <CardSectionsOnPhones>
        <Card isHeaderHidden={true}>
          <p data-testid="headerless-body">body</p>
        </Card>
      </CardSectionsOnPhones>,
    );

    const card: DrawnCard = drawnCard(screen.getByTestId("card"));

    expect(card.padding).toHaveClass(
      ...tokens(CARD_SECTION_ON_PHONES_HEADERLESS_PADDING_CLASS_NAME),
    );
    expect(resolvePadding(card.padding.className, PHONE_WIDTH_IN_PX)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe("a card in CardSectionsOnPhones, from sm up, is the card it always was", () => {
  function renderBoth(props: { isHeaderHidden?: boolean }): {
    onPhones: DrawnCard;
    plain: DrawnCard;
  } {
    render(
      <>
        <div data-testid="plain">
          <Card
            title={props.isHeaderHidden ? undefined : "Daily limits"}
            isHeaderHidden={props.isHeaderHidden}
          >
            <p>body</p>
          </Card>
        </div>
        <CardSectionsOnPhones dataTestId="on-phones">
          <Card
            title={props.isHeaderHidden ? undefined : "Daily limits"}
            isHeaderHidden={props.isHeaderHidden}
          >
            <p>body</p>
          </Card>
        </CardSectionsOnPhones>
      </>,
    );

    return {
      plain: drawnCard(within(screen.getByTestId("plain")).getByTestId("card")),
      onPhones: drawnCard(
        within(screen.getByTestId("on-phones")).getByTestId("card"),
      ),
    };
  }

  test("frame for frame: the same borders, corners and shadow at sm, md, lg and xl", () => {
    const { plain, onPhones } = renderBoth({});

    expect(plain.frame).toHaveClass(...tokens(CARD_FRAME_CLASS_NAME));

    for (const width of FROM_SM_UP) {
      expect([width, resolveFrame(onPhones.frame.className, width)]).toEqual([
        width,
        resolveFrame(plain.frame.className, width),
      ]);
    }

    // And that frame is a card's: a border all round, 12px corners, a shadow.
    expect(resolveFrame(plain.frame.className, LAPTOP_WIDTH_IN_PX)).toEqual({
      border: { top: 1, right: 1, bottom: 1, left: 1 },
      radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
      shadow: "shadow-sm",
    });
  });

  test("the same padding and the same gap under it", () => {
    const { plain, onPhones } = renderBoth({});

    expect(plain.padding).toHaveClass(...tokens(CARD_PADDING_CLASS_NAME));

    for (const width of FROM_SM_UP) {
      expect([
        width,
        resolvePadding(onPhones.padding.className, width),
      ]).toEqual([width, resolvePadding(plain.padding.className, width)]);
      expect([width, resolveMargin(onPhones.box.className, width)]).toEqual([
        width,
        resolveMargin(plain.box.className, width),
      ]);
    }

    expect(resolveMargin(plain.box.className, LAPTOP_WIDTH_IN_PX).bottom).toBe(
      20,
    );
    expect(CARD_SECTION_ON_PHONES_GAP_CLASS_NAME).toBe("sm:mb-5");
  });

  test("a card with no header: the same padding from sm up", () => {
    const { plain, onPhones } = renderBoth({ isHeaderHidden: true });

    expect(plain.padding).toHaveClass(
      ...tokens(CARD_HEADERLESS_PADDING_CLASS_NAME),
    );

    for (const width of FROM_SM_UP) {
      expect([
        width,
        resolvePadding(onPhones.padding.className, width),
      ]).toEqual([width, resolvePadding(plain.padding.className, width)]);
    }
  });

  test("its title is a card's from sm up: the size and the 24px line of CARD_TITLE_CLASS_NAME", () => {
    /*
     * sm:text-lg alone would bring Tailwind's 28px line for text-lg with it,
     * which wins over leading-6 from sm up: the title would be 4px taller
     * than every other card's.
     */
    expect(tokens(CARD_TITLE_CLASS_NAME)).toEqual(
      expect.arrayContaining(["text-lg", "leading-6"]),
    );
    expect(tokens(CARD_SECTION_ON_PHONES_TITLE_CLASS_NAME)).toEqual(
      expect.arrayContaining(["text-base", "sm:text-lg", "sm:leading-6"]),
    );

    // Everything else about the title is the same at every width.
    const unchanged: Array<string> = tokens(CARD_TITLE_CLASS_NAME).filter(
      (token: string): boolean => {
        return token !== "text-lg";
      },
    );

    expect(tokens(CARD_SECTION_ON_PHONES_TITLE_CLASS_NAME)).toEqual(
      expect.arrayContaining(unchanged),
    );
  });

  test("its frame keeps the dark theme a card has at every width", () => {
    expect(
      classesWithoutDarkTheme(tokens(CARD_SECTION_ON_PHONES_FRAME_CLASS_NAME)),
    ).toEqual([]);
    // The ground is white at every width: sm:bg-white has no dark rule.
    expect(tokens(CARD_SECTION_ON_PHONES_FRAME_CLASS_NAME)).toContain(
      "bg-white",
    );
    // A shadow given from sm up only is a token Theme.css darkens too.
    expect(isRemappedForDarkTheme("sm:shadow-sm")).toBe(true);
  });
});

describe("where a card is a section on a phone, and where it is not", () => {
  test("outside CardSectionsOnPhones a card is drawn exactly as before", () => {
    render(<Card title="Daily limits" />);

    const card: DrawnCard = cardTitled("Daily limits");

    expect(card.box).not.toHaveAttribute("data-card-surface");
    expect(card.box).toHaveClass("mb-5");
    expect(card.frame).toHaveClass(...tokens(CARD_FRAME_CLASS_NAME));
    expect(card.title).toHaveClass(...tokens(CARD_TITLE_CLASS_NAME));
  });

  test("the surface it gives is its own: not a section's", () => {
    const seen: Array<string> = [];

    const Probe: FunctionComponent = (): ReactElement => {
      seen.push(
        `${useCardSurface()} section=${useIsCardSection()} onPhones=${useIsCardSectionOnPhones()}`,
      );
      return <></>;
    };

    render(
      <CardSectionsOnPhones>
        <Probe />
      </CardSectionsOnPhones>,
    );

    expect(seen).toEqual([
      `${CardSurface.SectionOnPhones} section=false onPhones=true`,
    ]);
  });

  test("a card that fills a box keeps its frame: a CardGrid cell's, or fillHeight", () => {
    render(
      <CardSectionsOnPhones>
        <Card title="Filled" fillHeight={true} />
        <CardGrid columns={2}>
          <Card title="In a row" />
          <Card title="Beside it" />
        </CardGrid>
      </CardSectionsOnPhones>,
    );

    for (const title of ["Filled", "In a row", "Beside it"]) {
      const card: DrawnCard = cardTitled(title);

      expect([title, card.box.getAttribute("data-card-surface")]).toEqual([
        title,
        null,
      ]);
      expect(
        resolveFrame(card.frame.className, PHONE_WIDTH_IN_PX).border,
      ).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    }
  });

  test("in CardSections, a card is a section at every width", () => {
    render(
      <CardSectionsOnPhones>
        <CardSections>
          <Card title="A section" />
        </CardSections>
      </CardSectionsOnPhones>,
    );

    expect(cardTitled("A section").box).toHaveAttribute(
      "data-card-surface",
      "section",
    );
  });

  test("a dialog opened from one starts a surface of its own: its cards are cards", () => {
    render(
      <CardSectionsOnPhones>
        <Card title="Test Monitor">
          <Modal title="Test Monitor" onClose={() => {}}>
            <Card title="In the dialog" />
          </Modal>
        </Card>
      </CardSectionsOnPhones>,
    );

    expect(cardTitled("Test Monitor").box).toHaveAttribute(
      "data-card-surface",
      "section-on-phones",
    );

    const inDialog: DrawnCard = cardTitled("In the dialog");

    expect(inDialog.box).not.toHaveAttribute("data-card-surface");
    expect(inDialog.frame).toHaveClass(...tokens(CARD_FRAME_CLASS_NAME));
  });

  test("a card in one of its cards is a section on a phone too, as a card in a CardSections section is a section", () => {
    render(
      <CardSectionsOnPhones>
        <Card title="Monitor Criteria">
          <Card title="Custom criteria" />
        </Card>
      </CardSectionsOnPhones>,
    );

    expect(cardTitled("Custom criteria").box).toHaveAttribute(
      "data-card-surface",
      "section-on-phones",
    );
  });
});
