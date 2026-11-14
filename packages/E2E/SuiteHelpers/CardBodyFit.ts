import { expect, Locator, Page } from "@playwright/test";

/*
 * Whether what a card holds lines up with its title (#6555, #6956).
 *
 * A card (Common's Card, data-testid="card") pads what it holds itself, so
 * on every product's cards what a card holds starts right under the first
 * letter of its title and ends a card's padding over its bottom edge. A
 * body that pads itself again - Data Observability's cards had px-6 pb-6,
 * OpenStack's p-4 - starts 16 to 24px in from the title and leaves as much
 * more under it.
 *
 * Read for each card a locator finds, as the page drew it: every element at
 * the top of the card's body (the children of the element after its
 * header) must not pad the card's padding again on its left, right or
 * bottom; and the first letter of what the body holds starts where its
 * title does, at the title's start in the page's reading direction. A card
 * without a header has no title to line up with and is not read. What pads
 * something else than the card is let be, as the guard over the sources
 * lets it be:
 *
 *   - an element with a box of its own (a border all round, a background
 *     or a shadow) pads its own content: its box is what lines up;
 *   - an element that bleeds over the card's padding (a negative margin),
 *     or sits in a body the card bleeds, pads back what it bleeds: its
 *     padding less what it bleeds is what counts. When it bleeds past the
 *     title and pads nothing back - a list or a table ruled from edge to
 *     edge whose rows or cells pad themselves, its header a band of grey -
 *     what it holds is read where its rows or cells start;
 *   - a loading or an empty state set in the middle of the card (centred
 *     text, a flex row centring along it, a flex column across it) that
 *     pads only above and below has room of its own;
 *   - a bulleted list draws its bullets in its start padding: its box is
 *     what lines up.
 *
 * The guard over every frontend's sources
 * (Common/Tests/App/Dashboard/CardBodyPaddingGuard.test.ts) reads the same
 * rule from the code; this reads it from the page.
 */

// How far apart two edges may be and still line up: a rounding of the layout.
export const CARD_BODY_FIT_TOLERANCE_IN_PX: number = 0.5;

/*
 * What does not line up in the cards a locator finds, one sentence each:
 * "Lineage: <div> pads the card again (left 24px, right 24px, bottom
 * 24px)", "Lineage: what it holds starts 24px from its title". None when
 * every card's body is flush with its padding.
 */
export async function cardBodyMisfits(cards: Locator): Promise<Array<string>> {
  return cards.evaluateAll(
    (elements: Array<Element>, tolerance: number): Array<string> => {
      const misfits: Array<string> = [];
      // A computed colour with nothing of it showing: rgba(r, g, b, 0).
      const NO_COLOUR: RegExp = /^rgba\([^)]*,\s*0\)$/;
      /*
       * How many levels a body bled past the title is read into for where
       * its content starts: a table's cell is five under the body's element
       * (a scroller, the table, its head, a row, the cell).
       */
      const MAXIMUM_DEPTH: number = 6;

      // Whether an element draws a box of its own: a border all round, a background or a shadow.
      const drawsBox: (style: CSSStyleDeclaration) => boolean = (
        style: CSSStyleDeclaration,
      ): boolean => {
        const hasBorder: boolean = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ].every((width: string): boolean => {
          return parseFloat(width) > 0;
        });
        const background: string = style.backgroundColor;
        const hasBackground: boolean =
          background !== "transparent" && !NO_COLOUR.test(background);

        return hasBorder || hasBackground || style.boxShadow !== "none";
      };

      // A margin that reaches over the card's padding: the negative part of it.
      const bleedOf: (margin: string) => number = (margin: string): number => {
        return Math.min(0, parseFloat(margin) || 0);
      };

      // Whether an element sets what it holds in the middle of its width.
      const centresAcross: (style: CSSStyleDeclaration) => boolean = (
        style: CSSStyleDeclaration,
      ): boolean => {
        const isFlex: boolean =
          style.display === "flex" || style.display === "inline-flex";
        const isColumn: boolean = style.flexDirection.startsWith("column");
        const isGrid: boolean =
          style.display === "grid" || style.display === "inline-grid";

        return (
          style.textAlign === "center" ||
          (isFlex && !isColumn && style.justifyContent === "center") ||
          (isFlex && isColumn && style.alignItems === "center") ||
          (isGrid && style.justifyItems === "center")
        );
      };

      // Whether an element is a list that draws its bullets in the padding at its start.
      const isBulletedList: (
        element: Element,
        style: CSSStyleDeclaration,
      ) => boolean = (
        element: Element,
        style: CSSStyleDeclaration,
      ): boolean => {
        return (
          (element.tagName === "UL" || element.tagName === "OL") &&
          style.listStyleType !== "none" &&
          style.listStylePosition === "outside"
        );
      };

      const describe: (element: Element) => string = (
        element: Element,
      ): string => {
        const testId: string | null = element.getAttribute("data-testid");

        return `<${element.tagName.toLowerCase()}${testId ? ` data-testid="${testId}"` : ""}>`;
      };

      const isDrawn: (element: Element) => boolean = (
        element: Element,
      ): boolean => {
        const box: DOMRect = element.getBoundingClientRect();

        return box.width > 0 || box.height > 0;
      };

      for (const card of elements) {
        const header: Element | null = card.querySelector(
          '[data-testid="card-header"]',
        );
        const body: Element | null = header ? header.nextElementSibling : null;
        const title: Element | null = header
          ? header.querySelector("h1, h2, h3, h4")
          : null;

        if (!header || !body || !title) {
          continue;
        }

        const name: string = (title.textContent || "").trim();
        const isRightToLeft: boolean =
          getComputedStyle(card).direction === "rtl";
        const titleBox: DOMRect = title.getBoundingClientRect();
        const titleStart: number = isRightToLeft
          ? titleBox.right
          : titleBox.left;
        const bodyStyle: CSSStyleDeclaration = getComputedStyle(body);
        // What the card's body itself bleeds: its elements may pad that back.
        const bodyBleed: { left: number; right: number; bottom: number } = {
          left: bleedOf(bodyStyle.marginLeft),
          right: bleedOf(bodyStyle.marginRight),
          bottom: bleedOf(bodyStyle.marginBottom),
        };

        // Whether a start lies before the title's, in the reading direction.
        const isBeforeTitle: (start: number) => boolean = (
          start: number,
        ): boolean => {
          return isRightToLeft
            ? start > titleStart + tolerance
            : start < titleStart - tolerance;
        };

        const earliest: (starts: Array<number>) => number | null = (
          starts: Array<number>,
        ): number | null => {
          if (starts.length === 0) {
            return null;
          }

          return isRightToLeft ? Math.max(...starts) : Math.min(...starts);
        };

        /*
         * Where what an element holds starts: its box's edge when it draws
         * a box or bullets, its padding's inner edge otherwise - or, when
         * that edge lies past the title (a ruled list or table bled to the
         * card's edges, a band of grey across them), where the elements it
         * holds start.
         */
        const contentStartOf: (element: Element, depth: number) => number = (
          element: Element,
          depth: number,
        ): number => {
          const box: DOMRect = element.getBoundingClientRect();
          const style: CSSStyleDeclaration = getComputedStyle(element);
          const edge: number = isRightToLeft ? box.right : box.left;

          if (
            (drawsBox(style) || isBulletedList(element, style)) &&
            !isBeforeTitle(edge)
          ) {
            return edge;
          }

          const start: number = isRightToLeft
            ? box.right - (parseFloat(style.paddingRight) || 0)
            : box.left + (parseFloat(style.paddingLeft) || 0);

          if (!isBeforeTitle(start) || depth >= MAXIMUM_DEPTH) {
            return start;
          }

          const inner: number | null = earliest(
            Array.from(element.children)
              .filter(isDrawn)
              .map((child: Element): number => {
                return contentStartOf(child, depth + 1);
              }),
          );

          return inner === null ? start : inner;
        };

        const starts: Array<number> = [];

        for (const child of Array.from(body.children)) {
          if (!isDrawn(child)) {
            continue;
          }

          const style: CSSStyleDeclaration = getComputedStyle(child);

          if (!drawsBox(style)) {
            // Each side's padding, less what the element and the body bleed there.
            const left: number =
              (parseFloat(style.paddingLeft) || 0) +
              bleedOf(style.marginLeft) +
              bodyBleed.left;
            const right: number =
              (parseFloat(style.paddingRight) || 0) +
              bleedOf(style.marginRight) +
              bodyBleed.right;
            const bottom: number =
              (parseFloat(style.paddingBottom) || 0) +
              bleedOf(style.marginBottom) +
              bodyBleed.bottom;
            // A list's bullets sit in its start padding.
            const isList: boolean = isBulletedList(child, style);
            const counted: { left: number; right: number; bottom: number } = {
              left: isList && !isRightToLeft ? 0 : left,
              right: isList && isRightToLeft ? 0 : right,
              bottom,
            };
            const padsAcross: boolean =
              counted.left > tolerance || counted.right > tolerance;
            // A centred state that pads only above and below has room of its own.
            const padsBottom: boolean =
              counted.bottom > tolerance &&
              (padsAcross || !centresAcross(style));

            if (padsAcross || padsBottom) {
              misfits.push(
                `${name}: ${describe(child)} pads the card again (left ${Math.max(0, counted.left)}px, right ${Math.max(0, counted.right)}px, bottom ${Math.max(0, counted.bottom)}px)`,
              );
            }
          }

          starts.push(contentStartOf(child, 0));
        }

        const contentStart: number | null = earliest(starts);

        if (contentStart === null) {
          continue;
        }

        const offset: number = Math.abs(contentStart - titleStart);

        if (offset > tolerance) {
          misfits.push(
            `${name}: what it holds starts ${Math.round(offset * 10) / 10}px from its title`,
          );
        }
      }

      return misfits;
    },
    CARD_BODY_FIT_TOLERANCE_IN_PX,
  );
}

// A laptop's window and a phone's: where a page's cards are read.
export const CARD_FIT_WIDTHS: ReadonlyArray<{ width: number; height: number }> =
  [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ];

/*
 * Every card on a page lines up with its title at each width: read once
 * what changed is drawn, and again until the page is at rest, since a
 * resize lays the page out again and some cards draw again when they are
 * resized. A failure names each misfit, at its width.
 */
export async function expectCardsFit(
  page: Page,
  drawn: ReadonlyArray<Locator>,
  widths: ReadonlyArray<{ width: number; height: number }> = CARD_FIT_WIDTHS,
): Promise<void> {
  for (const size of widths) {
    await page.setViewportSize(size);

    for (const locator of drawn) {
      await expect(locator).toBeVisible();
    }

    await expect
      .poll(
        async (): Promise<Array<string>> => {
          return cardBodyMisfits(page.getByTestId("card"));
        },
        { message: `the cards at ${size.width}px` },
      )
      .toEqual([]);
  }
}
