import Tippy from "@tippyjs/react";
import { Instance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light-border.css";
import "tippy.js/animations/shift-away-subtle.css";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import IconProp from "../../../Types/Icon/IconProp";
import {
  GlossaryDefinition,
  LoadedGlossary,
  getGlossaryTermUrl,
  loadGlossary,
  shortenDefinition,
} from "../../Utils/Glossary";
import { wasLastInputFromKeyboard } from "../../Utils/InputModality";
import { withProductText } from "../../Utils/ProductText";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import WasThisClear from "../Feedback/WasThisClear";
import { TOOLTIP_PLUGINS } from "../Tooltip/TooltipEscape";
import {
  DefinitionPlace,
  DefinitionPlaceContext,
} from "./DefinitionsDrawnAfter";
import {
  DEFINED_TERM_CLASS_NAME,
  DEFINED_TERM_TEST_ID,
  keepDefinedTermKeys,
  keepDefinedTermPress,
} from "./DefinedTermWord";

/*
 * A WORD WITH ITS DEFINITION.
 *
 * "Criteria", "Probe", "Escalation rule": words a newcomer trips on, and
 * until now the only way to ask what one meant was to leave the page. A
 * defined term draws the word with a dotted underline; hovering it, giving
 * it the keyboard's focus or tapping it opens a small popover with the
 * term's entry from the docs' Glossary (#6818) - the same sentences the
 * Glossary page shows, in the reader's language (Utils/Glossary) - and
 * Read more, which opens the term on that page.
 *
 * Mark a word where a page first uses it - a form field's title (the
 * field's `glossaryTerm`), a card's title (`titleGlossaryTerm`), a line
 * of help - never every time it comes up. A page full of dotted lines is
 * worse than none: the Dashboard's GlossaryTermsPerPage guard holds every
 * file to three marked terms, each once.
 *
 * The word is a real button, so Tab reaches it and a screen reader hears
 * the definition with it (aria-describedby). A press is its own: it does
 * not tick the box a label belongs to, submit a form or follow a card's
 * link. A press keeps the popover open while the pointer moves on to read
 * it - on a phone the finger lifts at once - and the next press, a press
 * anywhere else or Escape puts it away.
 *
 * A form field's, a card's and a table column's titles draw it through
 * LazyDefinedTerm, so the pages that never mark a word - the sign-in pages,
 * a status page, a public dashboard - do not load it.
 */

export interface ComponentProps {
  // The term, by its Glossary anchor.
  term: GlossaryTerm;
  // The word as the page draws it, already in the reader's language.
  children: ReactNode;
  dataTestId?: string | undefined;
  /*
   * Where the definition is drawn, when not beside its word: for a word
   * inside something its words name. A form field's title names its field
   * (Forms/Fields/FieldLabel), and a field is named by every word inside
   * its title, so a definition drawn there was read out as part of the
   * field's name while it showed. The place comes right after the word in
   * the page's order, so Tab still goes from the word to Read more. A word
   * in a heading is given one by the heading (DefinitionsDrawnAfter).
   */
  popoverPlace?: React.RefObject<HTMLElement> | undefined;
}

// The word, as its place draws it too (DefinedTermWord).
export { DEFINED_TERM_CLASS_NAME, DEFINED_TERM_TEST_ID };

export const DEFINED_TERM_POPOVER_TEST_ID: string = "defined-term-popover";
export const DEFINED_TERM_DEFINITION_TEST_ID: string =
  "defined-term-definition";
export const DEFINED_TERM_READ_MORE_TEST_ID: string = "defined-term-read-more";

// The link to the term on the Glossary page.
export const DEFINED_TERM_READ_MORE_TEXT: string = translationKey("Read more");
// While the definition is on its way.
export const DEFINED_TERM_LOADING_TEXT: string = translationKey(
  "Loading the definition…",
);
// When the definition cannot be read: the Glossary page still can.
export const DEFINED_TERM_UNAVAILABLE_TEXT: string = translationKey(
  "Read what this means in the glossary",
);

/*
 * The popover is drawn inside its word's parent, so it would take on that
 * parent's type: a card title's weight, or the capitals and wide letter
 * spacing of a row name drawn in small capitals ("When this goes down"
 * names its On-call policy row so). A definition reads in the popover's
 * own type, whatever its word is in.
 */
export const DEFINED_TERM_POPOVER_CLASS_NAME: string =
  "w-72 max-w-full space-y-1.5 px-1 py-1 text-start text-sm font-normal normal-case tracking-normal focus:outline-none";

// The topic a definition's "Was this clear?" is kept under: "term.criteria".
export const getDefinedTermFeedbackTopic: (term: GlossaryTerm) => string = (
  term: GlossaryTerm,
): string => {
  return `term.${term}`;
};

type ReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; glossary: LoadedGlossary }
  | { status: "failed" };

const FOCUS_EVENTS: Array<string> = ["focus", "focusin"];

interface PopoverProps {
  term: GlossaryTerm;
  read: ReadState;
  language: string;
  // Called once what the popover shows has changed size.
  onResize: () => void;
  // Called when the focus leaves the popover for somewhere else.
  onFocusLeave: (to: Element | null) => void;
}

const DefinedTermPopover: FunctionComponent<PopoverProps> = (
  props: PopoverProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: GlossaryDefinition | undefined =
    props.read.status === "ready"
      ? props.read.glossary.definitions.get(props.term)
      : undefined;

  useEffect(() => {
    props.onResize();
  }, [props.read.status, Boolean(definition)]);

  const readMoreUrl: string = getGlossaryTermUrl(props.term, props.language);

  return (
    <div
      data-testid={DEFINED_TERM_POPOVER_TEST_ID}
      /*
       * The product's own words, wherever the definition is drawn
       * (Utils/ProductText): a recording of the first-run pages shows it as
       * written after a heading or a field's title, outside their marked
       * words, as much as beside its word.
       */
      className={withProductText(DEFINED_TERM_POPOVER_CLASS_NAME)}
      onClick={(event: React.MouseEvent<HTMLDivElement>): void => {
        /*
         * The popover is drawn beside its word, which can be inside a
         * <label> or a clickable card, and a click inside it reaches what
         * its word is drawn in wherever it is placed (React hands it on
         * through the portal): a click on its words must not tick that
         * label's box or open that card. A click on Read more still
         * follows the link.
         */
        event.stopPropagation();

        if (!(event.target as Element).closest("a")) {
          event.preventDefault();
        }
      }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>): void => {
        const to: Element | null = event.relatedTarget as Element | null;

        if (!to || !event.currentTarget.contains(to)) {
          props.onFocusLeave(to);
        }
      }}
    >
      {definition && props.read.status === "ready" ? (
        /*
         * In the language the definition is written in: English for a
         * Dashboard language the docs have no copy of, read left to right
         * on a page read from the right.
         */
        <div
          lang={props.read.glossary.language}
          dir={props.read.glossary.direction}
          className="space-y-1"
        >
          <p className="font-semibold text-gray-900">{definition.term}</p>
          <p
            data-testid={DEFINED_TERM_DEFINITION_TEST_ID}
            className="leading-5 text-gray-600"
          >
            {shortenDefinition(definition.definition)}
          </p>
        </div>
      ) : (
        <p className="leading-5 text-gray-500">
          {props.read.status === "failed" ||
          (props.read.status === "ready" && !definition)
            ? translator.translateText(DEFINED_TERM_UNAVAILABLE_TEXT)
            : translator.translateText(DEFINED_TERM_LOADING_TEXT)}
        </p>
      )}
      <a
        href={readMoreUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={DEFINED_TERM_READ_MORE_TEST_ID}
        className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:underline"
      >
        {translator.translateText(DEFINED_TERM_READ_MORE_TEXT)}
        <Icon
          icon={IconProp.ExternalLink}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
      </a>
      {/*
       * Whether the definition helped (#6832), once it is there to judge:
       * a quiet thumb up or down, only where OneUptime may ask this person.
       */}
      {definition && props.read.status === "ready" ? (
        <WasThisClear
          topic={getDefinedTermFeedbackTopic(props.term)}
          className="border-t border-gray-100 pt-1.5"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

const DefinedTerm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const triggerId: string = useId();
  // The word itself, which names the button.
  const wordId: string = `${triggerId}-word`;
  const [read, setRead] = useState<ReadState>({ status: "idle" });
  const instanceRef: React.MutableRefObject<Instance | null> =
    useRef<Instance | null>(null);
  // The event that last asked the popover to show.
  const lastTriggerRef: React.MutableRefObject<string> = useRef<string>("");
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  /*
   * The place right after the heading this word is in (a card's title,
   * DefinitionsDrawnAfter), asked for now that the word can show its
   * definition - unless the word was given a place of its own.
   */
  const headingPlace: DefinitionPlace | undefined = useContext(
    DefinitionPlaceContext,
  );

  useEffect(() => {
    if (!props.popoverPlace) {
      headingPlace?.ask();
    }
  }, [headingPlace, props.popoverPlace]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // A language switch reads that language's definitions the next time.
  useEffect(() => {
    setRead({ status: "idle" });
  }, [translator.language]);

  const startReading: () => void = (): void => {
    if (read.status === "loading" || read.status === "ready") {
      return;
    }

    setRead({ status: "loading" });

    loadGlossary(translator.language)
      .then((glossary: LoadedGlossary): void => {
        if (isMountedRef.current) {
          setRead({ status: "ready", glossary: glossary });
        }
      })
      .catch((): void => {
        if (isMountedRef.current) {
          setRead({ status: "failed" });
        }
      });
  };

  /*
   * An interactive popover is placed in its word's parent, at its end: the
   * span of its own puts it right after the word, so Tab goes from the word
   * to Read more, and not first through what follows the word. A place
   * given for it (popoverPlace) comes right after the word too, and so does
   * a heading's, right after the heading.
   */
  return (
    <span className="inline">
      <Tippy
        appendTo={(reference: Element): Element => {
          return (
            props.popoverPlace?.current ||
            headingPlace?.element.current ||
            (reference.parentNode as Element)
          );
        }}
        content={
          <DefinedTermPopover
            term={props.term}
            read={read}
            language={translator.language}
            onResize={() => {
              void instanceRef.current?.popperInstance?.update();
            }}
            onFocusLeave={(to: Element | null) => {
              const instance: Instance | null = instanceRef.current;

              /*
               * Tab past Read more puts it away. Back to the word, or onto
               * the popover's own frame (a click on its padding), keeps it.
               */
              if (
                instance &&
                to !== instance.reference &&
                !(to && instance.popper.contains(to))
              ) {
                instance.hide();
              }
            }}
          />
        }
        plugins={TOOLTIP_PLUGINS}
        interactive={true}
        // A press keeps it; the next press, or one anywhere else, hides it.
        trigger="mouseenter focus click"
        hideOnClick={true}
        /*
         * Shown at once on hover. With a delay, a click that came before it
         * ran out was a press outside a popover not yet shown: Tippy hid it
         * and dropped the click, and a quick click on the word showed nothing.
         */
        delay={[0, 100]}
        duration={[200, 150]}
        maxWidth={320}
        placement="top"
        theme="light-border"
        animation="shift-away-subtle"
        role="dialog"
        aria={{ content: "describedby", expanded: "auto" }}
        onCreate={(instance: Instance) => {
          instanceRef.current = instance;
          // The popover is named by its word: "Criteria, dialog".
          instance.popper.firstElementChild?.setAttribute(
            "aria-labelledby",
            triggerId,
          );
        }}
        onTrigger={(_instance: Instance, event: Event) => {
          lastTriggerRef.current = event.type;
          startReading();
        }}
        onShow={(): false | undefined => {
          /*
           * Shown on focus only when the keyboard moved it there: a dialog
           * opened with the mouse focuses what is in it, and a definition
           * should not pop up there unasked.
           */
          if (
            FOCUS_EVENTS.includes(lastTriggerRef.current) &&
            !wasLastInputFromKeyboard()
          ) {
            return false;
          }

          startReading();

          return undefined;
        }}
      >
        <button
          type="button"
          id={triggerId}
          /*
           * Named by its own word. A field's <label> with no `for` (a
           * dropdown's, a picker's) takes this button for the control it
           * labels, so the button was named by that label - nothing on a
           * required field, "(Optional)" on another - and the field, named
           * by the label, could lose its title from its own name ("Probes",
           * "Incident Severity").
           */
          aria-labelledby={wordId}
          data-testid={props.dataTestId || DEFINED_TERM_TEST_ID}
          data-glossary-term={props.term}
          className={DEFINED_TERM_CLASS_NAME}
          onClick={keepDefinedTermPress}
          onKeyDown={keepDefinedTermKeys}
        >
          <span id={wordId}>{props.children}</span>
        </button>
      </Tippy>
    </span>
  );
};

export default DefinedTerm;
