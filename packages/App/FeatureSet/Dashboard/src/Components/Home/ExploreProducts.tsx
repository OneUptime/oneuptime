import AppLink from "../AppLink/AppLink";
import { useDashboardNavigationItems } from "../../Utils/NavigationItems";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import {
  groupItemsByCategory,
  MenuCategory,
} from "Common/UI/Components/Navbar/NavBarMenuCatalog";
import {
  ICON_COLOR_CLASSES,
  IconColorClasses,
} from "Common/UI/Components/Navbar/NavBarMenuModal";
import UiAnalytics from "Common/UI/Utils/Analytics";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Everything OneUptime can do, one category at a time.
 *
 * The products menu holds every product, but behind a button most people
 * never open, so a team that set up monitors and incidents never finds out
 * that logs, traces, Kubernetes or workflows are one click away. This lays
 * the same catalog out on Home - the products menu's own list
 * (useDashboardNavigationItems), so a product added there shows up here,
 * with the same title, words and colour.
 *
 * One category is shown at a time, starting with Essentials, so the card
 * never puts forty products in front of anyone at once. Project settings
 * (Users, Teams, Settings) are left out: they are not products to explore.
 */

export interface ComponentProps {
  projectId: string;
}

// The products menu's categories, without the settings one.
export const getExploreCategories: (data: {
  items: ReadonlyArray<MoreMenuItem>;
  settingsCategory: string;
}) => Array<MenuCategory> = (data: {
  items: ReadonlyArray<MoreMenuItem>;
  settingsCategory: string;
}): Array<MenuCategory> => {
  return groupItemsByCategory(data.items).filter(
    (category: MenuCategory): boolean => {
      return category.title !== data.settingsCategory;
    },
  );
};

type SlugifyFunction = (value: string) => string;

const slugify: SlugifyFunction = (value: string): string => {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "category"
  );
};

const ExploreProducts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { t } = useTranslation();
  const { moreMenuItems } = useDashboardNavigationItems();

  const categories: Array<MenuCategory> = getExploreCategories({
    items: moreMenuItems,
    settingsCategory: t("navbar.categories.settings"),
  });

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const tabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  if (categories.length === 0) {
    return <></>;
  }

  // The language changed and the list with it: stay in range.
  const activeIndex: number = Math.min(selectedIndex, categories.length - 1);
  const activeCategory: MenuCategory = categories[activeIndex]!;

  const selectTab: (index: number) => void = (index: number): void => {
    const next: number = (index + categories.length) % categories.length;
    setSelectedIndex(next);
    tabRefs.current[next]?.focus();
  };

  // Arrow keys walk the tabs, as a tab list's keyboard pattern has it.
  const onTabKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(categories.length - 1);
    }
  };

  const panelId: string = "home-explore-panel";

  return (
    <div data-testid="home-explore-products">
      <Card
        title="Explore OneUptime"
        description="Everything OneUptime can do, by category. Open a product to see what it shows and how to set it up."
        bodyClassName="mt-4"
        className="!mb-0"
      >
        <div
          role="tablist"
          aria-label={
            translator.translateText("Product categories") ||
            "Product categories"
          }
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {categories.map(
            (category: MenuCategory, index: number): ReactElement => {
              const isSelected: boolean = index === activeIndex;

              return (
                <button
                  key={category.title}
                  ref={(element: HTMLButtonElement | null) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`home-explore-tab-${slugify(category.title)}`}
                  aria-selected={isSelected}
                  aria-controls={panelId}
                  tabIndex={isSelected ? 0 : -1}
                  data-testid="home-explore-tab"
                  onClick={() => {
                    setSelectedIndex(index);
                    UiAnalytics.capture("dashboard/home/explore-category", {
                      projectId: props.projectId,
                      category: category.title,
                    });
                  }}
                  onKeyDown={(
                    event: React.KeyboardEvent<HTMLButtonElement>,
                  ) => {
                    onTabKeyDown(event, index);
                  }}
                  className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isSelected
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {category.title}
                  <span
                    className={`ml-1.5 tabular-nums ${
                      isSelected ? "text-indigo-500" : "text-gray-400"
                    }`}
                  >
                    {translator.formatNumber(category.items.length)}
                  </span>
                </button>
              );
            },
          )}
        </div>
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={`home-explore-tab-${slugify(activeCategory.title)}`}
          data-testid="home-explore-panel"
          data-category={activeCategory.title}
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {activeCategory.items.map((item: MoreMenuItem): ReactElement => {
            const colors: IconColorClasses =
              ICON_COLOR_CLASSES[item.iconColor || "indigo"] ||
              ICON_COLOR_CLASSES["indigo"]!;

            return (
              <AppLink
                key={item.route.toString()}
                to={item.route}
                onNavigateComplete={() => {
                  UiAnalytics.capture("dashboard/home/explore-product", {
                    projectId: props.projectId,
                    product: item.title,
                  });
                }}
                className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition hover:border-indigo-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span
                  data-testid="home-explore-product"
                  className="flex min-w-0 flex-1 items-start gap-3"
                >
                  <span
                    className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ring-1 ring-inset ${colors.bg} ${colors.ring}`}
                  >
                    <Icon
                      icon={item.icon}
                      className={`h-5 w-5 ${colors.text}`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-medium text-gray-900">
                      <span className="truncate">{item.title}</span>
                    </span>
                    {item.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-gray-500">
                        {item.description}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                  <Icon
                    icon={IconProp.ChevronRight}
                    className="mt-0.5 h-4 w-4 flex-none text-gray-300"
                  />
                </span>
              </AppLink>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default ExploreProducts;
