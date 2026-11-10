import React, { FunctionComponent, ReactElement, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceShowcaseCard from "../ResourceShowcase/ResourceShowcaseCard";
import {
  PRODUCT_ABOUT_TEXT,
  ProductKey,
  ProductOnboarding,
} from "./ProductOnboarding";
import { getProductOnboarding } from "./ProductOnboardings";

/*
 * "How it works" beside a product page's title (Page's titleRight): the
 * product's explanation - what it does, its first steps, an example and its
 * documentation - one click away once the page has data of its own and no
 * longer shows it. Every product's layout draws one.
 */

export const PRODUCT_ABOUT_BUTTON_TEST_ID: string = "product-about-button";
export const PRODUCT_ABOUT_DIALOG_TEST_ID: string = "product-about-dialog";

export const PRODUCT_ABOUT_BUTTON_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export interface ComponentProps {
  product: ProductKey;
}

const ProductAboutButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const onboarding: ProductOnboarding = getProductOnboarding(props.product);

  return (
    <>
      <button
        type="button"
        className={PRODUCT_ABOUT_BUTTON_CLASS_NAME}
        aria-haspopup="dialog"
        data-testid={PRODUCT_ABOUT_BUTTON_TEST_ID}
        onClick={() => {
          setIsOpen(true);
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
              isBare={true}
            />
          </div>
        </Modal>
      )}
    </>
  );
};

export default ProductAboutButton;
