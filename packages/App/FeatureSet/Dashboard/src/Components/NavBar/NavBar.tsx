import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import URL from "Common/Types/API/URL";
import NavBar from "Common/UI/Components/Navbar/NavBar";
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
  const { navItems, moreMenuItems, rightElement }: DashboardNavigationItems =
    useDashboardNavigationItems();

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
    />
  );
};

export default DashboardNavbar;
