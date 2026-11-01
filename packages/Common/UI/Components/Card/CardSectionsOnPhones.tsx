import { CardSurface, CardSurfaceContext } from "./CardSurface";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Cards drawn as the sections of the card or dialog they are in on a phone,
 * and as cards of their own from sm up.
 *
 * For cards that are always drawn inside a card or a dialog: the cards of a
 * form's step - Create Monitor's Monitor Target, Test Monitor and Monitor
 * Criteria, in the page's card and in the edit dialog. From sm up there is
 * room for their frames. On a phone each frame and its padding came off the
 * width of every field inside it - the monitor criteria editor's alert form
 * sat six boxes deep, its description editor 166px wide - while the card or
 * dialog around them already frames them.
 *
 * So below sm each Card in here loses its frame, its side padding and the
 * gap under it, keeps its header and its body, and a rule above it parts it
 * from what comes before; its title is a section's, a step below the title
 * of the card it is in. From sm up it is the card it always was. (Card's
 * CARD_SECTION_ON_PHONES_* class names.)
 *
 * Its cards hold fields. A card whose body reaches its edges - a table's or
 * a list's rows and footer, a switch card's rows - has no side padding to
 * reach into here on a phone: draw those in CardSections.
 *
 * It draws one plain element round its cards, with the classes it is
 * given: how far apart the cards are (space-y-6). On a phone that gap is
 * the room above each card's rule, as the card's 24px top padding is the
 * room under it.
 *
 *   <CardSectionsOnPhones className="space-y-6">
 *     <Card title="Monitor Target">...</Card>
 *     <Card title="Monitor Criteria">...</Card>
 *   </CardSectionsOnPhones>
 */
export const CARD_SECTIONS_ON_PHONES_TEST_ID: string =
  "card-sections-on-phones";

export interface ComponentProps {
  children: ReactNode;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const CardSectionsOnPhones: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardSurfaceContext.Provider value={CardSurface.SectionOnPhones}>
      <div
        className={props.className}
        data-testid={props.dataTestId || CARD_SECTIONS_ON_PHONES_TEST_ID}
      >
        {props.children}
      </div>
    </CardSurfaceContext.Provider>
  );
};

export default CardSectionsOnPhones;
