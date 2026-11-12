import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import URL from "Common/Types/API/URL";
import NavBar from "Common/UI/Components/Navbar/NavBar";
import { PhoneMenuHelp, PhoneMenuSearch } from "./PhoneMenuEntries";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  show: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  /*
   * The nav/products catalog is shared with the command palette via this hook
   * (single source of truth). Called before the early return so the hook order
   * stays stable across show/hide.
   */
  const {
    navItems,
    moreMenuItems,
    moreMenuCategoriesOpenByDefault,
    rightElement,
  }: DashboardNavigationItems = useDashboardNavigationItems();

  if (!props.show) {
    return <></>;
  }

  // Define the more menu footer
  const moreMenuFooter: any = {
    title: t("navbar.moreFooter.title"),
    description: t("navbar.moreFooter.description"),
    link: URL.fromString(
      "https://github.com/OneUptime/oneuptime/issues/new/choose",
    ),
  };

  return (
    <NavBar
      items={navItems}
      rightElement={rightElement}
      moreMenuItems={moreMenuItems}
      /*
       * The menu always opens with Essentials expanded, the first row of
       * its list of categories; every other category is one row until it
       * is opened (on a phone too). Search still finds every product.
       */
      moreMenuCategoriesOpenByDefault={moreMenuCategoriesOpenByDefault}
      moreMenuFooter={moreMenuFooter}
      moreMenuSearchPlaceholder={t("navbar.search.placeholder")}
      moreMenuNoResultsText={t("navbar.search.noResults")}
      moreMenuKeyboardHint={t("navbar.search.hint")}
      moreMenuRecentLabel={t("navbar.search.recent")}
      /*
       * Cmd/Ctrl+K belongs to the command palette on the dashboard — the
       * products menu stays reachable via its button and the palette itself.
       */
      disableCommandKShortcut={true}
      /*
       * The header has no room for Search and Help on a phone (#6816):
       * the phone's menu starts with Search and ends with Help. It is the
       * phone's menu below 768px only; from there up the header draws
       * them (#7037).
       */
      mobileMenuTop={(closeMenu: () => void): ReactElement => {
        return <PhoneMenuSearch closeMenu={closeMenu} />;
      }}
      mobileMenuBottom={(closeMenu: () => void): ReactElement => {
        return <PhoneMenuHelp closeMenu={closeMenu} />;
      }}
    />
  );
};

export default DashboardNavbar;
