import useDashboardProductsMenu, {
  DashboardProductsMenu,
} from "../../Utils/ProjectProducts/UseDashboardProductsMenu";
import {
  ProductPinSource,
  setProductPinned,
} from "../../Utils/ProjectProducts/ProductPinActions";
import { getItemProduct } from "../../Utils/ProjectProducts/ProductsMenu";
import { HiddenProductsMenuNote } from "./HiddenProductsMenuNote";
import URL from "Common/Types/API/URL";
import ProductKey from "Common/Types/Product/ProductKey";
import { canPinAnotherProduct } from "Common/Types/Product/ProductPins";
import NavBar, { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { PhoneMenuHelp, PhoneMenuSearch } from "./PhoneMenuEntries";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  show: boolean;
}

// The products menu's row of the products a project hides (#6814).
export const HIDDEN_PRODUCTS_TITLE: string = translationKey("More products");

// The heading of a person's pinned products, on a phone.
export const PINNED_PRODUCTS_LABEL: string = translationKey("Pinned");

const DashboardNavbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

  /*
   * The nav/products catalog is shared with the command palette via this hook
   * (single source of truth), fitted to the project's products (#6814): the
   * ones it hides move under More products, the ones in use come first, and
   * this person's pins sit beside Home and Products. Called before the early
   * return so the hook order stays stable across show/hide.
   */
  const {
    navItems,
    moreMenuCategoriesOpenByDefault,
    rightElement,
    menu,
    products,
  }: DashboardProductsMenu = useDashboardProductsMenu();

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

  const togglePin: (item: MoreMenuItem) => void = (
    item: MoreMenuItem,
  ): void => {
    const product: ProductKey | null = getItemProduct(item);
    const projectId: string | undefined =
      ProjectUtil.getCurrentProjectId()?.toString();

    if (!product || !projectId) {
      return;
    }

    setProductPinned({
      projectId: projectId,
      product: product,
      isPinned: !products.answer.pinned.includes(product),
      source: ProductPinSource.Menu,
    }).catch(() => {
      // The pin went back; the bar shows what the server kept.
    });
  };

  return (
    <NavBar
      items={navItems}
      rightElement={rightElement}
      moreMenuItems={menu.listed}
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
       * The products the project hides (#6814): one row at the foot of the
       * menu, found by Search, with a word on why they are there.
       */
      moreMenuHiddenItems={menu.hidden}
      moreMenuHiddenTitle={translator.translateText(HIDDEN_PRODUCTS_TITLE)}
      moreMenuHiddenFooter={(closeMenu: () => void): ReactElement => {
        return (
          <HiddenProductsMenuNote
            canChooseProducts={products.answer.canChooseProducts}
            onNavigate={closeMenu}
          />
        );
      }}
      pinnedItems={menu.pinned}
      pinnedLabel={PINNED_PRODUCTS_LABEL}
      onTogglePin={togglePin}
      canPinMore={canPinAnotherProduct(products.answer.pinned)}
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
