import {
  HIDDEN_PRODUCTS_WITH_DATA_TEST_ID,
  HiddenProductsWithDataCopy,
} from "./ProjectProductsCopy";
import { formatNameList } from "../AiAccess/AiAccessModes";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import { getItemProduct } from "../../Utils/ProjectProducts/ProductsMenu";
import ProjectProducts, {
  ProjectProductsState,
} from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import IconProp from "Common/Types/Icon/IconProp";
import ProductKey from "Common/Types/Product/ProductKey";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import API from "Common/UI/Utils/API/API";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A HIDDEN PRODUCT THAT STARTED RECEIVING DATA SAYS SO (issue #6814).
 *
 * One line on Home, for whoever may choose the project's products: "Logs is
 * hidden in this project and has data." Hidden is not off, so the data
 * arrives either way; the line only asks whether the menu should show it
 * again. Show It shows it; Keep Hidden keeps it hidden on purpose, and the
 * line does not come back for it. A product hidden while it already had
 * data was hidden knowing that, so it never brings the line.
 *
 * Nothing at all for anyone else, and nothing while nothing hidden has data
 * (ProjectProductsAnswer.hiddenWithData, worked out by the server).
 */

export const getHiddenProductNames: (data: {
  products: ReadonlyArray<ProductKey>;
  items: ReadonlyArray<MoreMenuItem>;
}) => Array<string> = (data: {
  products: ReadonlyArray<ProductKey>;
  items: ReadonlyArray<MoreMenuItem>;
}): Array<string> => {
  const names: Array<string> = [];

  for (const product of data.products) {
    const item: MoreMenuItem | undefined = data.items.find(
      (candidate: MoreMenuItem): boolean => {
        return getItemProduct(candidate) === product;
      },
    );

    if (item) {
      names.push(item.title);
    }
  }

  return names;
};

const HiddenProductsWithData: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const navigation: DashboardNavigationItems = useDashboardNavigationItems();
  const state: ProjectProductsState = useProjectProducts();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const products: Array<ProductKey> = state.answer.hiddenWithData;

  if (!state.answer.canChooseProducts || products.length === 0) {
    return <></>;
  }

  const names: Array<string> = getHiddenProductNames({
    products: products,
    items: navigation.moreMenuItems,
  });

  if (names.length === 0) {
    return <></>;
  }

  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  // Shows them all (Show It) or keeps them all hidden on purpose.
  const decide: (isShown: boolean) => Promise<void> = async (
    isShown: boolean,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      for (const product of products) {
        await ProjectProducts.setProductShown(projectId, {
          product: product,
          isShown: isShown,
        });

        if (isShown) {
          ProductEvents.send(ProductEventName.ProductShown, {
            product: product,
            source: "home",
          });
        } else {
          ProductEvents.send(ProductEventName.ProductHidden, {
            product: product,
            source: "home",
            has_data: true,
          });
        }
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  return (
    <div
      data-testid={HIDDEN_PRODUCTS_WITH_DATA_TEST_ID}
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          icon={IconProp.EyeSlash}
          className="mt-0.5 h-5 w-5 flex-none text-amber-600"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {translator.translatePlural(
              HiddenProductsWithDataCopy.sentence,
              names.length,
              {
                products: composedValue((sentence: Translator): string => {
                  return formatNameList(names, "and", sentence);
                }),
              },
            )}
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {translator.translatePlural(
              HiddenProductsWithDataCopy.description,
              names.length,
            )}
          </p>
          {error ? (
            <p className="mt-1 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2 pl-8 sm:pl-0">
        <Button
          title={
            names.length === 1
              ? HiddenProductsWithDataCopy.showOne
              : HiddenProductsWithDataCopy.showSeveral
          }
          buttonStyle={ButtonStyleType.PRIMARY}
          buttonSize={ButtonSize.Small}
          disabled={isSaving}
          dataTestId={`${HIDDEN_PRODUCTS_WITH_DATA_TEST_ID}-show`}
          onClick={() => {
            decide(true).catch(() => {
              // Said in the line.
            });
          }}
        />
        <Button
          title={HiddenProductsWithDataCopy.keepHidden}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          disabled={isSaving}
          dataTestId={`${HIDDEN_PRODUCTS_WITH_DATA_TEST_ID}-keep`}
          onClick={() => {
            decide(false).catch(() => {
              // Said in the line.
            });
          }}
        />
      </div>
    </div>
  );
};

export default HiddenProductsWithData;
