import { PostProcessorModule } from "i18next";
import { isProductRenamed, withProductName } from "./ProductBranding";

/*
 * Puts the installation's own name in the product's sentences.
 *
 * The frontends write OneUptime's name into many sentences ("Sign in to
 * OneUptime", "OneUptime AI found..."), in every language. When the
 * installation goes by another name (ProductBranding), each frontend that
 * shows the product to its users - the Dashboard, Accounts, status pages -
 * registers this i18next post-processor, and every translated string comes
 * out with the name replaced as a word (ProductBrandingUtil.replaceProductName:
 * not inside identifiers, paths, domains or other casings, so commands, URLs
 * and environment variables are left alone).
 *
 * It runs after interpolation, so a value placed into a sentence is read too:
 * a probe named "OneUptime Probe" reads "<name> Probe" inside a sentence.
 *
 * Not registered by the Admin Dashboard: that is where the installation's
 * operators manage the OneUptime license, and a license notice names its
 * licensor.
 *
 * Off (and not even registered with the instance's options) while the
 * installation shows OneUptime's own name, so an install without a name of
 * its own runs exactly as before.
 */

export const PRODUCT_NAME_POST_PROCESSOR: string = "productName";

export const productNamePostProcessor: PostProcessorModule = {
  type: "postProcessor",
  name: PRODUCT_NAME_POST_PROCESSOR,
  process: (value: string): string => {
    return typeof value === "string" ? withProductName(value) : value;
  },
};

// The `postProcess` init option for a frontend's i18next instance.
export const getProductNamePostProcess: () => Array<string> | false = ():
  | Array<string>
  | false => {
  return isProductRenamed() ? [PRODUCT_NAME_POST_PROCESSOR] : false;
};
