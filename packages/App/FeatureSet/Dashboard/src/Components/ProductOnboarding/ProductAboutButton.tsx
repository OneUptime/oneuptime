import ProductEvents from "Common/UI/Utils/ProductEvents";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import React, { FunctionComponent, ReactElement, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceShowcaseCard from "../ResourceShowcase/ResourceShowcaseCard";
import {
  PRODUCT_ABOUT_TEXT,
  OnboardedProductKey,
  ProductOnboarding,
} from "./ProductOnboarding";
import { getProductOnboarding } from "./ProductOnboardings";
import { PRODUCT_TITLE_BUTTON_CLASS_NAME } from "./ProductTitleButtonClassName";
import ProductPinButton from "../ProjectProducts/ProductPinButton";

/*
 * "How it works" beside a product page's title (Page's titleRight): the
 * product's explanation - what it does, its first steps, an example and its
 * documentation - one click away once the page has data of its own and no
 * longer shows it. Every product's layout draws one.
 *
 * Beside it, Pin (issue #6814): puts the product in the top bar for this
 * person (ProductPinButton). Drawn here, so every product's page has it
 * wherever its layout draws How it works.
 */

export const PRODUCT_ABOUT_BUTTON_TEST_ID: string = "product-about-button";
export const PRODUCT_ABOUT_DIALOG_TEST_ID: string = "product-about-dialog";

export const PRODUCT_ABOUT_BUTTON_CLASS_NAME: string =
  PRODUCT_TITLE_BUTTON_CLASS_NAME;

export interface ComponentProps {
  product: OnboardedProductKey;
}

const ProductAboutButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const onboarding: ProductOnboarding = getProductOnboarding(props.product);

  return (
    <>
      <ProductPinButton product={props.product} />
      <button
        type="button"
        className={PRODUCT_ABOUT_BUTTON_CLASS_NAME}
        aria-haspopup="dialog"
        data-testid={PRODUCT_ABOUT_BUTTON_TEST_ID}
        onClick={() => {
          setIsOpen(true);
          // Who opens the explanation, and for which product (issue #6830).
          ProductEvents.send(ProductEventName.HowItWorksOpened, {
            product: props.product,
          });
        }}
      >
        <Icon
          icon={IconProp.InformationCircle}
          className="h-4 w-4 flex-shrink-0"
        />
        <span>{translator.translateText(PRODUCT_ABOUT_TEXT)}</span>
      </button>
      {isOpen && (
        <Modal
          title={onboarding.name}
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setIsOpen(false);
          }}
          closeButtonText="Close"
        >
          <div data-testid={PRODUCT_ABOUT_DIALOG_TEST_ID}>
            <ResourceShowcaseCard
              showcase={onboarding.showcase}
              docsRoute={onboarding.docsRoute}
              guideRoute={onboarding.guideRoute}
              isBare={true}
            />
          </div>
        </Modal>
      )}
    </>
  );
};

export default ProductAboutButton;
