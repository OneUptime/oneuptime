import {
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
} from "../../../Types/ReadingDirection";
import BreakableName from "../BreakableName/BreakableName";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  className?: string | undefined;
  /*
   * Under the pointer: the value whole, for one cut short to its line, or
   * what it opens (a security entity's chip).
   */
  title?: string | undefined;
  /*
   * A value that is a long name - a host pattern, a field's value, a path -
   * breaks after its own dots and slashes first ("*.lab.acme-commerce." /
   * "example"), not at whatever letter fills the line (BreakableName). Its
   * holder sets [overflow-wrap:anywhere] for a part still too long.
   */
  breaksLikeAName?: boolean | undefined;
  dataTestId?: string | undefined;
  // A size worked out as it is drawn (a dashboard Value widget's title).
  style?: React.CSSProperties | undefined;
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
      style={props.style}
      title={props.title}
      data-testid={props.dataTestId}
    >
      {props.breaksLikeAName ? <BreakableName text={props.text} /> : props.text}
    </bdi>
  );
};

export default IsolatedText;
