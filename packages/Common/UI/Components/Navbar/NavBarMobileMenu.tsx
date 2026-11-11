import NavBarCategoryToggle from "./NavBarCategoryToggle";
import NavBarItem from "./NavBarItem";
import type { MoreMenuItem, NavItem } from "./NavBar";
import {
  CategoryFolds,
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
import React, {
  FunctionComponent,
  ReactElement,
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
  const folds: CategoryFolds = useCategoryFolds(
    props.moreMenuItems,
    props.categoriesOpenByDefault,
  );
  const idPrefix: string = `navbar-mobile-${useId()}`;
  const { translateString } = useTranslateValue();

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
      ).slice(0, RECENT_PRODUCTS_SHOWN_ON_PHONE);
    },
  );
  const recentHeadingId: string = `${idPrefix}-recent`;
  const recentLabel: string = props.recentLabel || "Recently visited";

  const row: (
    item: NavItem | MoreMenuItem,
    id: string,
    exact: boolean,
  ) => ReactElement = (
    item: NavItem | MoreMenuItem,
    id: string,
    exact: boolean,
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
        />
      </div>
    );
  };

  const productRow: (item: MoreMenuItem) => ReactElement = (
    item: MoreMenuItem,
  ): ReactElement => {
    return row(item, `more-${slug(item.title)}`, false);
  };

  const categories: Array<MenuCategory> = groupItemsByCategory(
    props.moreMenuItems,
  );

  return (
    <>
      {props.topElement}

      {props.items.map((item: NavItem) => {
        return row(item, item.id, item.exact ?? false);
      })}

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
        : props.moreMenuItems.map(productRow)}

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
