/*
 * The look of the quiet buttons beside a product page's title: How it works
 * (ProductAboutButton) and Pin (ProductPinButton, #6814), and Home's How
 * OneUptime works. A module of its own, so the pin and the button that
 * draws it do not import each other.
 */

// Their shape, without a colour: a pressed Pin is drawn in the brand's.
export const PRODUCT_TITLE_BUTTON_SHAPE_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// Their quiet grey.
export const PRODUCT_TITLE_BUTTON_COLOR_CLASS_NAME: string =
  "text-gray-500 hover:text-gray-700";

export const PRODUCT_TITLE_BUTTON_CLASS_NAME: string = `${PRODUCT_TITLE_BUTTON_SHAPE_CLASS_NAME} ${PRODUCT_TITLE_BUTTON_COLOR_CLASS_NAME}`;
