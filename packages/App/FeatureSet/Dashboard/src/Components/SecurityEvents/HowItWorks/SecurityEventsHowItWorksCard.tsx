import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { DOCS_URL } from "Common/UI/Config";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityEventSeverityPill from "../SecurityEventSeverityPill";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  SecurityEventsGuideSection,
  SecurityEventsGuideStep,
  SecurityEventsGuideTemplate,
  getGuideSection,
} from "./SecurityEventsGuide";

/*
 * "How does this work?" answered on the page itself, above the table.
 *
 * The table header already had a help (?) icon, but a small icon is easy
 * to miss, and a customer staring at an empty rules table is exactly the
 * one who needs the explanation. So the card shows the pipeline — how an
 * event becomes an alert — and the level-to-severity mapping inline, and
 * opens the full guide in a modal, one tab per topic.
 *
 * Someone who has read it can hide it. The choice is remembered per guide
 * in this browser; hidden, the card shrinks to its title row, so the
 * guide stays one click away.
 *
 * Until the reader chooses, a page whose list has rows opens on the list:
 * the card starts as its title row (listItemCount). The explanation is for
 * whoever looks at an empty list; an analyst tuning forty rules met the
 * same 650 pixels of steps above them on every visit.
 *
 * Everything the card draws is looked up in the reader's language: the
 * guide's words are en.json keys, and a sentence with numbers in it is a
 * template the numbers are written into the reader's way. The full guide's
 * tabs are named in that language too; their markdown is the documentation
 * and stays English, with the docs page a click away.
 */

export interface ComponentProps {
  guide: SecurityEventsGuide;
  /*
   * How many rows the list under the card has: null while it is read. The
   * card then opens by itself only on an empty list, and stays folded while
   * the list is read. Left out, the card opens. Either way the reader's own
   * Show or Hide wins, remembered in this browser.
   */
  listItemCount?: number | null | undefined;
}

export function getHowItWorksCollapsedStorageKey(guideId: string): string {
  return `security-events-how-it-works-collapsed-${guideId}`;
}

/*
 * The reader's own choice: true hidden, false shown, null when they have
 * not chosen. Storage can be unavailable (private windows, blocked site
 * data) or hold anything; either way it reads as no choice, never as
 * broken.
 */
export function readHowItWorksChoice(storageKey: string): boolean | null {
  try {
    const value: unknown = LocalStorage.getItem(storageKey);

    if (value === true || value === "true") {
      return true;
    }

    if (value === false || value === "false") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

function writeHowItWorksChoice(storageKey: string, isCollapsed: boolean): void {
  try {
    LocalStorage.setItem(storageKey, isCollapsed);
  } catch {
    // Not remembering the choice is fine; the toggle still works.
  }
}

/*
 * Whether the card is folded: as the reader chose, else folded over a list
 * with rows or one still being read, and open over an empty list - or
 * open, when the page does not say what its list holds.
 */
export function isHowItWorksCollapsed(data: {
  choice: boolean | null;
  listItemCount: number | null | undefined;
}): boolean {
  if (data.choice !== null) {
    return data.choice;
  }

  if (data.listItemCount === undefined) {
    return false;
  }

  return data.listItemCount === null || data.listItemCount > 0;
}

const SecurityEventsHowItWorksCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { guide } = props;
  const translator: Translator = useTranslator();
  const storageKey: string = getHowItWorksCollapsedStorageKey(guide.id);

  // A guide's words in the reader's language, or as written while it has none.
  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const translateGuideTemplate: (
    guideTemplate: SecurityEventsGuideTemplate,
  ) => string = (guideTemplate: SecurityEventsGuideTemplate): string => {
    const values: Record<string, string> = {};

    for (const [name, value] of Object.entries(guideTemplate.values)) {
      values[name] = translator.formatNumber(value);
    }

    return translator.translateTemplate(guideTemplate.sentence, values);
  };

  const describeStep: (step: SecurityEventsGuideStep) => string = (
    step: SecurityEventsGuideStep,
  ): string => {
    return step.descriptionTemplate
      ? translateGuideTemplate(step.descriptionTemplate)
      : say(step.description);
  };

  const labelLevel: (level: SecurityEventsGuideLevel) => string = (
    level: SecurityEventsGuideLevel,
  ): string => {
    if (level.labelTemplate) {
      return translateGuideTemplate(level.labelTemplate);
    }

    return level.isLabelAValue ? level.label : say(level.label);
  };

  const [choice, setChoice] = useState<boolean | null>(() => {
    return readHowItWorksChoice(storageKey);
  });

  const isCollapsed: boolean = isHowItWorksCollapsed({
    choice,
    listItemCount: props.listItemCount,
  });

  // The section the guide modal opened on; null while it is closed.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const idPrefix: string = useId();
  const titleId: string = `${idPrefix}-title`;
  const bodyId: string = `${idPrefix}-body`;

  const toggleCollapsed: () => void = (): void => {
    const next: boolean = !isCollapsed;
    setChoice(next);
    writeHowItWorksChoice(storageKey, next);
  };

  const openGuide: (sectionId?: string) => void = (
    sectionId?: string,
  ): void => {
    const section: SecurityEventsGuideSection | undefined =
      (sectionId && getGuideSection(guide, sectionId)) || guide.sections[0];

    if (section) {
      setOpenSectionId(section.id);
    }
  };

  const closeGuide: () => void = (): void => {
    setOpenSectionId(null);
  };

  const renderStep: (
    step: SecurityEventsGuideStep,
    index: number,
  ) => ReactElement = (
    step: SecurityEventsGuideStep,
    index: number,
  ): ReactElement => {
    return (
      <li
        key={step.title}
        className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4"
        data-testid="how-it-works-step"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-gray-200">
          <Icon icon={step.icon} className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {translator.translateTemplate("Step {{number}}", {
              number: translator.formatNumber(index + 1),
            })}
          </p>
          <h3 className="text-sm font-semibold text-gray-900">
            {say(step.title)}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            {describeStep(step)}
          </p>
        </div>
      </li>
    );
  };

  const renderLevels: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 rounded-lg border border-gray-100 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            {say(guide.levels.title)}
          </h3>
          <button
            type="button"
            className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              openGuide(guide.levels.sectionId);
            }}
            data-testid="how-it-works-levels-link"
          >
            {say(guide.levels.linkText)}
          </button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          {say(guide.levels.description)}
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {guide.levels.items.map(
            (level: SecurityEventsGuideLevel): ReactElement => {
              return (
                <li
                  key={level.label}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5"
                  data-testid="how-it-works-level"
                >
                  <span className="text-xs font-medium text-gray-700">
                    {labelLevel(level)}
                  </span>
                  <Icon
                    icon={IconProp.ArrowRight}
                    className="h-3 w-3 text-gray-400"
                  />
                  <SecurityEventSeverityPill
                    severityName={level.severity}
                    size={PillSize.Small}
                  />
                </li>
              );
            },
          )}
        </ul>
      </div>
    );
  };

  const renderGuideModal: () => ReactElement | null =
    (): ReactElement | null => {
      if (openSectionId === null) {
        return null;
      }

      const initialSection: SecurityEventsGuideSection | undefined =
        getGuideSection(guide, openSectionId);

      const tabs: Array<Tab> = guide.sections.map(
        (section: SecurityEventsGuideSection): Tab => {
          return {
            name: say(section.title),
            children: (
              <div
                className="pb-2"
                data-testid={`how-it-works-section-${section.id}`}
              >
                <MarkdownViewer text={section.markdown} />
              </div>
            ),
          };
        },
      );

      return (
        <Modal
          title={say(guide.guideTitle)}
          description={say(guide.guideDescription)}
          modalWidth={ModalWidth.Large}
          onClose={closeGuide}
          closeButtonText={say("Close")}
          leftFooterElement={
            <Link
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              openInNewTab={true}
              to={URL.fromString(
                `${DOCS_URL.toString()}${guide.documentationPath}`,
              )}
            >
              <>
                <Icon icon={IconProp.ExternalLink} className="h-4 w-4" />
                {say("Full documentation")}
              </>
            </Link>
          }
        >
          <Tabs
            tabs={tabs}
            initialTabName={
              initialSection ? say(initialSection.title) : undefined
            }
            onTabChange={() => {
              // The selected tab is local to the open modal.
            }}
          />
        </Modal>
      );
    };

  return (
    <section
      className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm"
      aria-labelledby={titleId}
      data-testid={`how-it-works-${guide.id}`}
    >
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50">
            <Icon
              icon={IconProp.BookOpen}
              className="h-5 w-5 text-indigo-600"
            />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              {say(guide.title)}
            </h2>
            {!isCollapsed && (
              <p className="mt-0.5 text-sm leading-relaxed text-gray-500">
                {say(guide.summary)}
              </p>
            )}
          </div>
        </div>
        {/*
          Under the summary on a phone, at the right edge, as a card header's
          actions always are; beside the title from sm up.
        */}
        <div className="flex flex-shrink-0 items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              openGuide();
            }}
            data-testid="how-it-works-open-guide"
          >
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            {say("Read the full guide")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-expanded={!isCollapsed}
            aria-controls={bodyId}
            onClick={toggleCollapsed}
            data-testid="how-it-works-toggle"
          >
            {say(isCollapsed ? "Show" : "Hide")}
            <Icon
              icon={isCollapsed ? IconProp.ChevronDown : IconProp.ChevronUp}
              className="h-4 w-4"
            />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div id={bodyId} className="border-t border-gray-100 px-5 py-5">
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {guide.steps.map(renderStep)}
          </ol>
          {renderLevels()}
        </div>
      )}

      {renderGuideModal()}
    </section>
  );
};

export default SecurityEventsHowItWorksCard;
