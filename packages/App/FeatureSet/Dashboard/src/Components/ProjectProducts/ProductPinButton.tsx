import {
  PRODUCT_PIN_PAGE_BUTTON_TEST_ID,
  ProductPinCopy,
} from "./ProjectProductsCopy";
import {
  PRODUCT_TITLE_BUTTON_COLOR_CLASS_NAME,
  PRODUCT_TITLE_BUTTON_HOVER_CLASS_NAME,
  PRODUCT_TITLE_BUTTON_SHAPE_CLASS_NAME,
} from "../ProductOnboarding/ProductTitleButtonClassName";
import {
  ProductPinSource,
  setProductPinned,
} from "../../Utils/ProjectProducts/ProductPinActions";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import IconProp from "Common/Types/Icon/IconProp";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  MAX_PINNED_PRODUCTS,
  canPinAnotherProduct,
} from "Common/Types/Product/ProductPins";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "Pin" beside a product page's title (issue #6814), next to How it works:
 * puts the product in the top bar, beside Home and Products, for this
 * person in this project, on every browser. Pinned, it reads "Pinned" in
 * the brand's colour, and a press unpins it. With five pinned, it is locked
 * and says why.
 */

export interface ComponentProps {
  product: ProductKey;
}

const ProductPinButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const state: ProjectProductsState = useProjectProducts();
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  if (!projectId) {
    return <></>;
  }

  const isPinned: boolean = state.answer.pinned.includes(props.product);
  const isLocked: boolean =
    !isPinned && !canPinAnotherProduct(state.answer.pinned);

  const tooltip: string | undefined = isLocked
    ? translator.translatePlural(
        ProductPinCopy.limitReached,
        MAX_PINNED_PRODUCTS,
      )
    : translator.translateText(
        isPinned ? ProductPinCopy.unpinTooltip : ProductPinCopy.pinTooltip,
      );

  return (
    <button
      type="button"
      className={`${PRODUCT_TITLE_BUTTON_SHAPE_CLASS_NAME} ${
        isPinned ? "text-indigo-600" : PRODUCT_TITLE_BUTTON_COLOR_CLASS_NAME
      } ${getHandDrawnButtonStateClassName({
        isLocked: isLocked,
        isBusy: isSaving,
        hoverClassName: isPinned
          ? "hover:bg-gray-100 hover:text-indigo-700"
          : PRODUCT_TITLE_BUTTON_HOVER_CLASS_NAME,
      })}`}
      aria-pressed={isPinned}
      title={tooltip}
      disabled={isLocked || isSaving}
      data-testid={PRODUCT_PIN_PAGE_BUTTON_TEST_ID}
      onClick={() => {
        setIsSaving(true);
        setProductPinned({
          projectId: projectId,
          product: props.product,
          isPinned: !isPinned,
          source: ProductPinSource.Page,
        })
          .catch(() => {
            // The pin went back: the button shows what the server kept.
          })
          .finally(() => {
            setIsSaving(false);
          });
      }}
    >
      <Icon icon={IconProp.Pin} className="h-4 w-4 flex-shrink-0" />
      <span>
        {translator.translateText(
          isPinned ? ProductPinCopy.pinned : ProductPinCopy.pin,
        )}
      </span>
    </button>
  );
};

export default ProductPinButton;
