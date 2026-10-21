import { CardSurface, CardSurfaceContext } from "./CardSurface";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Cards drawn as the sections of the one card they are in, never as cards
 * inside a card.
 *
 * Every card in here - a Card, a table's or a list's card, a detail card, a
 * switch card - keeps its header (title, description, the actions at its
 * right edge) and its body, and loses its frame: no border, no rounded
 * corners, no shadow, no gap under it. A divider across the whole width
 * sits above each one, so the first is ruled off from the header of the
 * card that holds them and each of the others from the one before it.
 *
 * It draws no frame and no padding itself: the card that holds it does
 * (More settings - AdvancedPageSection - is the first). Each section pads
 * itself as a card does, so a table still runs from edge to edge and its
 * footer still sits on the section's bottom edge.
 *
 *   <FoldedSection ...>
 *     <CardSections>
 *       <ModelTable cardProps={...} />
 *       <CardModelDetail cardProps={...} />
 *     </CardSections>
 *   </FoldedSection>
 */
export const CARD_SECTIONS_TEST_ID: string = "card-sections";

export interface ComponentProps {
  children: ReactNode;
  dataTestId?: string | undefined;
}

const CardSections: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardSurfaceContext.Provider value={CardSurface.Section}>
      <div data-testid={props.dataTestId || CARD_SECTIONS_TEST_ID}>
        {props.children}
      </div>
    </CardSurfaceContext.Provider>
  );
};

export default CardSections;
