import CopyTextButton from "../CopyTextButton/CopyTextButton";
import {
  WhereToLookParts,
  splitAtWhereToLookCommand,
} from "../../../Types/Exception/UnexplainedError";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where a self-hosted server's admin looks, in the reader's language, with
 * the command in it drawn as a command (#7539): `npm run doctor -- --logs`
 * in one box of code that never breaks across lines, left to right in every
 * script (on an Arabic or Persian page too), with a copy button beside it,
 * as ErrorInSentence draws a reference. The words around it are the
 * sentence's own; a sentence with no command in it is drawn as it is.
 *
 * ErrorExplanation draws it in its block, and ErrorWhereToLook on the line
 * after a card's own sentence.
 */
export interface ComponentProps {
  // The where-to-look sentence, already in the reader's language.
  text: string;
}

const WhereToLookWords: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: WhereToLookParts | null = splitAtWhereToLookCommand(props.text);

  if (!parts) {
    return <>{props.text}</>;
  }

  return (
    <>
      {parts.before}
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap align-middle"
        data-testid="error-where-to-look-command"
      >
        <code
          dir="ltr"
          className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-900"
        >
          {parts.command}
        </code>
        <CopyTextButton
          textToBeCopied={parts.command}
          size="xs"
          iconOnly={true}
        />
      </span>
      {parts.after}
    </>
  );
};

export default WhereToLookWords;
