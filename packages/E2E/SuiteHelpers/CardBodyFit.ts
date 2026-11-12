import { Locator } from "@playwright/test";

/*
 * Whether what a card holds lines up with its title (#6555).
 *
 * A card (Common's Card, data-testid="card") pads what it holds itself, so
 * on every product's cards what a card holds starts right under the first
 * letter of its title and ends a card's padding over its bottom edge. A
 * body that pads itself again - Data Observability's cards had px-6 pb-6 -
 * starts 24px in from the title and leaves 24px more under it.
 *
 * Read for each card a locator finds, as the page drew it: every element at
 * the top of the card's body (the children of the element after its
 * header) that draws no box of its own - no border, background or shadow -
 * must have no padding on its left, right or bottom; and the first letter
 * of what the body holds starts where its title does, at the title's start
 * in the page's reading direction. An element with a box of its own (a
 * notice, an error) pads its own content: its box is what lines up. A card
 * without a header has no title to line up with and is not read.
 *
 * The guard over Data Observability's sources
 * (Common/Tests/App/Dashboard/DataObservabilityCardPaddingGuard.test.ts)
 * reads the same rule from the code; this reads it from the page.
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

      // Whether an element draws a box of its own: a border, a background or a shadow.
      const drawsBox: (style: CSSStyleDeclaration) => boolean = (
        style: CSSStyleDeclaration,
      ): boolean => {
        const hasBorder: boolean = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ].some((width: string): boolean => {
          return parseFloat(width) > 0;
        });
        const background: string = style.backgroundColor;
        const hasBackground: boolean =
          background !== "transparent" && !NO_COLOUR.test(background);

        return hasBorder || hasBackground || style.boxShadow !== "none";
      };

      const describe: (element: Element) => string = (
        element: Element,
      ): string => {
        const testId: string | null = element.getAttribute("data-testid");

        return `<${element.tagName.toLowerCase()}${testId ? ` data-testid="${testId}"` : ""}>`;
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
        // Where what the body holds starts, in the reading direction.
        let contentStart: number | null = null;

        for (const child of Array.from(body.children)) {
          const box: DOMRect = child.getBoundingClientRect();
          const style: CSSStyleDeclaration = getComputedStyle(child);

          if (box.width === 0 && box.height === 0) {
            continue;
          }

          let start: number = isRightToLeft ? box.right : box.left;

          if (!drawsBox(style)) {
            const left: number = parseFloat(style.paddingLeft) || 0;
            const right: number = parseFloat(style.paddingRight) || 0;
            const bottom: number = parseFloat(style.paddingBottom) || 0;

            if (left > tolerance || right > tolerance || bottom > tolerance) {
              misfits.push(
                `${name}: ${describe(child)} pads the card again (left ${left}px, right ${right}px, bottom ${bottom}px)`,
              );
            }

            start = isRightToLeft ? box.right - right : box.left + left;
          }

          contentStart =
            contentStart === null
              ? start
              : isRightToLeft
                ? Math.max(contentStart, start)
                : Math.min(contentStart, start);
        }

        if (contentStart === null) {
          continue;
        }

        const titleStart: number = isRightToLeft
          ? titleBox.right
          : titleBox.left;
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
