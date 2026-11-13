import ProductSwitchRow, { ProductSwitchSaveState } from "./ProductSwitchRow";
import {
  getProductSwitchTestId,
  PRODUCTS_SETTINGS_TEST_ID,
  ProductsSettingsCopy,
  SHOW_EVERY_PRODUCT_TEST_ID,
} from "./ProjectProductsCopy";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../Utils/NavigationItems";
import { getItemProduct } from "../../Utils/ProjectProducts/ProductsMenu";
import ProjectProducts, {
  ProjectProductsState,
} from "../../Utils/ProjectProducts/ProjectProductsStore";
import { useLoadedProjectProducts } from "../../Utils/ProjectProducts/UseProjectProducts";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import ProductKey from "Common/Types/Product/ProductKey";
import { ProductUsage } from "Common/Types/Product/ProductUsage";
import {
  ProjectProductsChosenBy,
  isHideableProduct,
} from "Common/Types/Product/ProjectProducts";
import { ProjectProductsAnswer } from "Common/Types/Product/ProjectProductsAnswer";
import { ServerProductOffCopy } from "../ServerProducts/ServerProductsCopy";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import {
  groupItemsByCategory,
  MenuCategory,
} from "Common/UI/Components/Navbar/NavBarMenuCatalog";
import API from "Common/UI/Utils/API/API";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * PROJECT SETTINGS > PRODUCTS (issue #6814): the catalog by category, each
 * product with the switch that shows it in this project.
 *
 * Hidden is not off: a hidden product moves under More products at the
 * foot of the menu, Search still finds it, its pages keep working and its
 * data keeps arriving. Each product says what it is to this project - in
 * use, not set up yet, or the plan it needs - so the choice is made knowing
 * what is in it. Users, Teams and Project Settings are always shown.
 *
 * A product switched off on the whole server (#6815) is listed as off,
 * with why and who can switch it on, instead of with a switch: the project
 * cannot show it.
 *
 * Everyone in the project can read the page; someone who may edit the
 * project changes it (the server checks it too). Each switch saves the
 * moment it is flipped; Show Every Product undoes every choice at once.
 */

const ProductsSettings: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const navigation: DashboardNavigationItems = useDashboardNavigationItems();
  const products: ProjectProductsState = useLoadedProjectProducts();
  const answer: ProjectProductsAnswer = products.answer;

  // A switch shows where it was flipped to while its change is saved.
  const [pendingShown, setPendingShown] = useState<
    Partial<Record<ProductKey, boolean>>
  >({});
  const [saveStates, setSaveStates] = useState<
    Partial<Record<ProductKey, ProductSwitchSaveState>>
  >({});
  const [errors, setErrors] = useState<Partial<Record<ProductKey, string>>>({});
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);
  const [showAllError, setShowAllError] = useState<string>("");

  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";
  const canChoose: boolean = answer.canChooseProducts;
  const lockedReason: string | undefined = canChoose
    ? undefined
    : ProductsSettingsCopy.lockedReason;

  const isShown: (product: ProductKey) => boolean = (
    product: ProductKey,
  ): boolean => {
    const pending: boolean | undefined = pendingShown[product];
    return pending !== undefined ? pending : !answer.hidden.includes(product);
  };

  const change: (product: ProductKey, shown: boolean) => Promise<void> = async (
    product: ProductKey,
    shown: boolean,
  ): Promise<void> => {
    setPendingShown(
      (
        current: Partial<Record<ProductKey, boolean>>,
      ): Partial<Record<ProductKey, boolean>> => {
        return { ...current, [product]: shown };
      },
    );
    setSaveStates(
      (
        current: Partial<Record<ProductKey, ProductSwitchSaveState>>,
      ): Partial<Record<ProductKey, ProductSwitchSaveState>> => {
        return { ...current, [product]: ProductSwitchSaveState.Saving };
      },
    );
    setErrors(
      (
        current: Partial<Record<ProductKey, string>>,
      ): Partial<Record<ProductKey, string>> => {
        const next: Partial<Record<ProductKey, string>> = { ...current };
        delete next[product];
        return next;
      },
    );

    let saved: boolean = false;

    try {
      await ProjectProducts.setProductShown(projectId, {
        product: product,
        isShown: shown,
      });
      saved = true;

      if (shown) {
        ProductEvents.send(ProductEventName.ProductShown, {
          product: product,
          source: "settings",
        });
      } else {
        ProductEvents.send(ProductEventName.ProductHidden, {
          product: product,
          source: "settings",
          has_data: answer.usage[product] === ProductUsage.InUse,
        });
      }
    } catch (err) {
      setErrors(
        (
          current: Partial<Record<ProductKey, string>>,
        ): Partial<Record<ProductKey, string>> => {
          return { ...current, [product]: API.getFriendlyMessage(err) };
        },
      );
    }

    setSaveStates(
      (
        current: Partial<Record<ProductKey, ProductSwitchSaveState>>,
      ): Partial<Record<ProductKey, ProductSwitchSaveState>> => {
        return {
          ...current,
          [product]: saved
            ? ProductSwitchSaveState.Saved
            : ProductSwitchSaveState.Idle,
        };
      },
    );
    setPendingShown(
      (
        current: Partial<Record<ProductKey, boolean>>,
      ): Partial<Record<ProductKey, boolean>> => {
        const next: Partial<Record<ProductKey, boolean>> = { ...current };
        delete next[product];
        return next;
      },
    );
  };

  const showEveryProduct: () => Promise<void> = async (): Promise<void> => {
    const hiddenCount: number = answer.hidden.length;

    setIsShowingAll(true);
    setShowAllError("");

    try {
      await ProjectProducts.showEveryProduct(projectId);
      ProductEvents.send(ProductEventName.AllProductsShown, {
        hidden_count: hiddenCount,
      });
    } catch (err) {
      setShowAllError(API.getFriendlyMessage(err));
    }

    setIsShowingAll(false);
  };

  const categories: Array<MenuCategory> = groupItemsByCategory(
    navigation.moreMenuItems,
  );

  const renderProduct: (item: MoreMenuItem) => ReactElement = (
    item: MoreMenuItem,
  ): ReactElement => {
    const product: ProductKey | null = getItemProduct(item);
    const key: string = product || item.route.toString();

    if (!product) {
      return <React.Fragment key={key} />;
    }

    return (
      <ProductSwitchRow
        key={key}
        title={item.title}
        description={item.description}
        icon={item.icon}
        iconColor={item.iconColor}
        isShown={isShown(product)}
        isAlwaysShown={!isHideableProduct(product)}
        lockedReason={lockedReason}
        saveState={saveStates[product] || ProductSwitchSaveState.Idle}
        error={errors[product]}
        isInUse={answer.usage[product] === ProductUsage.InUse}
        isNotSetUp={answer.usage[product] === ProductUsage.NotSetUp}
        neededPlan={answer.neededPlans[product]}
        offOnServerReason={answer.offOnServer[product]}
        dataTestId={getProductSwitchTestId(product)}
        onChange={(shown: boolean) => {
          change(product, shown).catch(() => {
            // Said on the row.
          });
        }}
      />
    );
  };

  return (
    <div data-testid={PRODUCTS_SETTINGS_TEST_ID}>
      <Card
        title="Products"
        description={ProductsSettingsCopy.cardDescription}
        rightElement={
          canChoose && answer.hidden.length > 0 ? (
            <Button
              title={ProductsSettingsCopy.showEveryProduct}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={isShowingAll}
              dataTestId={SHOW_EVERY_PRODUCT_TEST_ID}
              onClick={() => {
                showEveryProduct().catch(() => {
                  // Said under the card.
                });
              }}
            />
          ) : undefined
        }
      >
        <div className="space-y-2 text-sm text-gray-600">
          <p>
            {translator.translateText(ProductsSettingsCopy.hiddenExplanation)}
          </p>
          {answer.chosenBy === ProjectProductsChosenBy.Goals &&
          answer.hidden.length > 0 ? (
            <p data-testid="products-settings-from-goals">
              {translator.translateText(ProductsSettingsCopy.setFromGoals)}
            </p>
          ) : (
            <></>
          )}
          {!canChoose ? (
            <p data-testid="products-settings-locked">
              {translator.translateText(ProductsSettingsCopy.lockedReason)}
            </p>
          ) : (
            <></>
          )}
          {showAllError ? <ErrorMessage message={showAllError} /> : <></>}
        </div>
      </Card>

      {categories.map((category: MenuCategory): ReactElement => {
        const hideable: Array<MoreMenuItem> = category.items.filter(
          (item: MoreMenuItem): boolean => {
            const product: ProductKey | null = getItemProduct(item);
            return Boolean(
              product &&
                isHideableProduct(product) &&
                !answer.offOnServer[product],
            );
          },
        );
        const isEveryProductOff: boolean =
          category.items.length > 0 &&
          category.items.every((item: MoreMenuItem): boolean => {
            const product: ProductKey | null = getItemProduct(item);
            return Boolean(product && answer.offOnServer[product]);
          });
        const shownCount: number = hideable.filter(
          (item: MoreMenuItem): boolean => {
            const product: ProductKey | null = getItemProduct(item);
            return Boolean(product && isShown(product));
          },
        ).length;

        return (
          <Card
            key={category.title}
            title={category.title}
            description={
              isEveryProductOff
                ? translator.translateText(ServerProductOffCopy.rowSwitchedOff)
                : hideable.length > 0
                  ? translator.translatePlural(
                      ProductsSettingsCopy.shownCount,
                      hideable.length,
                      { shown: translator.formatNumber(shownCount) },
                    )
                  : translator.translateText(ProductsSettingsCopy.alwaysShown)
            }
          >
            <div className="divide-y divide-gray-100">
              {category.items.map(renderProduct)}
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default ProductsSettings;
