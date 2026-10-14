import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The second paragraph of a Delete question: what deleting the record takes
 * with it ("Deleting a status page also deletes its subscribers, private
 * users and custom domains."), or what it does to the records around it
 * ("Acknowledged, the state before it, becomes the incident's current state
 * again.").
 *
 * The question and "This action cannot be undone." come first, together;
 * this is a paragraph of its own under them. It is the one thing in the
 * dialog the person deciding has not already assumed, and in the middle of
 * the question's sentences it was one more line to read past. Every Delete
 * dialog draws it through here, so they all set it apart the same way.
 *
 * A block <span>, not a <p>: the question is drawn inside a card's
 * description, which is a <p> already. The space before it keeps the two
 * paragraphs apart for anything that reads them as one line of text -
 * textContent, a screen reader's flat reading.
 */

export const DELETE_CONSEQUENCE_PARAGRAPH_CLASS_NAME: string = "mt-3 block";

export interface ComponentProps {
  children: ReactNode;
  dataTestId?: string | undefined;
  /*
   * False when nothing is drawn before it - a question with no sentence of
   * its own - so it neither starts with a space nor leaves a gap above.
   */
  hasTextBefore?: boolean | undefined;
}

const DeleteConsequenceParagraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hasTextBefore: boolean = props.hasTextBefore !== false;

  return (
    <>
      {hasTextBefore ? " " : ""}
      <span
        className={
          hasTextBefore ? DELETE_CONSEQUENCE_PARAGRAPH_CLASS_NAME : "block"
        }
        data-testid={props.dataTestId || "delete-confirmation-consequence"}
      >
        {props.children}
      </span>
    </>
  );
};

export default DeleteConsequenceParagraph;
