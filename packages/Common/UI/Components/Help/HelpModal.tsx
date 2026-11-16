import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import WasThisClear from "../Feedback/WasThisClear";
import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "../Modal/Modal";
import { getHelpFeedbackTopic } from "./HelpContent";
import readHelpDocument, { HelpDocument, HelpSection } from "./HelpDocument";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * THE HELP DIALOG (#8889).
 *
 * Every help (?) a list offers, and every "how it works" guide, opens this
 * one dialog. It used to be a 1280px-wide page of markdown - six headings,
 * lines of two hundred characters, a rule between every part - read top to
 * bottom with nothing to say what was further down.
 *
 *   ┌ How SLOs Work                                        × ┐
 *   │ Reliability targets measured from your monitors…      │
 *   ├────────────────────────────────────────────────────────┤
 *   │ ┌ IN SHORT ─────────────────────────────────────────┐  │
 *   │ │ An SLO is a target such as 99.9% uptime…          │  │
 *   │ └───────────────────────────────────────────────────┘  │
 *   │                                         Expand all    │
 *   │ ▾ Set Up an SLO                                        │
 *   │     1. Create the SLO …                                │
 *   │ ▸ Error Budget and Burn Rate                           │
 *   │ ▸ Statuses                                             │
 *   │                                Was this clear? 👍 👎   │
 *   ├────────────────────────────────────────────────────────┤
 *   │ 📖 Full documentation ↗                        Close   │
 *   └────────────────────────────────────────────────────────┘
 *
 *   - What it says in short comes first: the document's lead, read in ten
 *     seconds.
 *   - Then its topics (HelpDocument: its "##" headings), each a button that
 *     opens and closes it. A short document - one or two topics - opens
 *     whole; a longer one opens its first topic, which says what to do, and
 *     lists the rest, so nobody scrolls past what they came for.
 *     Expand all opens every topic, for someone who reads it all.
 *   - The topics are an accordion as WAI-ARIA describes it: each heading's
 *     button says whether its topic is open (aria-expanded), and ↑ ↓ Home
 *     End move between them.
 *   - Its words are read at a width made for reading (ModalWidth.Medium),
 *     not across the whole screen.
 *   - The documentation it summarizes is one click away, in a new tab, and
 *     "Was this clear?" asks whether it was (where OneUptime may ask).
 *
 * The title and the line under it are looked up in the reader's language;
 * the document is English, as the docs are.
 */

export const HELP_MODAL_TEST_ID: string = "help-modal";
export const HELP_MODAL_SUMMARY_TEST_ID: string = "help-modal-summary";
export const HELP_MODAL_SECTIONS_TEST_ID: string = "help-modal-sections";
export const HELP_MODAL_EXPAND_ALL_TEST_ID: string = "help-modal-expand-all";
export const HELP_MODAL_DOCS_LINK_TEST_ID: string = "help-modal-docs-link";

export const getHelpSectionButtonTestId: (id: string) => string = (
  id: string,
): string => {
  return `help-modal-section-button-${id}`;
};

export const getHelpSectionBodyTestId: (id: string) => string = (
  id: string,
): string => {
  return `help-modal-section-body-${id}`;
};

export const HELP_SUMMARY_LABEL: string = translationKey("In short");
export const HELP_DOCS_LINK_TEXT: string = translationKey("Full documentation");
export const HELP_EXPAND_ALL_TEXT: string = translationKey("Expand all");
export const HELP_COLLAPSE_ALL_TEXT: string = translationKey("Collapse all");

// A document of this many topics or fewer opens whole.
export const HELP_TOPICS_OPEN_TOGETHER: number = 2;

/*
 * Which topics start open: the one an opener points at, else every topic
 * of a short document, else the first - what to do comes first.
 */
export const getInitiallyOpenHelpSections: (data: {
  sections: Array<HelpSection>;
  initialSectionId?: string | undefined;
}) => Array<string> = (data: {
  sections: Array<HelpSection>;
  initialSectionId?: string | undefined;
}): Array<string> => {
  const ids: Array<string> = data.sections.map(
    (section: HelpSection): string => {
      return section.id;
    },
  );

  if (data.initialSectionId && ids.includes(data.initialSectionId)) {
    return [data.initialSectionId];
  }

  if (ids.length <= HELP_TOPICS_OPEN_TOGETHER) {
    return ids;
  }

  return ids.slice(0, 1);
};

export interface ComponentProps {
  // In English, looked up here - unless isTitleTranslated says otherwise.
  title: string;
  isTitleTranslated?: boolean | undefined;
  // One line under the title, in English: looked up too.
  description?: string | undefined;
  /*
   * The document: markdown with a lead and "##" topics (HelpContent), or
   * one already in its parts - a guide whose topics' titles are in the
   * reader's words. One of the two.
   */
  markdown?: string | undefined;
  document?: HelpDocument | undefined;
  // The page of the docs this summarizes, opened in a new tab.
  documentationLink?: Route | URL | undefined;
  // The topic to open with, for an opener that points at one.
  initialSectionId?: string | undefined;
  /*
   * Where "Was this clear?" files its answers: made from the English title
   * when left out (getHelpFeedbackTopic).
   */
  feedbackTopic?: string | undefined;
  onClose: () => void;
}

const HelpModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const helpDocument: HelpDocument = useMemo((): HelpDocument => {
    return props.document || readHelpDocument(props.markdown || "");
  }, [props.document, props.markdown]);

  const sections: Array<HelpSection> = helpDocument.sections;

  const [openSectionIds, setOpenSectionIds] = useState<Array<string>>(
    (): Array<string> => {
      return getInitiallyOpenHelpSections({
        sections: sections,
        initialSectionId: props.initialSectionId,
      });
    },
  );

  const baseId: string = useId();
  const summaryLabelId: string = `${baseId}-summary`;
  const buttonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());

  const getButtonId: (section: HelpSection) => string = (
    section: HelpSection,
  ): string => {
    return `${baseId}-button-${section.id}`;
  };

  const getBodyId: (section: HelpSection) => string = (
    section: HelpSection,
  ): string => {
    return `${baseId}-body-${section.id}`;
  };

  /*
   * A topic an opener pointed at may be far down a long document: it is
   * brought into view once, as the dialog opens. The first topic is in view
   * already, under what the document says in short, which stays in sight.
   */
  const initialSectionId: string | undefined = props.initialSectionId;

  useEffect(() => {
    if (!initialSectionId || sections[0]?.id === initialSectionId) {
      return;
    }

    const button: HTMLButtonElement | undefined =
      buttonRefs.current.get(initialSectionId);

    if (button && typeof button.scrollIntoView === "function") {
      button.scrollIntoView({ block: "start" });
    }
  }, [initialSectionId]);

  const isOpen: (section: HelpSection) => boolean = (
    section: HelpSection,
  ): boolean => {
    return openSectionIds.includes(section.id);
  };

  const toggle: (section: HelpSection) => void = (
    section: HelpSection,
  ): void => {
    setOpenSectionIds((current: Array<string>): Array<string> => {
      if (current.includes(section.id)) {
        return current.filter((id: string): boolean => {
          return id !== section.id;
        });
      }

      return [...current, section.id];
    });
  };

  const areAllOpen: boolean = sections.every((section: HelpSection) => {
    return openSectionIds.includes(section.id);
  });

  const toggleAll: () => void = (): void => {
    setOpenSectionIds(
      areAllOpen
        ? []
        : sections.map((section: HelpSection): string => {
            return section.id;
          }),
    );
  };

  /*
   * ↑ and ↓ step from one topic's heading to the next, Home and End to the
   * first and the last (WAI-ARIA's accordion). Enter and Space open and
   * close it, as any button does.
   */
  const onSectionKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    position: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    position: number,
  ): void => {
    let target: number | null = null;

    if (event.key === "ArrowDown") {
      target = (position + 1) % sections.length;
    } else if (event.key === "ArrowUp") {
      target = (position - 1 + sections.length) % sections.length;
    } else if (event.key === "Home") {
      target = 0;
    } else if (event.key === "End") {
      target = sections.length - 1;
    }

    if (target === null) {
      return;
    }

    const targetSection: HelpSection | undefined = sections[target];
    const button: HTMLButtonElement | undefined = targetSection
      ? buttonRefs.current.get(targetSection.id)
      : undefined;

    if (button) {
      event.preventDefault();
      button.focus();
    }
  };

  const feedbackTopic: string =
    props.feedbackTopic || getHelpFeedbackTopic(props.title);

  const renderSummary: () => ReactElement | null = (): ReactElement | null => {
    if (!helpDocument.summary) {
      return null;
    }

    /*
     * A document with no topics is all lead: it is the help itself, not a
     * summary of it, so it is drawn as text with no "In short" over it.
     */
    if (sections.length === 0) {
      return (
        <div
          className="text-gray-700 [&_p:first-child]:mt-0"
          data-testid={HELP_MODAL_SUMMARY_TEST_ID}
        >
          <MarkdownViewer text={helpDocument.summary} />
        </div>
      );
    }

    return (
      <section
        aria-labelledby={summaryLabelId}
        className="rounded-lg bg-indigo-50/60 px-4 py-3.5 ring-1 ring-inset ring-indigo-100"
        data-testid={HELP_MODAL_SUMMARY_TEST_ID}
      >
        <h3
          id={summaryLabelId}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700"
        >
          <Icon icon={IconProp.LightBulb} className="h-4 w-4 flex-none" />
          {say(HELP_SUMMARY_LABEL)}
        </h3>
        {/*
         * A little larger than the topics' text: it is the one part
         * everybody reads.
         */}
        <div className="mt-1 [&_p:first-child]:mt-0 [&_p]:text-[15px] [&_p]:leading-7">
          <MarkdownViewer text={helpDocument.summary} />
        </div>
      </section>
    );
  };

  const renderSection: (
    section: HelpSection,
    position: number,
  ) => ReactElement = (
    section: HelpSection,
    position: number,
  ): ReactElement => {
    const isSectionOpen: boolean = isOpen(section);

    return (
      <div key={section.id}>
        <h3 className="m-0">
          {/*
           * The whole row is the button, and its words line up with the
           * topic's text under them (the body's start padding is the
           * button's, the chevron's width and the gap after it).
           */}
          <button
            type="button"
            id={getButtonId(section)}
            ref={(element: HTMLButtonElement | null) => {
              if (element) {
                buttonRefs.current.set(section.id, element);
              } else {
                buttonRefs.current.delete(section.id);
              }
            }}
            aria-expanded={isSectionOpen}
            aria-controls={getBodyId(section)}
            data-testid={getHelpSectionButtonTestId(section.id)}
            onClick={() => {
              toggle(section);
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
              onSectionKeyDown(event, position);
            }}
            className="group flex w-full items-center gap-2.5 px-3 py-3 text-start text-sm font-semibold leading-6 text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-4"
          >
            <Icon
              icon={IconProp.ChevronRight}
              className={`h-4 w-4 flex-none text-gray-400 transition-transform duration-150 motion-reduce:transition-none ${
                isSectionOpen ? "rotate-90" : ""
              }`}
            />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {section.title}
            </span>
          </button>
        </h3>
        <div
          id={getBodyId(section)}
          role="region"
          aria-labelledby={getButtonId(section)}
          hidden={!isSectionOpen}
          data-testid={getHelpSectionBodyTestId(section.id)}
          className="pb-4 pe-3 ps-[2.375rem] text-gray-700 sm:pe-4 sm:ps-[2.625rem] [&_p:first-child]:mt-0"
        >
          {isSectionOpen ? <MarkdownViewer text={section.markdown} /> : <></>}
        </div>
      </div>
    );
  };

  const renderSections: () => ReactElement | null = (): ReactElement | null => {
    if (sections.length === 0) {
      return null;
    }

    return (
      <div>
        {sections.length > HELP_TOPICS_OPEN_TOGETHER ? (
          <div className="mb-1.5 flex justify-end">
            <button
              type="button"
              aria-expanded={areAllOpen}
              onClick={toggleAll}
              data-testid={HELP_MODAL_EXPAND_ALL_TEST_ID}
              className="rounded-md px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {say(areAllOpen ? HELP_COLLAPSE_ALL_TEXT : HELP_EXPAND_ALL_TEXT)}
            </button>
          </div>
        ) : (
          <></>
        )}
        <div
          className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white"
          data-testid={HELP_MODAL_SECTIONS_TEST_ID}
        >
          {sections.map(renderSection)}
        </div>
      </div>
    );
  };

  const docsLink: ReactElement | undefined = props.documentationLink ? (
    <Link
      to={props.documentationLink}
      openInNewTab={true}
      dataTestId={HELP_MODAL_DOCS_LINK_TEST_ID}
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Icon icon={IconProp.BookOpen} className="h-4 w-4 flex-none" />
      <span>{say(HELP_DOCS_LINK_TEXT)}</span>
      <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5 flex-none" />
    </Link>
  ) : undefined;

  return (
    <Modal
      title={props.title}
      isTitleTranslated={props.isTitleTranslated}
      description={props.description}
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      closeButtonText="Close"
      leftFooterElement={docsLink}
      /*
       * Something to read, not a form: the focus starts on the dialog, so
       * the first topic's heading does not light up, and Tab goes on from
       * there.
       */
      isInitialFocusOnDialog={true}
    >
      <div className="space-y-5" data-testid={HELP_MODAL_TEST_ID}>
        {renderSummary()}
        {renderSections()}
        <WasThisClear topic={feedbackTopic} className="justify-end" />
      </div>
    </Modal>
  );
};

export default HelpModal;
