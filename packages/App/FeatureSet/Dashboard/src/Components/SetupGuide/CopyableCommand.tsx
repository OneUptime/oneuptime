import React, { FunctionComponent, ReactElement } from "react";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import { CommandDisplayPart, splitCommandForDisplay } from "./CommandDisplay";

/*
 * One command to run in a shell, with a button that copies it: a light,
 * compact line for a page that lists a few of them (a host's "On the host"
 * card), where a dark code block per command would outweigh what it says.
 * The same look as the commands in a resource's connection card.
 *
 * A command too long for the line wraps at a space. A word of it is kept
 * whole - a browser would otherwise break "sh -s" after its dash, or
 * "oneuptime-collector" after "oneuptime-" - unless it is longer than a
 * phone's line (an address), which breaks where it must. What is on screen
 * is the command, character for character, so selecting it copies it as
 * well as the button does.
 */

export interface ComponentProps {
  command: string;
  dataTestId?: string | undefined;
}

const CopyableCommand: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-3 pr-1.5"
      data-testid={props.dataTestId || "copyable-command"}
    >
      <code className="min-w-0 flex-1 whitespace-pre-wrap py-0.5 font-mono text-xs leading-5 text-gray-800 [overflow-wrap:anywhere]">
        {splitCommandForDisplay(props.command).map(
          (part: CommandDisplayPart, index: number): ReactElement => {
            /*
             * font-mono on the word's own span too: the Dashboard gives
             * every element Inter (index.ejs `*`), which a span would take
             * over the code's monospace.
             */
            return part.isKeptWhole ? (
              <span key={index} className="whitespace-nowrap font-mono">
                {part.text}
              </span>
            ) : (
              <React.Fragment key={index}>{part.text}</React.Fragment>
            );
          },
        )}
      </code>
      <CopyTextButton
        textToBeCopied={props.command}
        iconOnly={true}
        size="sm"
        title="Copy to clipboard"
        className="flex-shrink-0"
      />
    </div>
  );
};

export default CopyableCommand;
