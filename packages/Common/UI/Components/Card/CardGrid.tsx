import { CardGridCellContext } from "./CardGridCell";
import {
  CARD_GRID_CONTAINER_CLASS_NAME,
  CardGridCardWidth,
  CardGridColumns,
  CardGridLayout,
  getCardGridCellClassName,
  getCardGridClassName,
} from "./CardGridLayout";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Cards side by side, every row ending on one line.
 *
 * Each card is drawn in a cell of its own and fills it - a Card, and the
 * tables, lists and detail cards drawn in one, take their cell's height
 * (CardGridCellContext) - so a short card beside a tall one runs to the
 * row's bottom instead of leaving the page showing under it. A list in a
 * card keeps its rows at the top; a card with nothing to list can sit its
 * empty state in the middle of the room it has. A row the cards do not
 * fill is shared by the cards it has: the last card alone in a row of two
 * takes the row. How many cards share a row follows the grid's own width,
 * so a grid beside a side menu never squeezes its cards (CardGridLayout).
 *
 *   <CardGrid columns={2}>
 *     <Card title="Open Cases">...</Card>
 *     <Card title="Riskiest Entities">...</Card>
 *   </CardGrid>
 *
 * One card per child, in reading order: a fragment's children are cards of
 * their own, and a child that is nothing - null, false, an empty fragment -
 * takes no cell, so a card left out leaves no hole. A column of cards is a
 * different layout (Home's row): it is not a cell.
 */
export const CARD_GRID_TEST_ID: string = "card-grid";

export const CARD_GRID_CELL_TEST_ID: string = "card-grid-cell";

export interface ComponentProps {
  children: ReactNode;
  // The most cards side by side.
  columns: CardGridColumns;
  /*
   * How narrow a card may get before fewer share a row: "wide" (24rem, the
   * default) for lists that name things and for charts, "narrow" (16rem)
   * for short ranked lists of counts.
   */
  cardWidth?: CardGridCardWidth | undefined;
  // On the grid's box, beside its own: "!mb-0" where its parent spaces it.
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * The cards, in order: fragments opened, and nothing (null, false, an
 * empty fragment, stray text) left out. Keys stay unique across the
 * fragments they came from.
 */
export const getCardGridCards: (
  children: ReactNode,
  keyPrefix?: string,
) => Array<ReactElement> = (
  children: ReactNode,
  keyPrefix: string = "",
): Array<ReactElement> => {
  const cards: Array<ReactElement> = [];

  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement(child)) {
      continue;
    }

    if (child.type === React.Fragment) {
      cards.push(
        ...getCardGridCards(
          (child.props as { children?: ReactNode }).children,
          `${keyPrefix}${String(child.key)}/`,
        ),
      );
      continue;
    }

    cards.push(
      keyPrefix
        ? React.cloneElement(child, { key: `${keyPrefix}${String(child.key)}` })
        : child,
    );
  }

  return cards;
};

const CardGrid: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const cards: Array<ReactElement> = getCardGridCards(props.children);

  if (cards.length === 0) {
    return <></>;
  }

  const layout: CardGridLayout = {
    columns: props.columns,
    cardWidth: props.cardWidth || "wide",
  };

  return (
    <div
      data-testid={props.dataTestId || CARD_GRID_TEST_ID}
      data-columns={layout.columns}
      data-card-width={layout.cardWidth}
      className={
        props.className
          ? `${CARD_GRID_CONTAINER_CLASS_NAME} ${props.className}`
          : CARD_GRID_CONTAINER_CLASS_NAME
      }
    >
      <div className={getCardGridClassName(layout)}>
        {cards.map((card: ReactElement, index: number): ReactElement => {
          return (
            <div
              key={card.key ?? index}
              data-testid={CARD_GRID_CELL_TEST_ID}
              className={getCardGridCellClassName(layout, index, cards.length)}
            >
              <CardGridCellContext.Provider value={true}>
                {card}
              </CardGridCellContext.Provider>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CardGrid;
