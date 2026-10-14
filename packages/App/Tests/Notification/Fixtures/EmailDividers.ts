import { decodeHtmlEntities } from "Common/Tests/Helpers/HtmlText";
import {
  childElements,
  EmailElement,
  EmailMarkupTree,
  EmailNode,
  findElements,
  hasClass,
  inlineStyle,
  textOf,
} from "./EmailMarkupTree";

/*
 * WHERE AN EMAIL'S DIVIDERS SIT.
 *
 * A divider is a line one side of an element draws - border-top,
 * border-bottom, border-left or border-right in its inline style - to set
 * it apart from what is next to it. A box is an element that draws a line
 * all the way round it - the `border` shorthand - such as a detail card, a
 * list, a Markdown table, a button or the email itself.
 *
 * A divider belongs BETWEEN two things in its box: something visible on
 * each side of the line, inside the nearest box around the element that
 * draws it (the email itself when there is none). One with nothing on its
 * far side sits on the box's own border: under the last row of a card it
 * doubles the card's bottom border, or - as the maintainer saw it - draws
 * a second line a few pixels inside it. One drawn above an empty last
 * section is the same line with nothing after it.
 *
 * Before a line at the top or left of an element is what the box shows
 * before the element; after it, the element itself and what follows it.
 * Before a line at the bottom or right is what the box shows up to the end
 * of the element; after it, what follows the element.
 *
 * Visible is text that is not whitespace, or an image, outside the <head>
 * and outside anything hidden with display: none or mso-hide: all. Only
 * inline styles count: a <style> block is what many mail clients drop.
 */

export type DividerSide = "top" | "bottom" | "left" | "right";

export interface MisplacedDivider {
  side: DividerSide;
  // The side of the line with nothing visible on it, inside its box.
  nothing: "before" | "after";
  // The element that draws it: its tag, class and style.
  element: string;
  // The box it sits in, described the same way.
  box: string;
}

const SIDES: ReadonlyArray<DividerSide> = ["top", "bottom", "left", "right"];

// Whether a border value draws a line a reader can see.
const drawsLine: (value: string | undefined) => boolean = (
  value: string | undefined,
): boolean => {
  if (!value) {
    return false;
  }

  const words: Array<string> = value.toLowerCase().split(" ");

  return (
    !words.includes("none") &&
    !words.includes("hidden") &&
    !words.includes("0") &&
    !words.includes("0px") &&
    ["solid", "dashed", "dotted", "double"].some((style: string): boolean => {
      return words.includes(style);
    })
  );
};

// Whether the element draws a line all the way round itself.
export const drawsBox: (element: EmailElement) => boolean = (
  element: EmailElement,
): boolean => {
  return drawsLine(inlineStyle(element).get("border"));
};

// The sides the element draws a divider on.
export const dividerSides: (element: EmailElement) => Array<DividerSide> = (
  element: EmailElement,
): Array<DividerSide> => {
  if (drawsBox(element)) {
    return [];
  }

  const style: Map<string, string> = inlineStyle(element);

  return SIDES.filter((side: DividerSide): boolean => {
    return drawsLine(style.get(`border-${side}`));
  });
};

// Whether nothing under the element is shown.
const isHidden: (element: EmailElement) => boolean = (
  element: EmailElement,
): boolean => {
  if (element.name === "head" || element.name === "title") {
    return true;
  }

  const style: Map<string, string> = inlineStyle(element);

  return (
    (style.get("display") || "").toLowerCase() === "none" ||
    (style.get("mso-hide") || "").toLowerCase() === "all"
  );
};

// Whether a text node shows anything: whitespace, &nbsp; included, does not.
const showsText: (text: string) => boolean = (text: string): boolean => {
  return decodeHtmlEntities(text).trim().length > 0;
};

// A short description of an element, for a failure message.
export const describeElement: (element: EmailElement) => string = (
  element: EmailElement,
): string => {
  const className: string = element.attributes["class"]
    ? ` class="${element.attributes["class"]}"`
    : "";
  const style: string = (element.attributes["style"] || "").slice(0, 120);

  return `<${element.name}${className} style="${style}">`;
};

interface Positions {
  // Where each element opens and closes, in document order.
  start: Map<EmailElement, number>;
  end: Map<EmailElement, number>;
  // Where each visible text or image is, in document order.
  visible: Array<number>;
}

const positionsOf: (root: EmailElement) => Positions = (
  root: EmailElement,
): Positions => {
  const positions: Positions = {
    start: new Map<EmailElement, number>(),
    end: new Map<EmailElement, number>(),
    visible: [],
  };
  let counter: number = 0;

  const visit: (node: EmailNode, hidden: boolean) => void = (
    node: EmailNode,
    hidden: boolean,
  ): void => {
    counter++;

    if (node.kind === "text") {
      if (!hidden && showsText(node.text)) {
        positions.visible.push(counter);
      }

      return;
    }

    const isNodeHidden: boolean = hidden || isHidden(node);

    positions.start.set(node, counter);

    if (!isNodeHidden && node.name === "img") {
      positions.visible.push(counter);
    }

    for (const child of node.children) {
      visit(child, isNodeHidden);
    }

    counter++;
    positions.end.set(node, counter);
  };

  visit(root, false);

  return positions;
};

// The nearest element around `element` that draws a box, or the root.
const boxAround: (element: EmailElement) => EmailElement = (
  element: EmailElement,
): EmailElement => {
  let box: EmailElement | null = element.parent;

  while (box && box.parent && !drawsBox(box)) {
    box = box.parent;
  }

  return box || element;
};

/*
 * Every divider in the email without something visible of its box on each
 * side of it: one that sits on the edge of the box around it, or above or
 * under nothing. An email laid out right has none.
 */
export const misplacedDividers: (
  tree: EmailMarkupTree,
) => Array<MisplacedDivider> = (
  tree: EmailMarkupTree,
): Array<MisplacedDivider> => {
  const positions: Positions = positionsOf(tree.root);
  const misplaced: Array<MisplacedDivider> = [];

  const anyVisibleBetween: (after: number, before: number) => boolean = (
    after: number,
    before: number,
  ): boolean => {
    return positions.visible.some((position: number): boolean => {
      return position > after && position < before;
    });
  };

  for (const element of findElements(tree.root, (): boolean => {
    return true;
  })) {
    const sides: Array<DividerSide> = dividerSides(element);

    if (sides.length === 0) {
      continue;
    }

    const box: EmailElement = boxAround(element);
    const elementStart: number = positions.start.get(element)!;
    const elementEnd: number = positions.end.get(element)!;
    const boxStart: number = positions.start.get(box)!;
    const boxEnd: number = positions.end.get(box)!;

    for (const side of sides) {
      // Where the line runs: at the element's start, or at its end.
      const line: number =
        side === "top" || side === "left" ? elementStart : elementEnd;

      if (!anyVisibleBetween(boxStart, line)) {
        misplaced.push({
          side: side,
          nothing: "before",
          element: describeElement(element),
          box: describeElement(box),
        });
      }

      if (!anyVisibleBetween(line, boxEnd)) {
        misplaced.push({
          side: side,
          nothing: "after",
          element: describeElement(element),
          box: describeElement(box),
        });
      }
    }
  }

  return misplaced;
};

export interface DetailCardRow {
  // The row's label (DetailBoxField's title, or STATE CHANGE / STATUS CHANGE).
  label: string;
  // Whether the row draws a divider above itself, and below.
  dividerAbove: boolean;
  dividerBelow: boolean;
}

export interface DetailCard {
  rows: Array<DetailCardRow>;
  // Elements in the card that are not rows: there should be none.
  strayElements: Array<string>;
}

// Every detail card in the email, its rows in order.
export const detailCards: (tree: EmailMarkupTree) => Array<DetailCard> = (
  tree: EmailMarkupTree,
): Array<DetailCard> => {
  return findElements(tree.root, (element: EmailElement): boolean => {
    return element.name === "td" && hasClass(element, "st-DetailCard-content");
  }).map((content: EmailElement): DetailCard => {
    const children: Array<EmailElement> = childElements(content);

    return {
      rows: children
        .filter((child: EmailElement): boolean => {
          return hasClass(child, "st-DetailCard-field");
        })
        .map((row: EmailElement): DetailCardRow => {
          const label: EmailElement | undefined = findElements(
            row,
            (element: EmailElement): boolean => {
              return hasClass(element, "st-DetailCard-label");
            },
          )[0];
          const sides: Array<DividerSide> = dividerSides(row);

          return {
            label: label ? decodeHtmlEntities(textOf(label)).trim() : "",
            dividerAbove: sides.includes("top"),
            dividerBelow: sides.includes("bottom"),
          };
        }),
      strayElements: children
        .filter((child: EmailElement): boolean => {
          return !hasClass(child, "st-DetailCard-field");
        })
        .map(describeElement),
    };
  });
};

/*
 * What a card's rows should be: no divider above the first row, one above
 * every other, and none below any.
 */
export const dividersOnlyBetweenRows: (card: DetailCard) => boolean = (
  card: DetailCard,
): boolean => {
  return card.rows.every((row: DetailCardRow, index: number): boolean => {
    return row.dividerAbove === index > 0 && !row.dividerBelow;
  });
};
