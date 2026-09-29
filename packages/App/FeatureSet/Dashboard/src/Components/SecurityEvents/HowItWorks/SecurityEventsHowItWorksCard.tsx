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
import SecurityEventSeverityPill from "../SecurityEventSeverityPill";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  SecurityEventsGuideSection,
  SecurityEventsGuideStep,
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
 */

export interface ComponentProps {
  guide: SecurityEventsGuide;
}

export function getHowItWorksCollapsedStorageKey(guideId: string): string {
  return `security-events-how-it-works-collapsed-${guideId}`;
}

/*
 * Storage can be unavailable (private windows, blocked site data) or hold
 * anything; either way the card falls back to expanded, never to broken.
 */
function readIsCollapsed(storageKey: string): boolean {
  try {
    const value: unknown = LocalStorage.getItem(storageKey);
    return value === true || value === "true";
  } catch {
    return false;
  }
}

function writeIsCollapsed(storageKey: string, isCollapsed: boolean): void {
  try {
    if (isCollapsed) {
      LocalStorage.setItem(storageKey, true);
    } else {
      LocalStorage.removeItem(storageKey);
    }
  } catch {
    // Not remembering the choice is fine; the toggle still works.
  }
}

const SecurityEventsHowItWorksCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { guide } = props;
  const storageKey: string = getHowItWorksCollapsedStorageKey(guide.id);

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return readIsCollapsed(storageKey);
  });

  // The section the guide modal opened on; null while it is closed.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const idPrefix: string = useId();
  const titleId: string = `${idPrefix}-title`;
  const bodyId: string = `${idPrefix}-body`;

  const toggleCollapsed: () => void = (): void => {
    const next: boolean = !isCollapsed;
    setIsCollapsed(next);
    writeIsCollapsed(storageKey, next);
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
            Step {index + 1}
          </p>
          <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            {step.description}
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
            {guide.levels.title}
          </h3>
          <button
            type="button"
            className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              openGuide(guide.levels.sectionId);
            }}
            data-testid="how-it-works-levels-link"
          >
            How {guide.levels.title.toLowerCase()} are chosen
          </button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          {guide.levels.description}
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
                    {level.label}
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
            name: section.title,
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
          title={guide.guideTitle}
          description={guide.guideDescription}
          modalWidth={ModalWidth.Large}
          onClose={closeGuide}
          closeButtonText="Close"
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
                Full documentation
              </>
            </Link>
          }
        >
          <Tabs
            tabs={tabs}
            initialTabName={initialSection?.title}
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
              {guide.title}
            </h2>
            {!isCollapsed && (
              <p className="mt-0.5 text-sm leading-relaxed text-gray-500">
                {guide.summary}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              openGuide();
            }}
            data-testid="how-it-works-open-guide"
          >
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            Read the full guide
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-expanded={!isCollapsed}
            aria-controls={bodyId}
            onClick={toggleCollapsed}
            data-testid="how-it-works-toggle"
          >
            {isCollapsed ? "Show" : "Hide"}
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
