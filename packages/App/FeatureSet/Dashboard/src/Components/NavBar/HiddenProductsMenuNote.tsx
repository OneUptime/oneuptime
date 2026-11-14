import { HiddenProductsMenuCopy } from "../ProjectProducts/ProjectProductsCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Under the products menu's More products (issue #6814): why these products
 * are there - the project hides them, and they still work - and, for
 * whoever may choose the project's products, the way to change it.
 */

export interface ComponentProps {
  canChooseProducts: boolean;
  // Following the link closes the menu.
  onNavigate: () => void;
}

export const HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID: string =
  "navbar-menu-choose-products";

export const HiddenProductsMenuNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{translator.translateText(HiddenProductsMenuCopy.note)}</span>
      {props.canChooseProducts ? (
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_PRODUCTS] as Route,
          )}
          onClick={props.onNavigate}
          dataTestId={HIDDEN_PRODUCTS_CHOOSE_LINK_TEST_ID}
          className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
        >
          {translator.translateText(HiddenProductsMenuCopy.chooseProducts)}
        </Link>
      ) : (
        <></>
      )}
    </p>
  );
};

export default HiddenProductsMenuNote;
