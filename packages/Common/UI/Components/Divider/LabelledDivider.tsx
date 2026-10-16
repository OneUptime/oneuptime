import React, { FunctionComponent, ReactElement } from "react";

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
        className="flex-1 border-t border-gray-200"
        aria-hidden="true"
        data-testid={props.dataTestId ? `${props.dataTestId}-line` : undefined}
      />
      <span dir="auto" className="text-center text-sm text-gray-500">
        {props.label}
      </span>
      <div
        className="flex-1 border-t border-gray-200"
        aria-hidden="true"
        data-testid={props.dataTestId ? `${props.dataTestId}-line` : undefined}
      />
    </div>
  );
};

export default LabelledDivider;
