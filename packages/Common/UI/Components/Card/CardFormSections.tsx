import { CardSurface, CardSurfaceContext } from "./CardSurface";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Cards drawn as the sections of the form they are in, at every width.
 *
 * For cards that are always drawn inside a card or a dialog: the cards of a
 * form's step - Create Monitor's Monitor Target, Test Monitor and Monitor
 * Criteria, in the page's card and in the edit dialog. They were cards
 * inside the page's card, the card-in-card look the maintainer asked to
 * remove everywhere ("More Settings should look like one card instead of a
 * card inside of a card, and it should have dividers ... Please do this
 * everywhere in the project"). On a phone each frame and its padding also
 * came off the width of every field in them: the monitor criteria editor's
 * alert form sat six boxes deep, its description editor 166px wide. #5482
 * made them sections on phones; they are sections at every width now.
 *
 * So each Card in here has no frame, no side padding and no gap under it,
 * keeps its header and its body, and a rule above it parts it from what
 * comes before; its title is a section's, a step below the title of the
 * card it is in. (Card's CARD_FORM_SECTION_* class names.)
 *
 * Unlike CardSections, whose sections pad themselves as a card does inside
 * a card that has no padding of its own (More settings), these sit in the
 * padded body of the card or dialog around them: their words start where
 * the form's other fields start, beside the form's step list.
 *
 * Its cards hold fields. A card whose body reaches its edges - a table's or
 * a list's rows and footer, a switch card's rows - has no side padding to
 * reach into here: draw those in CardSections.
 *
 * It draws one plain element round its cards, with the classes it is
 * given: how far apart the cards are (space-y-6). That gap is the room
 * above each card's rule, as the card's 24px top padding is the room under
 * it.
 *
 *   <CardFormSections className="space-y-6">
 *     <Card title="Monitor Target">...</Card>
 *     <Card title="Criteria">...</Card>
 *   </CardFormSections>
 */
export const CARD_FORM_SECTIONS_TEST_ID: string = "card-form-sections";

export interface ComponentProps {
  children: ReactNode;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const CardFormSections: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardSurfaceContext.Provider value={CardSurface.FormSection}>
      <div
        className={props.className}
        data-testid={props.dataTestId || CARD_FORM_SECTIONS_TEST_ID}
      >
        {props.children}
      </div>
    </CardSurfaceContext.Provider>
  );
};

export default CardFormSections;
