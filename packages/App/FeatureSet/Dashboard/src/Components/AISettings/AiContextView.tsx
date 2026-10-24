import {
  AI_CONTEXT_CARD_COPY,
  AI_CONTEXT_TEST_IDS,
  AiContextLength,
  describeAiContextLength,
  getAiContextLength,
} from "./AiContextCopy";
import { AiContextOwner, readAiContext } from "Common/Types/AI/AiContext";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * A text this long, or with this many lines, is drawn folded to
 * FOLDED_CLASS_NAME's height with "Show all" under it: notes of a few
 * thousand words would otherwise push the rest of the settings page a
 * screen or more down.
 */
const FOLD_AFTER_LINES: number = 14;
const FOLD_AFTER_CHARACTERS: number = 1_200;

// About fourteen lines of prose, fading out at the bottom.
const FOLDED_CLASS_NAME: string = "max-h-72 overflow-hidden";

export function isAiContextFolded(text: string): boolean {
  return (
    text.split("\n").length > FOLD_AFTER_LINES ||
    text.length > FOLD_AFTER_CHARACTERS
  );
}

export interface ComponentProps {
  text: string | null | undefined;
}

/*
 * The project's AI context on its card: the notes as they read, rendered,
 * and under them how long they are and about how many tokens a model reads
 * them as. A long text is folded, with Show all / Show less. With none:
 * one quiet line, the card's own button ("Add AI context") being the way
 * to write it.
 */
const AiContextView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bodyId: string = useId();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const text: string = readAiContext(props.text);

  if (!text) {
    return (
      <p
        data-testid={AI_CONTEXT_TEST_IDS.empty}
        className="text-sm text-gray-500"
      >
        {translator.translateText(AI_CONTEXT_CARD_COPY.emptyText)}
      </p>
    );
  }

  const length: AiContextLength = getAiContextLength({
    value: text,
    owner: AiContextOwner.Project,
  });
  const isFoldable: boolean = isAiContextFolded(text);
  const isFolded: boolean = isFoldable && !isExpanded;

  return (
    <div data-testid={AI_CONTEXT_TEST_IDS.view} className="min-w-0">
      <div
        id={bodyId}
        className={`relative min-w-0 break-words ${isFolded ? FOLDED_CLASS_NAME : ""}`}
      >
        <LazyMarkdownViewer text={text} />
        {isFolded ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent"
          />
        ) : (
          <></>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {isFoldable ? (
          <button
            type="button"
            data-testid={AI_CONTEXT_TEST_IDS.toggle}
            aria-expanded={isExpanded}
            aria-controls={bodyId}
            className="rounded font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
          >
            {translator.translateText(
              isExpanded
                ? AI_CONTEXT_CARD_COPY.showLessText
                : AI_CONTEXT_CARD_COPY.showAllText,
            )}
          </button>
        ) : (
          <></>
        )}
        <span data-testid={AI_CONTEXT_TEST_IDS.length}>
          {describeAiContextLength(length, translator)}
        </span>
      </div>
    </div>
  );
};

export default AiContextView;
