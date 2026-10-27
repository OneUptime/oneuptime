import React, { FunctionComponent, ReactElement } from "react";

// Each hairline: it takes the room the words leave, and never less than 1.5rem.
export const LABELLED_DIVIDER_LINE_CLASS_NAME: string =
  "min-w-6 flex-1 border-t border-gray-200";

/*
 * The words: on one line while they fit beside two 1.5rem lines, then
 * wrapped onto lines of even length.
 */
export const LABELLED_DIVIDER_LABEL_CLASS_NAME: string =
  "min-w-0 text-balance text-center text-sm text-gray-500";

export interface ComponentProps {
  label: string;
  // The space above and below. Defaults to my-6.
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A hairline with a few words in its middle: "or" between a sign-in page's
 * own button and its other ways in, "Or continue with email" between the
 * single sign-on page's providers and its email form.
 *
 * Two lines either side of the words, laid out with flex, rather than one
 * line drawn behind words on a white patch: the patch only hides the line on
 * a white card, and showed as a box on anything else - a faded paused form, a
 * tinted surface, a dark theme. The words are plain text, read in order
 * between the controls they separate; the lines are hidden from assistive
 * technology.
 *
 * The lines never shrink to nothing. On a 320px phone a long label ("Oder
 * mit E-Mail fortfahren", "Или продолжите с электронной почтой", "O continúe
 * con su correo electrónico") filled the row and pushed both lines out of it,
 * so the words floated alone. Each line keeps at least 1.5rem (min-w-6); past
 * that the words wrap, onto lines of even length, between them.
 */
const LabelledDivider: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className={`flex items-center gap-3 ${props.className || "my-6"}`}
      data-testid={props.dataTestId}
    >
      <div
        className={LABELLED_DIVIDER_LINE_CLASS_NAME}
        aria-hidden="true"
        data-testid={props.dataTestId ? `${props.dataTestId}-line` : undefined}
      />
      <span dir="auto" className={LABELLED_DIVIDER_LABEL_CLASS_NAME}>
        {props.label}
      </span>
      <div
        className={LABELLED_DIVIDER_LINE_CLASS_NAME}
        aria-hidden="true"
        data-testid={props.dataTestId ? `${props.dataTestId}-line` : undefined}
      />
    </div>
  );
};

export default LabelledDivider;
