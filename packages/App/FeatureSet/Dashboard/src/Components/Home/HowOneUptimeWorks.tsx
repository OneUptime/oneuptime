import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import IconProp from "Common/Types/Icon/IconProp";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Navigation from "Common/UI/Utils/Navigation";
import UiAnalytics from "Common/UI/Utils/Analytics";
import {
  CORE_CONCEPTS_DOCS_PAGE,
  GLOSSARY_INDEX_DOCS_PAGE,
  getDocsPageUrl,
} from "Common/UI/Utils/Glossary";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * OneUptime ships dozens of products, and a new user cannot tell which of them
 * they need or how they relate. This answers that in a few lines: the four
 * core products, in the order a problem flows through them; what feeds that
 * loop (telemetry and infrastructure, each word with its definition); that
 * everything else is optional and lives in the Products menu; and where the
 * docs explain it all (Core Concepts, the Glossary).
 *
 * It is drawn in two places: inside the Welcome checklist on Home, for a new
 * project, and on its own in a dialog (HowOneUptimeWorksDialog) that Help
 * and Home open at any time, however old the project.
 *
 * Strings are English literals looked up as flat keys in the locale files
 * (useTranslateValue), the same convention the rest of the dashboard uses.
 */

export interface HowItWorksStep {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  iconClassName: string;
  pageMap: PageMap;
}

export const HOW_IT_WORKS_TITLE: string = "How OneUptime works";

export const HOW_IT_WORKS_FOOTNOTE: string =
  "That is the core. Logs, metrics, traces, infrastructure and everything else are optional — find them under Products when you need them.";

/*
 * What feeds the loop, under the four steps. The two words are defined
 * terms: what telemetry and infrastructure are is the Glossary's to say.
 */
export const HOW_IT_WORKS_FEEDS: string = translationKey(
  "{{telemetry}} and {{infrastructure}} feed the loop: rules on your logs, metrics and traces, or on your hosts, clusters and clouds, open incidents and alerts too.",
);

/*
 * The words the dashboard already names them by (the Products menu's
 * Infrastructure; French writes it as English does).
 */
export const FEEDS_TELEMETRY_TEXT: string = "Telemetry";

export const FEEDS_INFRASTRUCTURE_TEXT: string = "Infrastructure";

/*
 * The docs pages that explain it all, in the reader's language, by the
 * titles those pages have there.
 */
export const HOW_IT_WORKS_CORE_CONCEPTS: string =
  translationKey("Core Concepts");

export const HOW_IT_WORKS_GLOSSARY: string = translationKey("Glossary");

export const HOW_IT_WORKS_STEPS: Array<HowItWorksStep> = [
  {
    key: "monitor",
    title: "Monitors",
    description: "Check your websites, APIs and servers around the clock.",
    icon: IconProp.AltGlobe,
    iconClassName: "bg-blue-50 text-blue-600 ring-blue-200",
    pageMap: PageMap.MONITORS,
  },
  {
    key: "incident",
    title: "Incidents & Alerts",
    description:
      "A failed check opens an incident when users are affected, or an alert for your team to look into.",
    icon: IconProp.Alert,
    iconClassName: "bg-rose-50 text-rose-600 ring-rose-200",
    pageMap: PageMap.INCIDENTS,
  },
  {
    key: "on-call",
    title: "On-Call",
    description: "Pages the right person, and escalates if nobody answers.",
    icon: IconProp.Call,
    iconClassName: "bg-stone-100 text-stone-600 ring-stone-300",
    pageMap: PageMap.ON_CALL_DUTY,
  },
  {
    key: "status-page",
    title: "Status Pages",
    description: "Keep your customers informed while you fix it.",
    icon: IconProp.CheckCircle,
    iconClassName: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    pageMap: PageMap.STATUS_PAGES,
  },
];

export const STEP_BUTTON_CLASS_NAME: string =
  "group flex w-full items-start gap-3 rounded-md p-2 text-left transition hover:bg-white hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// Four across on a wide Home; two by two in a dialog, which is narrower.
export const STRIP_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4";
export const DIALOG_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-3 sm:grid-cols-2";

export const DOCS_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:underline";

export interface ComponentProps {
  /*
   * The project the steps open their product in. Without one (no project
   * is picked yet) the steps say what each product does, and open nothing.
   */
  projectId?: string | undefined;
  /*
   * Drawn on its own in a dialog, whose title names it: no heading of its
   * own, no grey frame, and the steps two by two.
   */
  isInDialog?: boolean | undefined;
  // Called after a step has opened its product (a dialog closes).
  onStepOpened?: (() => void) | undefined;
}

const HowOneUptimeWorks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, language } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const docsLinks: Array<{ key: string; text: string; url: string }> = [
    {
      key: "core-concepts",
      text: HOW_IT_WORKS_CORE_CONCEPTS,
      url: getDocsPageUrl(CORE_CONCEPTS_DOCS_PAGE, language),
    },
    {
      key: "glossary",
      text: HOW_IT_WORKS_GLOSSARY,
      url: getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, language),
    },
  ];

  return (
    <div
      className={
        props.isInDialog
          ? ""
          : "rounded-lg border border-gray-200 bg-gray-50 p-4"
      }
      data-testid="how-oneuptime-works"
    >
      {!props.isInDialog && (
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {tx(HOW_IT_WORKS_TITLE)}
        </div>
      )}
      <ol
        className={
          props.isInDialog ? DIALOG_GRID_CLASS_NAME : STRIP_GRID_CLASS_NAME
        }
      >
        {HOW_IT_WORKS_STEPS.map((step: HowItWorksStep, index: number) => {
          const content: ReactElement = (
            <>
              <span
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${step.iconClassName}`}
              >
                <Icon icon={step.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <span className="text-gray-400">{index + 1}.</span>
                  {tx(step.title)}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                  {tx(step.description)}
                </span>
              </span>
            </>
          );

          if (!props.projectId) {
            return (
              <li key={step.key} className="flex min-w-0">
                <div
                  data-testid={`how-it-works-step-${step.key}`}
                  className="flex w-full items-start gap-3 p-2"
                >
                  {content}
                </div>
              </li>
            );
          }

          const openStep: () => void = (): void => {
            UiAnalytics.capture("dashboard/home/how-it-works-step", {
              projectId: props.projectId,
              step: step.key,
              ...(props.isInDialog ? { place: "dialog" } : {}),
            });
            Navigation.navigate(
              RouteUtil.populateRouteParams(RouteMap[step.pageMap] as Route),
            );
            props.onStepOpened?.();
          };

          return (
            <li key={step.key} className="flex min-w-0">
              <button
                type="button"
                onClick={openStep}
                data-testid={`how-it-works-step-${step.key}`}
                className={STEP_BUTTON_CLASS_NAME}
              >
                {content}
              </button>
            </li>
          );
        })}
      </ol>
      <p
        className="mt-3 px-2 text-xs leading-5 text-gray-600"
        data-testid="how-oneuptime-works-feeds"
      >
        <TranslatedSentence
          template={HOW_IT_WORKS_FEEDS}
          slots={{
            telemetry: (
              <DefinedTerm term={GlossaryTerm.Telemetry}>
                {tx(FEEDS_TELEMETRY_TEXT)}
              </DefinedTerm>
            ),
            infrastructure: (
              <DefinedTerm term={GlossaryTerm.Infrastructure}>
                {tx(FEEDS_INFRASTRUCTURE_TEXT)}
              </DefinedTerm>
            ),
          }}
        />
      </p>
      <p
        className="mt-1 px-2 text-xs leading-5 text-gray-500"
        data-testid="how-oneuptime-works-footnote"
      >
        {tx(HOW_IT_WORKS_FOOTNOTE)}
      </p>
      <div
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs"
        data-testid="how-oneuptime-works-docs"
      >
        {docsLinks.map(
          (link: { key: string; text: string; url: string }): ReactElement => {
            return (
              <a
                key={link.key}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`how-oneuptime-works-docs-${link.key}`}
                className={DOCS_LINK_CLASS_NAME}
              >
                {tx(link.text)}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
              </a>
            );
          },
        )}
      </div>
    </div>
  );
};

export default HowOneUptimeWorks;
