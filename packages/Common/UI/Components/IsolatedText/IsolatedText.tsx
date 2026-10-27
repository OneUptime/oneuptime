import {
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
} from "../../../Types/ReadingDirection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  className?: string | undefined;
  /*
   * Under the pointer: the value whole, for one cut short to its line, or
   * what it opens (a security entity's chip).
   */
  title?: string | undefined;
}

/*
 * A VALUE SOMEONE WROTE, IN A LINE OF THE PAGE, READ THE WAY IT IS WRITTEN.
 *
 * A monitor's description, a schedule's name, a field someone filled in is
 * in their language, whatever the page's. Shown as it was on a Persian page
 * an English one put its full stop at its start (".Watches the checkout
 * endpoint"), and a Persian one did the same on an English page. In an
 * isolate (bdi) that reads the way most of its letters do
 * (getTextReadingDirectionByMostLetters) it keeps its punctuation where it
 * was written, and still starts where its cell or its line does, under its
 * column's name. A value with no letters - a port, a count - takes the
 * bdi's own reading.
 */
const IsolatedText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const direction: ReadingDirection | null =
    getTextReadingDirectionByMostLetters(props.text);

  return (
    <bdi
      dir={direction || undefined}
      className={props.className}
      title={props.title}
    >
      {props.text}
    </bdi>
  );
};

export default IsolatedText;
