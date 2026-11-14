import NavBarCategoryToggle from "./NavBarCategoryToggle";
import NavBarItem from "./NavBarItem";
import type { MoreMenuItem, NavItem } from "./NavBar";
import {
  CategoryFolds,
  DEFAULT_HIDDEN_PRODUCTS_TITLE,
  getMenuItemsWithHidden,
  groupItemsByCategory,
  isMoreMenuItemActive,
  MenuCategory,
  useCategoryFolds,
} from "./NavBarMenuCatalog";
import {
  doesMenuShowRecentProducts,
  pickRecentProducts,
  readRecentProductRoutes,
} from "./NavBarRecentProducts";
import useTranslateValue from "../../Utils/Translation";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useState,
} from "react";

/*
 * How many recently visited products the phone's menu lists: one row each,
 * so fewer than the desktop dialog's six cards, which sit three to a row.
 * Four is the products someone moves between in a day, and leaves the
 * categories in sight below them.
 */
export const RECENT_PRODUCTS_SHOWN_ON_PHONE: number = 4;

export const MOBILE_MENU_RECENT_TEST_ID: string = "navbar-mobile-recent";

export const MOBILE_MENU_PINNED_TEST_ID: string = "navbar-mobile-pinned";

export interface ComponentProps {
  // Home and any other top-level entries, listed first.
  items: Array<NavItem>;
  // The products, from the same catalog as the desktop products menu.
  moreMenuItems: Array<MoreMenuItem>;
  // See NavBar's moreMenuCategoriesOpenByDefault.
  categoriesOpenByDefault?: Array<string> | undefined;
  // The right-hand entry (User Settings), listed after the products.
  rightElement?: NavItem | undefined;
  // Heading of the recently visited products (NavBar's moreMenuRecentLabel).
  recentLabel?: string | undefined;
  /*
   * Drawn first, above Home, and last, below User Settings: the
   * Dashboard's Search and Help, which the header leaves out on a phone
   * (#6816).
   */
  topElement?: ReactElement | undefined;
  bottomElement?: ReactElement | undefined;
  /*
   * The products the project hides (#6814), as one more folded row at the
   * end of the categories (hiddenTitle, "More products"), as the desktop
   * products menu lists them.
   */
  hiddenItems?: Array<MoreMenuItem> | undefined;
  hiddenTitle?: string | undefined;
  /*
   * The products this person pinned, in order: the first rows after Home,
   * under pinnedLabel ("Pinned"), and left out of the Recently visited row.
   */
  pinnedItems?: Array<MoreMenuItem> | undefined;
  pinnedLabel?: string | undefined;
  // Following a link closes the menu.
  onNavigate: () => void;
}

const slug: (title: string) => string = (title: string): string => {
  return title.toLowerCase().replace(/\s+/g, "-");
};

/*
 * The rows of the phone menu: Search, Home, the products visited last, the
 * products, User Settings, then Help.
 *
 * Search and Help are the Dashboard's (topElement, bottomElement): the
 * header has no room for them on a phone. The products visited last are
 * the products menu's own Recently visited row, one product a row, so a
 * product used a moment ago is one tap away rather than a category away.
 *
 * On a phone there is no products dialog: the menu toggle lists everything.
 * A menu that names the categories it opens on (the Dashboard's Essentials)
 * groups the products the way the desktop products menu does, with the same
 * folding: every category is a row that folds and opens on a tap, those
 * categories open and every other one folded, and the category holding the
 * current page opens by itself. The choices are the same ones the desktop
 * menu remembers. Without that list, the products are listed one after
 * another, as before.
 *
 * It mounts when the menu opens, so each opening starts from the categories
 * it opens on, the remembered choices and the page the user is on now.
 */
const NavBarMobileMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const menuItems: Array<MoreMenuItem> = getMenuItemsWithHidden({
    items: props.moreMenuItems,
    hiddenItems: props.hiddenItems,
    hiddenTitle: props.hiddenTitle || DEFAULT_HIDDEN_PRODUCTS_TITLE,
  });
  const folds: CategoryFolds = useCategoryFolds(
    menuItems,
    props.categoriesOpenByDefault,
  );
  const idPrefix: string = `navbar-mobile-${useId()}`;
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const pinnedItems: Array<MoreMenuItem> = props.pinnedItems || [];
  const pinnedRoutes: Array<string> = pinnedItems.map(
    (item: MoreMenuItem): string => {
      return item.route.toString();
    },
  );

  /*
   * Read when the menu opens, as the desktop dialog reads them: a menu that
   * folds its categories (the Dashboard's) remembers the products of every
   * page drawn (NavBar), and lists them here without the one the person is
   * on.
   */
  const [recentProducts] = useState<Array<MoreMenuItem>>(
    (): Array<MoreMenuItem> => {
      if (!doesMenuShowRecentProducts(props.categoriesOpenByDefault)) {
        return [];
      }

      return pickRecentProducts(
        readRecentProductRoutes(),
        props.moreMenuItems,
        isMoreMenuItemActive,
      )
        .filter((item: MoreMenuItem): boolean => {
          // A pinned product is listed already, above.
          return !pinnedRoutes.includes(item.route.toString());
        })
        .slice(0, RECENT_PRODUCTS_SHOWN_ON_PHONE);
    },
  );
  const recentHeadingId: string = `${idPrefix}-recent`;
  const recentLabel: string = props.recentLabel || "Recently visited";
  const pinnedHeadingId: string = `${idPrefix}-pinned`;
  const pinnedLabel: string = props.pinnedLabel || "Pinned";

  const row: (
    item: NavItem | MoreMenuItem,
    id: string,
    exact: boolean,
    trailing?: ReactNode,
  ) => ReactElement = (
    item: NavItem | MoreMenuItem,
    id: string,
    exact: boolean,
    trailing?: ReactNode,
  ): ReactElement => {
    return (
      <div key={id} className="block w-full">
        <NavBarItem
          id={id}
          title={item.title}
          icon={item.icon}
          exact={exact}
          route={item.route}
          activeRoute={item.activeRoute}
          onClick={props.onNavigate}
          isRenderedOnMobile={true}
          trailing={trailing}
        />
      </div>
    );
  };

  /*
   * A product's quiet marks, as the desktop menu's card draws them (#6814):
   * the plan that can use it, or "Not set up".
   */
  const productMarks: (item: MoreMenuItem) => ReactNode = (
    item: MoreMenuItem,
  ): ReactNode => {
    if (item.neededPlan) {
      return (
        <span
          data-testid="navbar-mobile-plan"
          className="ml-2 flex-shrink-0 rounded-full bg-yellow-50 px-1.5 text-[10px] font-medium leading-4 text-yellow-800 ring-1 ring-inset ring-yellow-200"
        >
          {translator.translateTemplate("{{planName}} Plan", {
            planName: item.neededPlan,
          })}
        </span>
      );
    }

    if (item.isNotSetUp) {
      return (
        <span
          data-testid="navbar-mobile-not-set-up"
          className="ml-2 flex-shrink-0 text-xs font-normal text-gray-400"
        >
          {translator.translateText("Not set up")}
        </span>
      );
    }

    return null;
  };

  const productRow: (item: MoreMenuItem) => ReactElement = (
    item: MoreMenuItem,
  ): ReactElement => {
    return row(item, `more-${slug(item.title)}`, false, productMarks(item));
  };

  const categories: Array<MenuCategory> = groupItemsByCategory(menuItems);

  return (
    <>
      {props.topElement}

      {props.items.map((item: NavItem) => {
        return row(item, item.id, item.exact ?? false);
      })}

      {pinnedItems.length > 0 && (
        <div
          role="group"
          aria-labelledby={pinnedHeadingId}
          data-testid={MOBILE_MENU_PINNED_TEST_ID}
          className="block w-full mt-1 border-t border-gray-100 pt-2"
        >
          <p
            id={pinnedHeadingId}
            className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400"
          >
            {translateString(pinnedLabel) || pinnedLabel}
          </p>
          {pinnedItems.map((item: MoreMenuItem): ReactElement => {
            return row(
              item,
              `pinned-${item.key || slug(item.title)}`,
              false,
              productMarks(item),
            );
          })}
        </div>
      )}

      {recentProducts.length > 0 && (
        <div
          role="group"
          aria-labelledby={recentHeadingId}
          data-testid={MOBILE_MENU_RECENT_TEST_ID}
          className="block w-full mt-1 border-t border-gray-100 pt-2"
        >
          <p
            id={recentHeadingId}
            className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400"
          >
            {translateString(recentLabel) || recentLabel}
          </p>
          {recentProducts.map((item: MoreMenuItem): ReactElement => {
            return row(item, `recent-${slug(item.title)}`, false);
          })}
        </div>
      )}

      {folds.isEnabled
        ? categories.map((category: MenuCategory, index: number) => {
            const isOpen: boolean = folds.isOpen(category.title);
            const headingId: string = `${idPrefix}-heading-${index}`;
            const bodyId: string = `${idPrefix}-group-${index}`;

            return (
              <div
                key={category.title}
                role="group"
                aria-labelledby={headingId}
                /*
                 * A rule above the first category sets the categories apart
                 * from the rows listed above them (Home).
                 */
                className={`block w-full ${
                  index === 0 ? "mt-1 border-t border-gray-100 pt-2" : "pt-1"
                }`}
              >
                <NavBarCategoryToggle
                  title={category.title}
                  itemTitles={category.items.map(
                    (item: MoreMenuItem): string => {
                      return item.title;
                    },
                  )}
                  isOpen={isOpen}
                  onToggle={() => {
                    folds.toggle(category.title);
                  }}
                  controlsId={bodyId}
                  headingId={headingId}
                />
                {isOpen && (
                  /*
                   * A category's products are indented under its row, on a
                   * guide line, so they do not read as more categories.
                   */
                  <div
                    id={bodyId}
                    className="ml-5 mt-1 space-y-1 border-l border-gray-100 pl-1"
                  >
                    {category.items.map(productRow)}
                  </div>
                )}
              </div>
            );
          })
        : menuItems.map(productRow)}

      {props.rightElement &&
        row(
          props.rightElement,
          `right-${slug(props.rightElement.title)}`,
          props.rightElement.exact ?? false,
        )}

      {props.bottomElement}
    </>
  );
};

export default NavBarMobileMenu;
