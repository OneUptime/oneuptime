import AppLink from "../AppLink/AppLink";
import { getExploreCategories } from "./ExploreProducts";
import {
  FEEDS_INFRASTRUCTURE_TEXT,
  FEEDS_TELEMETRY_TEXT,
  HOW_IT_WORKS_TITLE,
} from "./HowOneUptimeWorks";
import { useDashboardNavigationItems } from "../../Utils/NavigationItems";
import {
  getListedItems,
  withProductMarks,
} from "../../Utils/ProjectProducts/ProductsMenu";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import IconProp from "Common/Types/Icon/IconProp";
import ProductKey from "Common/Types/Product/ProductKey";
import { isRightToLeftLanguage } from "Common/Types/ReadingDirection";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import Icon from "Common/UI/Components/Icon/Icon";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import {
  MenuCategory,
  getCategoryHeading,
  getItemDescription,
  getItemTitle,
} from "Common/UI/Components/Navbar/NavBarMenuCatalog";
import {
  ICON_COLOR_CLASSES,
  IconColorClasses,
} from "Common/UI/Components/Navbar/NavBarMenuModal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * HOW ONEUPTIME WORKS: THE WHOLE PRODUCT, ONE STEP AT A TIME (#8891).
 *
 * The dialog used to name four products and say, in one dense sentence,
 * that everything else was optional. People asked it to show what
 * OneUptime can do, more simply. So it is a small explorer now:
 *
 *   - "How it fits together" comes first: the four steps every problem
 *     moves through - Detect, Respond, Communicate, Improve - each in one
 *     sentence, with the products that do it. A product opens its page.
 *   - Then every product OneUptime has, one category at a time, in the
 *     products menu's own categories, words, icons and colours (Home's
 *     Explore OneUptime lays out the same list: getExploreCategories). Each
 *     category says in a line what it is for; each product says what it
 *     does, and opens its page.
 *
 * One list of sections down the side (a row of tabs on a narrower screen):
 * the arrow keys walk it, Home and End jump to its ends, and Next at the
 * foot of a section moves on to the one after. Opening a product closes
 * the dialog, unless it opened in a new tab.
 *
 * It is fitted to the project as the products menu is (#6814): a product
 * the project hides, or the server switched off, is left out - from the
 * categories and from the steps - and one the project's plan cannot use
 * names the plan that can, before it is opened. With no project picked
 * yet, every product says what it does and opens nothing.
 */

// Where a product was opened from, as the event says it.
export enum HowItWorksProductPlace {
  // A step of How it fits together.
  Loop = "loop",
  // A category's list.
  Category = "category",
}

export interface HowItWorksLoopStep {
  key: string;
  title: string;
  /*
   * One sentence. Detect's names {{telemetry}} and {{infrastructure}}, the
   * two words drawn with their definitions.
   */
  description: string;
  // The products that do this step, in the order they are offered.
  products: ReadonlyArray<ProductKey>;
}

/*
 * The four steps a problem moves through, in order. Essentials, the
 * products menu's first category, lists its products in the same order a
 * problem meets them.
 */
export const HOW_IT_WORKS_LOOP: ReadonlyArray<HowItWorksLoopStep> = [
  {
    key: "detect",
    title: translationKey("Detect"),
    description: translationKey(
      "Check your websites, APIs and servers around the clock, and watch your {{telemetry}} and {{infrastructure}} for problems.",
    ),
    products: [
      ProductKey.Monitors,
      ProductKey.Logs,
      ProductKey.Metrics,
      ProductKey.Traces,
    ],
  },
  {
    key: "respond",
    title: translationKey("Respond"),
    description: translationKey(
      "Open an incident when users are affected, or an alert for your team, and page whoever is on call.",
    ),
    products: [ProductKey.Incidents, ProductKey.Alerts, ProductKey.OnCall],
  },
  {
    key: "communicate",
    title: translationKey("Communicate"),
    description: translationKey(
      "Tell your customers what is happening while you fix it, and announce maintenance ahead of time.",
    ),
    products: [ProductKey.StatusPages, ProductKey.ScheduledMaintenance],
  },
  {
    key: "improve",
    title: translationKey("Improve"),
    description: translationKey(
      "Track reliability against your targets, learn from each incident and automate the next response.",
    ),
    products: [
      ProductKey.Slos,
      ProductKey.Dashboards,
      ProductKey.Workflows,
      ProductKey.Runbooks,
    ],
  },
];

// The first section: the four steps.
export const HOW_IT_WORKS_LOOP_TAB: string = translationKey(
  "How it fits together",
);

export const HOW_IT_WORKS_LOOP_INTRO: string = translationKey(
  "From the first sign of trouble to the fix, every problem moves through four steps.",
);

// Over the categories in the list of sections, where there is room for it.
export const HOW_IT_WORKS_PRODUCTS_LABEL: string = "Products";

// The way on, at the foot of every section but the last.
export const HOW_IT_WORKS_NEXT: string = translationKey("Next: {{section}}");

export interface HowItWorksCategorySummary {
  // The category, by the products menu's key for its name.
  categoryKey: string;
  // What its products are for, in a line.
  summary: string;
}

/*
 * What each category of the products menu is for, in a line, by the key
 * the menu names it with (Utils/NavigationItems). A category added there
 * without a line here is drawn with its name alone.
 */
export const HOW_IT_WORKS_CATEGORY_SUMMARIES: ReadonlyArray<HowItWorksCategorySummary> =
  [
    {
      categoryKey: "navbar.categories.essentials",
      summary: translationKey(
        "The products a problem moves through, from the first check to the status page.",
      ),
    },
    {
      categoryKey: "navbar.categories.observability",
      summary: translationKey(
        "See what your code is doing: logs, metrics, traces, exceptions and profiles.",
      ),
    },
    {
      categoryKey: "navbar.categories.security",
      summary: translationKey(
        "Find threats in your data, and protect what is sensitive.",
      ),
    },
    {
      categoryKey: "navbar.categories.ai",
      summary: translationKey(
        "Ask questions about your systems, and get findings before you ask.",
      ),
    },
    {
      categoryKey: "navbar.categories.code",
      summary: translationKey(
        "Connect your repositories, and let AI change your code and open pull requests.",
      ),
    },
    {
      categoryKey: "navbar.categories.resources",
      summary: translationKey(
        "Your services, databases and queues, and how your users experience your apps.",
      ),
    },
    {
      categoryKey: "navbar.categories.infrastructure",
      summary: translationKey(
        "The servers, containers, clusters, storage and networks you run yourself.",
      ),
    },
    {
      categoryKey: "navbar.categories.cloud",
      summary: translationKey(
        "The accounts, apps and functions your cloud runs for you.",
      ),
    },
    {
      categoryKey: "navbar.categories.analyticsAutomation",
      summary: translationKey(
        "Chart what matters, automate the work and collect requests with forms.",
      ),
    },
  ];

export const HOW_ONEUPTIME_WORKS_OVERVIEW_TEST_ID: string =
  "how-oneuptime-works-overview";
export const HOW_ONEUPTIME_WORKS_TAB_TEST_ID: string =
  "how-oneuptime-works-tab";
export const HOW_ONEUPTIME_WORKS_PANEL_TEST_ID: string =
  "how-oneuptime-works-panel";
export const HOW_ONEUPTIME_WORKS_PRODUCT_TEST_ID: string =
  "how-oneuptime-works-product";
export const HOW_ONEUPTIME_WORKS_PLAN_TEST_ID: string =
  "how-oneuptime-works-plan";
export const HOW_ONEUPTIME_WORKS_NEXT_TEST_ID: string =
  "how-oneuptime-works-next";
export const LOOP_SECTION_KEY: string = "loop";

// A section of the list down the side: the four steps, or a category.
export type HowItWorksSection =
  | { kind: "loop" }
  | { kind: "category"; category: MenuCategory };

/*
 * The sections in order: the four steps, then the categories, as the
 * products menu orders them.
 */
export const getHowItWorksSections: (
  categories: ReadonlyArray<MenuCategory>,
) => Array<HowItWorksSection> = (
  categories: ReadonlyArray<MenuCategory>,
): Array<HowItWorksSection> => {
  return [
    { kind: "loop" },
    ...categories.map((category: MenuCategory): HowItWorksSection => {
      return { kind: "category", category: category };
    }),
  ];
};

/*
 * The products that do a step, as the project lists them: a product it
 * hides, or one switched off on the server, is not offered.
 */
export const getLoopStepProducts: (data: {
  step: HowItWorksLoopStep;
  listed: ReadonlyArray<MoreMenuItem>;
}) => Array<MoreMenuItem> = (data: {
  step: HowItWorksLoopStep;
  listed: ReadonlyArray<MoreMenuItem>;
}): Array<MoreMenuItem> => {
  return data.step.products
    .map((product: ProductKey): MoreMenuItem | undefined => {
      return data.listed.find((item: MoreMenuItem): boolean => {
        return item.key === product;
      });
    })
    .filter((item: MoreMenuItem | undefined): item is MoreMenuItem => {
      return Boolean(item);
    });
};

/*
 * The section an arrow key moves to from `index`, or null for a key that
 * moves nothing. The list runs down the side, or across on a narrower
 * screen, so both pairs of arrows walk it; across, Left goes back on a
 * page read left to right and on to the next on a page read right to left.
 * It wraps round at the ends.
 */
export const getSectionForKey: (data: {
  key: string;
  index: number;
  count: number;
  isRightToLeft: boolean;
}) => number | null = (data: {
  key: string;
  index: number;
  count: number;
  isRightToLeft: boolean;
}): number | null => {
  if (data.count <= 0) {
    return null;
  }

  const forward: number = (data.index + 1) % data.count;
  const back: number = (data.index - 1 + data.count) % data.count;

  switch (data.key) {
    case "ArrowDown":
      return forward;
    case "ArrowUp":
      return back;
    case "ArrowRight":
      return data.isRightToLeft ? back : forward;
    case "ArrowLeft":
      return data.isRightToLeft ? forward : back;
    case "Home":
      return 0;
    case "End":
      return data.count - 1;
    default:
      return null;
  }
};

/*
 * The slots a sentence names, of the ones on offer. A sentence handed a slot
 * its words do not name reads as one its language has not worded, and is
 * drawn in English (TranslatedSentence): Respond's, Communicate's and
 * Improve's sentences, handed Detect's two words, were English in German.
 */
export const getSlotsOf: (
  template: string,
  slots: Record<string, ReactNode>,
) => Record<string, ReactNode> = (
  template: string,
  slots: Record<string, ReactNode>,
): Record<string, ReactNode> => {
  const named: Record<string, ReactNode> = {};

  for (const [name, slot] of Object.entries(slots)) {
    if (template.includes(`{{${name}}}`)) {
      named[name] = slot;
    }
  }

  return named;
};

// The nearest box around `element` that scrolls: the dialog's body.
export const getScrollingBox: (element: HTMLElement) => HTMLElement | null = (
  element: HTMLElement,
): HTMLElement | null => {
  let box: HTMLElement | null = element.parentElement;

  while (box) {
    const overflowY: string = window.getComputedStyle(box).overflowY;

    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      box.scrollHeight > box.clientHeight
    ) {
      return box;
    }

    box = box.parentElement;
  }

  return null;
};

/*
 * Scrolls `element`'s start back into view when its box has scrolled past
 * it, and leaves the box where it is otherwise: a section picked while the
 * one before it was read from its top does not jump.
 */
export const scrollBackToStart: (element: HTMLElement) => void = (
  element: HTMLElement,
): void => {
  const box: HTMLElement | null = getScrollingBox(element);

  if (!box) {
    return;
  }

  const hiddenBy: number =
    box.getBoundingClientRect().top - element.getBoundingClientRect().top;

  if (hiddenBy > 0) {
    box.scrollTop = Math.max(0, box.scrollTop - hiddenBy);
  }
};

export interface ComponentProps {
  /*
   * The project the products open in. Without one (no project is picked
   * yet) every product says what it does, and opens nothing.
   */
  projectId?: string | undefined;
  // Called once a product opened in place of the page (a dialog closes).
  onProductOpened?: (() => void) | undefined;
}

const TAB_CLASS_NAME: string =
  "flex flex-none items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:w-full lg:justify-between lg:whitespace-normal lg:rounded-md lg:py-2 lg:text-start";

const SELECTED_TAB_CLASS_NAME: string =
  "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200";

const TAB_CLASS_NAME_WHEN_NOT_SELECTED: string =
  "text-gray-600 hover:bg-gray-50 hover:text-gray-900";

const CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 pe-3 ps-1 text-xs font-medium text-gray-700";

const CHIP_LINK_CLASS_NAME: string = `${CHIP_CLASS_NAME} transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;

const CARD_CLASS_NAME: string =
  "flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-start";

const CARD_LINK_CLASS_NAME: string = `${CARD_CLASS_NAME} transition hover:border-indigo-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;

const HowOneUptimeWorksOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { t } = useTranslation();
  const { moreMenuItems } = useDashboardNavigationItems();
  const products: ProjectProductsState = useProjectProducts(props.projectId);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const baseId: string = useId();
  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const tabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);
  /*
   * Whether the last press on a product opened it in place: a press with
   * Ctrl, Cmd, Shift or Alt opens it in a new tab or window, and leaves the
   * dialog open for the next one.
   */
  const opensInPlaceRef: React.MutableRefObject<boolean> =
    useRef<boolean>(true);

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  // The products menu's catalog, as the project lists it, with its marks.
  const listed: Array<MoreMenuItem> = getListedItems({
    items: moreMenuItems,
    answer: products.answer,
  }).map((item: MoreMenuItem): MoreMenuItem => {
    return withProductMarks(item, products.answer);
  });

  const categories: Array<MenuCategory> = getExploreCategories({
    items: listed,
    settingsCategory: t("navbar.categories.settings"),
  });

  const sections: Array<HowItWorksSection> = getHowItWorksSections(categories);

  // The language changed or a product was hidden, and the list with it.
  const activeIndex: number = Math.min(selectedIndex, sections.length - 1);
  const activeSection: HowItWorksSection = sections[activeIndex]!;
  const nextSection: HowItWorksSection | undefined = sections[activeIndex + 1];
  const hasProject: boolean = Boolean(props.projectId);

  const tabId: (index: number) => string = (index: number): string => {
    return `${baseId}-tab-${index}`;
  };
  const panelId: string = `${baseId}-panel`;

  const sectionTitle: (section: HowItWorksSection) => string = (
    section: HowItWorksSection,
  ): string => {
    return section.kind === "loop"
      ? tx(HOW_IT_WORKS_LOOP_TAB)
      : getCategoryHeading(section.category, tx);
  };

  const sectionKey: (section: HowItWorksSection) => string = (
    section: HowItWorksSection,
  ): string => {
    return section.kind === "loop" ? LOOP_SECTION_KEY : section.category.title;
  };

  const categorySummary: (category: MenuCategory) => string | null = (
    category: MenuCategory,
  ): string | null => {
    const found: HowItWorksCategorySummary | undefined =
      HOW_IT_WORKS_CATEGORY_SUMMARIES.find(
        (entry: HowItWorksCategorySummary): boolean => {
          return t(entry.categoryKey) === category.title;
        },
      );

    return found ? tx(found.summary) : null;
  };

  /*
   * Shows a section from its start: a section picked from the foot of a
   * long one - with Next, or from the list that stays in view beside it -
   * is read from its top, and its tab is scrolled into the row it is in.
   */
  const select: (index: number, options: { moveFocus: boolean }) => void = (
    index: number,
    options: { moveFocus: boolean },
  ): void => {
    setSelectedIndex(index);

    const tab: HTMLButtonElement | null = tabRefs.current[index] || null;

    if (options.moveFocus && tab) {
      tab.focus({ preventScroll: true });
    }

    if (rootRef.current) {
      scrollBackToStart(rootRef.current);
    }

    if (tab && typeof tab.scrollIntoView === "function") {
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onTabKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    const next: number | null = getSectionForKey({
      key: event.key,
      index: index,
      count: sections.length,
      isRightToLeft: isRightToLeftLanguage(translator.language),
    });

    if (next === null) {
      return;
    }

    event.preventDefault();
    select(next, { moveFocus: true });
  };

  const openProduct: (
    item: MoreMenuItem,
    place: HowItWorksProductPlace,
  ) => void = (item: MoreMenuItem, place: HowItWorksProductPlace): void => {
    ProductEvents.send(ProductEventName.HowItWorksProductOpened, {
      product: item.key || "",
      place: place,
    });

    if (opensInPlaceRef.current) {
      props.onProductOpened?.();
    }
  };

  // "Growth Plan": said before the click, as the products menu says it.
  const planMark: (item: MoreMenuItem) => ReactElement = (
    item: MoreMenuItem,
  ): ReactElement => {
    if (!item.neededPlan) {
      return <></>;
    }

    return (
      <span
        data-testid={HOW_ONEUPTIME_WORKS_PLAN_TEST_ID}
        className="flex-shrink-0 rounded-full bg-yellow-50 px-1.5 text-xs font-medium leading-4 text-yellow-800 ring-1 ring-inset ring-yellow-200"
      >
        {translator.translateTemplate("{{planName}} Plan", {
          planName: item.neededPlan,
        })}
      </span>
    );
  };

  /*
   * A product: a link to its page, or - with no project to open it in -
   * the same words, opening nothing.
   */
  const productLink: (data: {
    item: MoreMenuItem;
    place: HowItWorksProductPlace;
    className: string;
    linkClassName: string;
    children: ReactElement;
  }) => ReactElement = (data: {
    item: MoreMenuItem;
    place: HowItWorksProductPlace;
    className: string;
    linkClassName: string;
    children: ReactElement;
  }): ReactElement => {
    if (!hasProject) {
      return (
        <span
          className={data.className}
          data-testid={HOW_ONEUPTIME_WORKS_PRODUCT_TEST_ID}
          data-product={data.item.key}
          data-place={data.place}
        >
          {data.children}
        </span>
      );
    }

    return (
      <AppLink
        to={data.item.route}
        className={data.linkClassName}
        dataTestId={HOW_ONEUPTIME_WORKS_PRODUCT_TEST_ID}
        onNavigateComplete={() => {
          openProduct(data.item, data.place);
        }}
      >
        {data.children}
      </AppLink>
    );
  };

  const productIcon: (
    item: MoreMenuItem,
    size: "small" | "large",
  ) => ReactElement = (
    item: MoreMenuItem,
    size: "small" | "large",
  ): ReactElement => {
    const colors: IconColorClasses =
      ICON_COLOR_CLASSES[item.iconColor || "indigo"] ||
      ICON_COLOR_CLASSES["indigo"]!;

    return (
      <span
        aria-hidden="true"
        className={`flex flex-none items-center justify-center ring-1 ring-inset ${colors.bg} ${colors.ring} ${
          size === "small" ? "h-5 w-5 rounded-full" : "h-9 w-9 rounded-lg"
        }`}
      >
        <Icon
          icon={item.icon}
          className={`${size === "small" ? "h-3 w-3" : "h-5 w-5"} ${colors.text}`}
        />
      </span>
    );
  };

  // The two words of Detect's sentence, each with its definition.
  const definedWords: Record<string, ReactNode> = {
    telemetry: (
      <DefinedTerm term={GlossaryTerm.Telemetry}>
        {translator.translateTerm(FEEDS_TELEMETRY_TEXT, { inSentence: true })}
      </DefinedTerm>
    ),
    infrastructure: (
      <DefinedTerm term={GlossaryTerm.Infrastructure}>
        {translator.translateTerm(FEEDS_INFRASTRUCTURE_TEXT, {
          inSentence: true,
        })}
      </DefinedTerm>
    ),
  };

  const loopPanel: () => ReactElement = (): ReactElement => {
    return (
      <div data-testid="how-oneuptime-works-loop">
        <p className="text-sm leading-6 text-gray-600">
          {tx(HOW_IT_WORKS_LOOP_INTRO)}
        </p>
        <ol className="mt-5">
          {HOW_IT_WORKS_LOOP.map(
            (step: HowItWorksLoopStep, index: number): ReactElement => {
              const stepProducts: Array<MoreMenuItem> = getLoopStepProducts({
                step: step,
                listed: listed,
              });
              const isLast: boolean = index === HOW_IT_WORKS_LOOP.length - 1;

              return (
                <li
                  key={step.key}
                  data-testid={`how-oneuptime-works-step-${step.key}`}
                  className={`relative ps-12 ${isLast ? "" : "pb-7"}`}
                >
                  {/*
                   * The line from one step to the next, down the side
                   * of their numbers: the order a problem moves in.
                   */}
                  {isLast ? (
                    <></>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 start-4 top-9 w-px bg-gray-200"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="absolute start-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
                  >
                    {translator.formatNumber(index + 1)}
                  </span>
                  <h4 className="pt-1.5 text-sm font-semibold text-gray-900">
                    {tx(step.title)}
                  </h4>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    <TranslatedSentence
                      template={step.description}
                      slots={getSlotsOf(step.description, definedWords)}
                    />
                  </p>
                  {stepProducts.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {stepProducts.map((item: MoreMenuItem): ReactElement => {
                        return (
                          <li key={item.key || item.route.toString()}>
                            {productLink({
                              item: item,
                              place: HowItWorksProductPlace.Loop,
                              className: CHIP_CLASS_NAME,
                              linkClassName: CHIP_LINK_CLASS_NAME,
                              children: (
                                <>
                                  {productIcon(item, "small")}
                                  <span>{getItemTitle(item, tx)}</span>
                                  {planMark(item)}
                                </>
                              ),
                            })}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <></>
                  )}
                </li>
              );
            },
          )}
        </ol>
      </div>
    );
  };

  const categoryPanel: (category: MenuCategory) => ReactElement = (
    category: MenuCategory,
  ): ReactElement => {
    const summary: string | null = categorySummary(category);

    return (
      <div data-testid="how-oneuptime-works-category">
        <h4 className="text-base font-semibold text-gray-900">
          {getCategoryHeading(category, tx)}
        </h4>
        {summary ? (
          <p className="mt-1 text-sm leading-6 text-gray-600">{summary}</p>
        ) : (
          <></>
        )}
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {category.items.map((item: MoreMenuItem): ReactElement => {
            const description: string = getItemDescription(item, tx);

            return (
              <li key={item.key || item.route.toString()} className="flex">
                {productLink({
                  item: item,
                  place: HowItWorksProductPlace.Category,
                  className: CARD_CLASS_NAME,
                  linkClassName: CARD_LINK_CLASS_NAME,
                  children: (
                    <>
                      {productIcon(item, "large")}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium text-gray-900">
                          <span>{getItemTitle(item, tx)}</span>
                          {planMark(item)}
                        </span>
                        {description ? (
                          <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                            {description}
                          </span>
                        ) : (
                          <></>
                        )}
                      </span>
                      {hasProject ? (
                        <Icon
                          icon={IconProp.ChevronRight}
                          className="mt-0.5 h-4 w-4 flex-none text-gray-300"
                        />
                      ) : (
                        <></>
                      )}
                    </>
                  ),
                })}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-5 lg:flex-row lg:gap-8"
      data-testid={HOW_ONEUPTIME_WORKS_OVERVIEW_TEST_ID}
      onClickCapture={(event: React.MouseEvent<HTMLDivElement>) => {
        opensInPlaceRef.current = !(
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        );
      }}
    >
      {/*
       * Down the side on a wide screen, where it stays in view while a long
       * section scrolls; a row that scrolls sideways on a narrower one. Its
       * 4px of padding keep a focused tab's ring whole inside the scroller.
       */}
      <div
        role="tablist"
        aria-label={tx(HOW_IT_WORKS_TITLE)}
        aria-orientation="vertical"
        className="-m-1 flex gap-1 overflow-x-auto p-1 lg:sticky lg:top-0 lg:m-0 lg:w-56 lg:flex-none lg:flex-col lg:self-start lg:overflow-visible lg:p-0"
      >
        {sections.map(
          (section: HowItWorksSection, index: number): ReactElement => {
            const isSelected: boolean = index === activeIndex;

            return (
              <React.Fragment key={sectionKey(section)}>
                {index === 1 ? (
                  <span
                    aria-hidden="true"
                    className="max-lg:hidden px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:block"
                  >
                    {tx(HOW_IT_WORKS_PRODUCTS_LABEL)}
                  </span>
                ) : (
                  <></>
                )}
                <button
                  ref={(element: HTMLButtonElement | null) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(index)}
                  aria-selected={isSelected}
                  aria-controls={panelId}
                  tabIndex={isSelected ? 0 : -1}
                  data-testid={HOW_ONEUPTIME_WORKS_TAB_TEST_ID}
                  data-section={sectionKey(section)}
                  onClick={() => {
                    select(index, { moveFocus: false });
                  }}
                  onKeyDown={(
                    event: React.KeyboardEvent<HTMLButtonElement>,
                  ) => {
                    onTabKeyDown(event, index);
                  }}
                  className={`${TAB_CLASS_NAME} ${
                    isSelected
                      ? SELECTED_TAB_CLASS_NAME
                      : TAB_CLASS_NAME_WHEN_NOT_SELECTED
                  }`}
                >
                  <span>{sectionTitle(section)}</span>
                  {section.kind === "category" ? (
                    <span
                      className={`text-xs tabular-nums ${
                        isSelected ? "text-indigo-500" : "text-gray-500"
                      }`}
                    >
                      {translator.formatNumber(section.category.items.length)}
                    </span>
                  ) : (
                    <></>
                  )}
                </button>
              </React.Fragment>
            );
          },
        )}
      </div>
      {/*
       * As tall as the tallest sections, on a wide screen, so the dialog
       * keeps its size - and the list its place under the pointer - from
       * one section to the next.
       */}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(activeIndex)}
        tabIndex={0}
        data-testid={HOW_ONEUPTIME_WORKS_PANEL_TEST_ID}
        data-section={sectionKey(activeSection)}
        className="flex min-w-0 flex-1 flex-col rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:min-h-[34rem]"
      >
        {activeSection.kind === "loop"
          ? loopPanel()
          : categoryPanel(activeSection.category)}
        {nextSection ? (
          <div className="mt-auto flex justify-end pt-6">
            <button
              type="button"
              data-testid={HOW_ONEUPTIME_WORKS_NEXT_TEST_ID}
              onClick={() => {
                select(activeIndex + 1, { moveFocus: true });
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span>
                {translator.translateTemplate(HOW_IT_WORKS_NEXT, {
                  section: sectionTitle(nextSection),
                })}
              </span>
              <Icon
                icon={IconProp.ChevronRight}
                className="h-4 w-4 flex-none"
              />
            </button>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default HowOneUptimeWorksOverview;
