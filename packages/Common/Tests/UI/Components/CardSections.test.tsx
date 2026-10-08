import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
  CARD_FRAME_CLASS_NAME,
  CARD_HEADER_ACTIONS_CLASS_NAME,
  CARD_PADDING_CLASS_NAME,
  CARD_SECTION_CLASS_NAME,
  CARD_SECTION_TITLE_CLASS_NAME,
  CARD_TITLE_CLASS_NAME,
} from "../../../UI/Components/Card/Card";
import CardSections, {
  CARD_SECTIONS_TEST_ID,
} from "../../../UI/Components/Card/CardSections";
import {
  CARD_RULED_BODY_CLASS_NAME,
  CARD_SECTION_RULED_BODY_CLASS_NAME,
  CardSurface,
  CardSurfaceContext,
  getCardRuledBodyClassName,
  useCardRuledBodyClassName,
  useCardSurface,
  useIsCardSection,
} from "../../../UI/Components/Card/CardSurface";
import Modal from "../../../UI/Components/Modal/Modal";
import SideOver from "../../../UI/Components/SideOver/SideOver";
import IconProp from "../../../Types/Icon/IconProp";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";
import { resolveMargin, resolvePadding } from "../../ResponsiveSpacing";

/*
 * "If you look at More Settings, it looks like a card inside of a card. Can
 * you please fix that UI? More Settings should look like one card instead of
 * a card inside of a card, and it should have dividers." - the maintainer.
 *
 * A card drawn inside CardSections is a section of the card that holds it:
 * it keeps everything a card says and offers - its title, description, the
 * actions at its right edge, its body - and draws no frame of its own: no
 * border, no rounded corners, no shadow, no gap under it. A divider across
 * the whole card sits above each section. A card anywhere else is drawn
 * exactly as before, and a dialog or a side panel opened from a section
 * starts a surface of its own.
 *
 * jsdom has no stylesheet: these read the classes the way the cascade does
 * (ResponsiveSpacing, ResponsiveVisibility).
 */

afterEach(() => {
  cleanup();
});

const WIDTHS: Array<number> = [
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
];

// What draws a box: a card's frame, or any copy of it.
const FRAME_TOKENS: ReadonlyArray<string> = [
  "rounded",
  "rounded-md",
  "rounded-lg",
  "rounded-xl",
  "rounded-2xl",
  "shadow",
  "shadow-sm",
  "shadow-md",
  "shadow-lg",
];

function tokensOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

function cards(): Array<HTMLElement> {
  return screen.getAllByTestId("card");
}

// Every element in the card, the card itself too, that draws part of a box.
function framedElementsIn(root: HTMLElement): Array<string> {
  return [root, ...Array.from(root.querySelectorAll("*"))]
    .filter((element: Element): boolean => {
      return tokensOf(element).some((token: string): boolean => {
        return FRAME_TOKENS.includes(token);
      });
    })
    .map((element: Element): string => {
      return `${element.tagName.toLowerCase()}.${tokensOf(element).join(".")}`;
    });
}

function renderSections(children: ReactElement | Array<ReactElement>): void {
  render(<CardSections>{children}</CardSections>);
}

describe("a card on a page", () => {
  test("keeps its frame: a border, rounded corners, a shadow, and a gap under it", () => {
    render(
      <Card title="Daily limits" description="How much AI may run.">
        <div>body</div>
      </Card>,
    );

    const card: HTMLElement = cards()[0]!;

    expect(card).toHaveClass("mb-5");
    expect(card).not.toHaveAttribute("data-card-surface");
    expect(card.firstElementChild).toHaveClass(
      ...CARD_FRAME_CLASS_NAME.split(" "),
    );
    expect(card.firstElementChild!.firstElementChild).toHaveClass(
      ...CARD_PADDING_CLASS_NAME.split(" "),
    );
  });

  test("its frame is the one every card in the product drew before", () => {
    expect(CARD_FRAME_CLASS_NAME).toBe(
      "bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible",
    );
    expect(CARD_PADDING_CLASS_NAME).toBe("py-6 px-5 md:px-6");
    expect(CARD_TITLE_CLASS_NAME).toBe(
      "text-lg font-semibold leading-6 text-gray-900 text-balance break-words",
    );
  });

  test("its title is a card's title", () => {
    render(<Card title="Daily limits" />);

    expect(screen.getByTestId("card-details-heading")).toHaveClass(
      ...CARD_TITLE_CLASS_NAME.split(" "),
    );
  });

  test("outside CardSections, the surface is the page", () => {
    const seen: Array<CardSurface> = [];

    const Probe: FunctionComponent = (): ReactElement => {
      seen.push(useCardSurface());
      return <></>;
    };

    render(<Probe />);

    expect(seen).toEqual([CardSurface.Page]);
  });
});

describe("a card in CardSections is a section of the card that holds it", () => {
  test("it has no frame of its own: no border box, no rounded corners, no shadow, no gap", () => {
    renderSections(
      <Card title="Daily limits" description="How much AI may run.">
        <div data-testid="body">body</div>
      </Card>,
    );

    const card: HTMLElement = cards()[0]!;

    expect(card).toHaveAttribute("data-card-surface", "section");
    expect(card).not.toHaveClass("mb-5");
    expect(card).not.toHaveClass("bg-white");
    expect(card).not.toHaveClass("border");
    // Nothing between the section's edge and its content draws a box.
    expect(framedElementsIn(card)).toEqual([]);
  });

  test("a divider across the whole card sits above it", () => {
    renderSections(<Card title="Daily limits" />);

    const card: HTMLElement = cards()[0]!;

    expect(card).toHaveClass(...CARD_SECTION_CLASS_NAME.split(" "));
    expect(CARD_SECTION_CLASS_NAME).toBe("border-t border-gray-200");

    // Edge to edge: nothing pulls the divider in from the card's sides.
    for (const width of WIDTHS) {
      expect([width, resolveMargin(card.className, width)]).toEqual([
        width,
        { top: 0, right: 0, bottom: 0, left: 0 },
      ]);
      expect([width, resolvePadding(card.className, width)]).toEqual([
        width,
        { top: 0, right: 0, bottom: 0, left: 0 },
      ]);
    }
  });

  test("every section has a divider of its own, in order, one after the other", () => {
    renderSections([
      <Card key="a" title="Investigation rules" />,
      <Card key="b" title="Which incidents are investigated" />,
      <Card key="c" title="Daily limits" />,
    ]);

    const sections: Array<HTMLElement> = cards();

    expect(
      sections.map((section: HTMLElement): string => {
        return within(section).getByTestId("card-details-heading")
          .textContent as string;
      }),
    ).toEqual([
      "Investigation rules",
      "Which incidents are investigated",
      "Daily limits",
    ]);

    for (const section of sections) {
      expect(section).toHaveAttribute("data-card-surface", "section");
      expect(section).toHaveClass("border-t", "border-gray-200");
      expect(section.parentElement).toBe(
        screen.getByTestId(CARD_SECTIONS_TEST_ID),
      );
    }
  });

  test("it pads itself as a card does, so what runs to a card's edges runs to the section's", () => {
    renderSections(
      <Card title="Daily limits">
        <div data-testid="body">body</div>
      </Card>,
    );

    const padding: HTMLElement = cards()[0]!.firstElementChild as HTMLElement;

    expect(padding).toHaveClass(...CARD_PADDING_CLASS_NAME.split(" "));

    for (const width of WIDTHS) {
      const side: number = width >= 768 ? 24 : 20;

      expect([width, resolvePadding(padding.className, width)]).toEqual([
        width,
        { top: 24, right: side, bottom: 24, left: side },
      ]);
    }
  });

  test("its title is a step below a page card's: one card's sections, not cards", () => {
    renderSections(<Card title="Daily limits" />);

    const title: HTMLElement = screen.getByTestId("card-details-heading");

    expect(title.tagName).toBe("H2");
    expect(title).toHaveClass(...CARD_SECTION_TITLE_CLASS_NAME.split(" "));
    expect(title).toHaveClass("text-base", "font-semibold", "text-gray-900");
    expect(title).not.toHaveClass("text-lg");
  });

  test("it keeps its description, hidden on a phone as a card's is", () => {
    renderSections(
      <Card title="Daily limits" description="How much AI may run each day." />,
    );

    const description: HTMLElement = screen.getByTestId("card-description");

    expect(description).toHaveTextContent("How much AI may run each day.");
    expect(isVisibleAtWidth(description, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(description, LAPTOP_WIDTH_IN_PX)).toBe(true);
  });

  test("it keeps its actions at its right edge, and they still work", () => {
    const onEdit: MockFunction = getJestMockFunction();

    renderSections(
      <Card
        title="Daily limits"
        buttons={[
          {
            title: "Edit",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            onClick: onEdit,
          },
        ]}
        rightElement={<span data-testid="plan-pill">Scale</span>}
      />,
    );

    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    expect(actions).toHaveClass(...CARD_HEADER_ACTIONS_CLASS_NAME.split(" "));
    expect(actions).toHaveClass("ml-auto", "justify-end");
    expect(within(actions).getByTestId("plan-pill")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-button"));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("the stacked header lays out as it does on a page", () => {
    renderSections(
      <Card
        title="Affected Resources"
        description="What this incident touches."
        headerLayout="stacked"
        rightElement={<span>Edit</span>}
      />,
    );

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
    expect(screen.getByTestId("card-header-title-row")).toContainElement(
      screen.getByTestId("card-header-actions"),
    );
    expect(
      screen.getByTestId("card-header-title-row").nextElementSibling,
    ).toBe(screen.getByTestId("card-description"));
  });

  test("it keeps its body, the body's spacing and the page's class names", () => {
    renderSections([
      <Card key="a" title="One" className="page-class">
        <div data-testid="body-a">body</div>
      </Card>,
      <Card key="b" title="Two" bodyClassName="mt-6">
        <div data-testid="body-b">body</div>
      </Card>,
    ]);

    expect(screen.getByTestId("body-a").parentElement).toHaveClass("mt-4");
    expect(screen.getByTestId("body-b").parentElement).toHaveClass("mt-6");
    expect(cards()[0]).toHaveClass("page-class", "border-t");
  });

  test("it keeps the test ids the rest of the product's tests read", () => {
    renderSections(
      <Card
        title="Daily limits"
        description="How much AI may run."
        buttons={[
          {
            title: "Edit",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            onClick: (): void => {},
          },
        ]}
      />,
    );

    for (const testId of [
      "card",
      "card-header",
      "card-header-title-block",
      "card-details-heading",
      "card-description",
      "card-header-actions",
      "card-button",
    ]) {
      expect([testId, screen.queryAllByTestId(testId).length]).toEqual([
        testId,
        1,
      ]);
    }
  });

  test("what is not a card is drawn as it is: no divider, no padding added", () => {
    renderSections(<p data-testid="note">A note</p>);

    const note: HTMLElement = screen.getByTestId("note");

    expect(note.parentElement).toBe(screen.getByTestId(CARD_SECTIONS_TEST_ID));
    expect(note).not.toHaveClass("border-t");
  });
});

describe("CardSections", () => {
  test("draws no frame and no padding of its own: the card that holds it does", () => {
    renderSections(<Card title="Daily limits" />);

    const sections: HTMLElement = screen.getByTestId(CARD_SECTIONS_TEST_ID);

    expect(sections.getAttribute("class")).toBeNull();
    expect(framedElementsIn(sections)).toEqual([]);
  });

  test("takes a test id of its own", () => {
    render(
      <CardSections dataTestId="more-settings-sections">
        <Card title="Daily limits" />
      </CardSections>,
    );

    expect(screen.getByTestId("more-settings-sections")).toBeInTheDocument();
    expect(screen.queryByTestId(CARD_SECTIONS_TEST_ID)).toBeNull();
  });

  test("tells what is drawn in it that it is a section, however deep", () => {
    const seen: Array<[CardSurface, boolean]> = [];

    const Probe: FunctionComponent = (): ReactElement => {
      seen.push([useCardSurface(), useIsCardSection()]);
      return <></>;
    };

    renderSections(
      <div>
        <div>
          <Probe />
        </div>
      </div>,
    );

    expect(seen).toEqual([[CardSurface.Section, true]]);
  });
});

/*
 * A dialog or a side panel opened from a section - a card's Edit, a table's
 * Create - is a surface of its own, not a part of the card behind it: a card
 * in it is a card, framed.
 */
describe("surfaces of their own", () => {
  test("a dialog opened from a section draws a card in it as a card", () => {
    renderSections(
      <Modal title="Edit daily limits" onClose={(): void => {}}>
        <Card title="Inside the dialog" />
      </Modal>,
    );

    const card: HTMLElement = within(screen.getByTestId("modal")).getByTestId(
      "card",
    );

    expect(card).not.toHaveAttribute("data-card-surface");
    expect(card).toHaveClass("mb-5");
    expect(card.firstElementChild).toHaveClass("rounded-xl", "shadow-sm");
  });

  test("so does a side panel", () => {
    renderSections(
      <SideOver
        title="Investigate window"
        description="10:00 - 10:30"
        onClose={(): void => {}}
      >
        <Card title="Findings" />
      </SideOver>,
    );

    const card: HTMLElement = screen.getByTestId("card");

    expect(card).not.toHaveAttribute("data-card-surface");
    expect(card.firstElementChild).toHaveClass("rounded-xl", "shadow-sm");
  });

  test("the section around the dialog stays a section", () => {
    renderSections(
      <Card title="Daily limits">
        <Modal title="Edit daily limits" onClose={(): void => {}}>
          <p>form</p>
        </Modal>
      </Card>,
    );

    expect(cards()[0]).toHaveAttribute("data-card-surface", "section");
  });

  test("a surface can be set by hand, and the innermost one wins", () => {
    const seen: Array<CardSurface> = [];

    const Probe: FunctionComponent = (): ReactElement => {
      seen.push(useCardSurface());
      return <></>;
    };

    render(
      <CardSurfaceContext.Provider value={CardSurface.Section}>
        <CardSurfaceContext.Provider value={CardSurface.Page}>
          <Probe />
        </CardSurfaceContext.Provider>
      </CardSurfaceContext.Provider>,
    );

    expect(seen).toEqual([CardSurface.Page]);
  });
});

/*
 * A card's body drawn edge to edge under a rule across the card - a switch
 * row, a list of choices. In a section that rule would read as the divider
 * of a section without a title, so it goes; the body still runs from edge
 * to edge.
 */
describe("a card's edge-to-edge body", () => {
  test("on a page it is ruled off from the header and runs into the card's bottom padding", () => {
    expect(getCardRuledBodyClassName(CardSurface.Page)).toBe(
      CARD_RULED_BODY_CLASS_NAME,
    );
    expect(CARD_RULED_BODY_CLASS_NAME).toBe(
      "-mx-5 -mb-6 border-t border-gray-200 md:-mx-6",
    );
  });

  test("in a section it has no rule of its own", () => {
    const className: string = getCardRuledBodyClassName(CardSurface.Section);

    expect(className).toBe(CARD_SECTION_RULED_BODY_CLASS_NAME);
    expect(className.split(" ")).not.toContain("border-t");
    expect(className).not.toContain("border-gray");
  });

  test("on both it runs from the card's left edge to its right edge, at every width", () => {
    for (const surface of [CardSurface.Page, CardSurface.Section]) {
      for (const width of WIDTHS) {
        const cardSide: number = resolvePadding(CARD_PADDING_CLASS_NAME, width)
          .left;
        const margin: ReturnType<typeof resolveMargin> = resolveMargin(
          getCardRuledBodyClassName(surface),
          width,
        );

        expect([surface, width, margin.left, margin.right]).toEqual([
          surface,
          width,
          -cardSide,
          -cardSide,
        ]);
      }
    }
  });

  test("in a section its row sits as far under the header as a detail card's fields, and a section's padding above the next divider", () => {
    // A switch row pads itself py-4.
    const rowPadding: number = 16;
    const bodyGap: number = 16; // Card's body: mt-4.
    const margin: ReturnType<typeof resolveMargin> = resolveMargin(
      CARD_SECTION_RULED_BODY_CLASS_NAME,
      LAPTOP_WIDTH_IN_PX,
    );
    const sectionBottomPadding: number = resolvePadding(
      CARD_PADDING_CLASS_NAME,
      LAPTOP_WIDTH_IN_PX,
    ).bottom;

    // Above the row's content: the body's gap, less the pull up, plus the row's padding.
    expect(bodyGap + margin.top + rowPadding).toBe(24);
    // Under it: the row's padding, less the pull down, plus the section's.
    expect(rowPadding + margin.bottom + sectionBottomPadding).toBe(24);
  });

  test("the hook gives each surface its class", () => {
    const seen: Array<string> = [];

    const Probe: FunctionComponent = (): ReactElement => {
      seen.push(useCardRuledBodyClassName());
      return <></>;
    };

    render(<Probe />);
    renderSections(<Probe />);

    expect(seen).toEqual([
      CARD_RULED_BODY_CLASS_NAME,
      CARD_SECTION_RULED_BODY_CLASS_NAME,
    ]);
  });
});
