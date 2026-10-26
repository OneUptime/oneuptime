import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A link's words with its arrow glued to the last of them: "Open AI
 * settings ->" - the arrow part of the words' line, held to the last word
 * by a no-break space that cannot wrap away from it, so a name that wraps
 * on a phone ends with its arrow, which never sits alone at the card's far
 * edge or on a line of its own. An inline-flex link with the arrow as its
 * own item put it at the far edge whenever the words wrapped.
 *
 * Put it inside the Link, with the Link's text classes (it draws inline,
 * so the words wrap as text). The arrow is decorative: the words say where
 * the link goes. On a page that reads right to left it points left, the
 * way the words run, as the product's other forward arrows do.
 */
export interface ComponentProps {
  text: string;
  arrowTestId?: string | undefined;
}

// Glues the arrow to the words: U+00A0, which no line breaks around.
export const ARROW_GLUE: string = "\u00a0";

// The arrow's box: on the words' line, turned round right to left.
export const ARROW_GLUED_ARROW_CLASS_NAME: string =
  "inline-block align-middle rtl:rotate-180";

const ArrowGluedText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <>
      {props.text}
      <span className="whitespace-nowrap">
        {ARROW_GLUE}
        <span
          aria-hidden="true"
          data-testid={props.arrowTestId}
          className={ARROW_GLUED_ARROW_CLASS_NAME}
        >
          <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
        </span>
      </span>
    </>
  );
};

export default ArrowGluedText;
