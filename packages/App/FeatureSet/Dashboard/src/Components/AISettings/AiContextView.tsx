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
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * How much of the notes shows before Show more: about fourteen lines of
 * prose. The frame is held to it whenever the notes are not opened, so
 * whether they are longer can be measured against it; notes that fit are as
 * tall as they are, and nothing about them changes.
 */
export const AI_CONTEXT_FOLDED_FRAME_CLASS_NAME: string =
  "max-h-72 overflow-hidden";

/*
 * Longer notes' last visible lines fade out - a mask, so they fade into
 * whatever the card's colour is, in either theme - instead of being cut
 * through the middle.
 */
export const AI_CONTEXT_FADED_FRAME_CLASS_NAME: string =
  "[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)] [mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]";

/*
 * The notes start and end flush with the card's body: a first heading's
 * top margin would open a gap under the card's header, a last paragraph's
 * bottom margin one above the count.
 */
const FLUSH_CLASS_NAME: string =
  "[&>div>div>*:first-child]:mt-0 [&>div>div>*:last-child]:mb-0";

export interface ComponentProps {
  text: string | null | undefined;
}

/*
 * The project's AI context on its card: the notes as they read, rendered,
 * and under them how long they are and about how many tokens a model reads
 * them as. Notes taller than about fourteen lines are folded, fading out,
 * with Show more / Show less. With none: one quiet line, the card's own
 * button ("Add AI context") being the way to write it.
 */
const AiContextView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const frameId: string = useId();
  const frameRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const contentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isLong, setIsLong] = useState<boolean>(false);
  const [shownText, setShownText] = useState<string | null | undefined>(
    props.text,
  );
  const text: string = readAiContext(props.text);

  // Changed notes are a different read: they start folded.
  if (shownText !== props.text) {
    setShownText(props.text);
    setIsExpanded(false);
  }

  /*
   * Whether the notes are taller than the folded frame is measured, not
   * guessed from their length: the card runs from a phone's width to a
   * wide monitor's, and Markdown lays out its own way. The content is
   * observed as well as the frame - the frame stops growing at its cap,
   * the content does not - so a viewer that finishes loading after the
   * first paint is measured again. While open, the last measurement
   * stands, which keeps Show less on screen for the reader who opened it.
   */
  useLayoutEffect(() => {
    const frame: HTMLDivElement | null = frameRef.current;
    const content: HTMLDivElement | null = contentRef.current;

    if (!frame || !content || isExpanded) {
      return undefined;
    }

    const measure: () => void = (): void => {
      // The extra pixel absorbs sub-pixel rounding between the two heights.
      setIsLong(content.scrollHeight > frame.clientHeight + 1);
    };

    measure();

    // ResizeObserver is missing in jsdom and in older browsers.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, [isExpanded, text]);

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

  return (
    <div data-testid={AI_CONTEXT_TEST_IDS.view} className="min-w-0">
      <div
        ref={frameRef}
        id={frameId}
        data-testid={AI_CONTEXT_TEST_IDS.frame}
        className={`min-w-0 break-words ${FLUSH_CLASS_NAME} ${
          isExpanded ? "" : AI_CONTEXT_FOLDED_FRAME_CLASS_NAME
        } ${!isExpanded && isLong ? AI_CONTEXT_FADED_FRAME_CLASS_NAME : ""}`}
      >
        {/*
         * dir="auto": the notes are the team's own words, laid out by their
         * own first letter - English notes read left to right on a Persian
         * page, Persian notes right to left on an English one.
         */}
        <div ref={contentRef} dir="auto">
          <LazyMarkdownViewer text={text} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {isLong ? (
          <button
            type="button"
            data-testid={AI_CONTEXT_TEST_IDS.toggle}
            aria-expanded={isExpanded}
            aria-controls={frameId}
            className="rounded font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
          >
            {translator.translateText(
              isExpanded
                ? AI_CONTEXT_CARD_COPY.showLessText
                : AI_CONTEXT_CARD_COPY.showMoreText,
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
