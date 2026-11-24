import useDashboardProductsMenu, {
  DashboardProductsMenu,
} from "../../Utils/ProjectProducts/UseDashboardProductsMenu";
import {
  ProductPinSource,
  setProductPinned,
} from "../../Utils/ProjectProducts/ProductPinActions";
import { getItemProduct } from "../../Utils/ProjectProducts/ProductsMenu";
import { loadQuietly } from "../../Utils/ProjectProducts/UseProjectProducts";
import { HiddenProductsMenuNote } from "./HiddenProductsMenuNote";
import URL from "Common/Types/API/URL";
import {
  ONEUPTIME_REPORT_ISSUE_URL,
  isOneUptimeGitHubShown,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { useHelpAndSupport } from "Common/UI/Utils/HelpAndSupport";
import ProductKey from "Common/Types/Product/ProductKey";
import { canPinAnotherProduct } from "Common/Types/Product/ProductPins";
import NavBar, { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
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

/*
 * The products menu's search box, as a screen reader names it: the words
 * of its placeholder ("Search products…") without the "…" (#7486).
 */
export const PRODUCTS_SEARCH_LABEL: string = translationKey("Search products");

/*
 * A pin the server did not keep (#9120). The bar puts the product back
 * where it was, and this says why: it went back without a word, so a
 * person without the permission saw their pin vanish and could not tell.
 */
export const PIN_FAILED_TITLE: string = translationKey(
  "Couldn't pin {{product}}.",
);

export const UNPIN_FAILED_TITLE: string = translationKey(
  "Couldn't unpin {{product}}.",
);

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

  /*
   * Report a bug or request a feature, on OneUptime's GitHub - unless the
   * server's admins took OneUptime's GitHub links away (Admin Dashboard >
   * Settings > Help and Support, #10866). Read before the early return, so
   * the hook order stays stable across show/hide.
   */
  const isGitHubShown: boolean = isOneUptimeGitHubShown(useHelpAndSupport());

  if (!props.show) {
    return <></>;
  }

  const moreMenuFooter: any = isGitHubShown
    ? {
        title: t("navbar.moreFooter.title"),
        description: t("navbar.moreFooter.description"),
        link: URL.fromString(ONEUPTIME_REPORT_ISSUE_URL),
      }
    : undefined;

  const togglePin: (item: MoreMenuItem) => void = (
    item: MoreMenuItem,
  ): void => {
    const product: ProductKey | null = getItemProduct(item);
    const projectId: string | undefined =
      ProjectUtil.getCurrentProjectId()?.toString();

    if (!product || !projectId) {
      return;
    }

    const isPinned: boolean = !products.answer.pinned.includes(product);

    setProductPinned({
      projectId: projectId,
      product: product,
      isPinned: isPinned,
      source: ProductPinSource.Menu,
    }).catch((err: unknown) => {
      // The pin went back; the bar shows what the server kept, and this says why.
      const productName: string = item.isTitleTranslated
        ? item.title
        : translator.translateText(item.title) || item.title;

      Toast.error(
        translator.translateTemplate(
          isPinned ? PIN_FAILED_TITLE : UNPIN_FAILED_TITLE,
          { product: productName },
        ),
        {
          description: (
            <ErrorLine as="div" message={API.getFriendlyMessage(err)} />
          ),
          dataTestId: "product-pin-failed",
        },
      );
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
      /*
       * Keyed texts, in the reader's words here: drawn as given, never
       * looked up again (#7682, #7790).
       */
      isMoreMenuFooterTranslated={true}
      moreMenuSearchPlaceholder={t("navbar.search.placeholder")}
      moreMenuSearchLabel={PRODUCTS_SEARCH_LABEL}
      isMoreMenuSearchPlaceholderTranslated={true}
      moreMenuNoResultsText={t("navbar.search.noResults")}
      isMoreMenuNoResultsTextTranslated={true}
      moreMenuKeyboardHint={t("navbar.search.hint")}
      isMoreMenuKeyboardHintTranslated={true}
      moreMenuRecentLabel={t("navbar.search.recent")}
      isMoreMenuRecentLabelTranslated={true}
      /*
       * The products the project hides (#6814): one row at the foot of the
       * menu, found by Search, with a word on why they are there. Its
       * title goes over in English, as its pinned label does, and the menu
       * looks it up once, as it does a category's (#8075).
       */
      moreMenuHiddenItems={menu.hidden}
      moreMenuHiddenTitle={HIDDEN_PRODUCTS_TITLE}
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
       * Its "Not set up" marks as they are now, as the menu is read: asked
       * again once the answer is older than REFRESH_AFTER_MS (#7465).
       */
      onMenuOpen={() => {
        loadQuietly();
      }}
      /*
       * Cmd/Ctrl+K belongs to the command palette on the dashboard — the
       * products menu stays reachable via its button and the palette itself.
       */
      disableCommandKShortcut={true}
      /*
       * The header has no room for Search and Help on a phone (#6816):
       * the phone's menu starts with them, Search and then Help, above
       * Home and every product, as the header draws them side by side
       * from 768px up (#7037). Help, with Give feedback in it, ended the
       * menu, under every product of a busy project, where people
       * scrolled looking for it (#7473).
       */
      mobileMenuTop={(closeMenu: () => void): ReactElement => {
        return (
          <>
            <PhoneMenuSearch closeMenu={closeMenu} />
            <PhoneMenuHelp closeMenu={closeMenu} />
          </>
        );
      }}
    />
  );
};

export default DashboardNavbar;
