import NavBarCategoryToggle from "./NavBarCategoryToggle";
import NavBarItem from "./NavBarItem";
import type { MoreMenuItem, NavItem } from "./NavBar";
import {
  CategoryFolds,
  groupItemsByCategory,
  MenuCategory,
  useCategoryFolds,
} from "./NavBarMenuCatalog";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  // Home and any other top-level entries, listed first.
  items: Array<NavItem>;
  // The products, from the same catalog as the desktop products menu.
  moreMenuItems: Array<MoreMenuItem>;
  // See NavBar's moreMenuCategoriesOpenByDefault.
  categoriesOpenByDefault?: Array<string> | undefined;
  // The right-hand entry (User Settings), listed last.
  rightElement?: NavItem | undefined;
  // Following a link closes the menu.
  onNavigate: () => void;
}

const slug: (title: string) => string = (title: string): string => {
  return title.toLowerCase().replace(/\s+/g, "-");
};

/*
 * The rows of the phone menu: Home, the products, then User Settings.
 *
 * On a phone there is no products dialog: the menu toggle lists everything.
 * A menu that names the categories it opens on (the Dashboard) groups the
 * products the way the desktop products menu does, with the same folding: the
 * categories it opens on are listed, every other one is a single row that
 * opens on a tap, and the category holding the current page opens by itself.
 * The choices are the same ones the desktop menu remembers. Without that
 * list, the products are listed one after another, as before.
 *
 * It mounts when the menu opens, so each opening starts from the remembered
 * choices and the page the user is on now.
 */
const NavBarMobileMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const folds: CategoryFolds = useCategoryFolds(
    props.moreMenuItems,
    props.categoriesOpenByDefault,
  );
  const idPrefix: string = `navbar-mobile-${useId()}`;

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
      {props.items.map((item: NavItem) => {
        return row(item, item.id, item.exact ?? false);
      })}

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
                className="block w-full pt-1"
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
                  <div id={bodyId} className="mt-1 space-y-1">
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
    </>
  );
};

export default NavBarMobileMenu;
