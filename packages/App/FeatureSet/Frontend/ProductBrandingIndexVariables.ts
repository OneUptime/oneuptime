import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import ProductBrandingUtil, {
  ProductBranding,
} from "Common/Types/Branding/ProductBranding";
import { JSONObject } from "Common/Types/JSON";

/*
 * What every frontend's index page is rendered with about the installation's
 * branding, before any JavaScript runs: the product name for the page title
 * and the browser tab icon. EJS escapes both (<%= %>).
 *
 *   productName        "OneUptime" unless the installation goes by another
 *                      name (EnterpriseEdition.getProductBranding)
 *   productFaviconUrl  the installation's own tab icon, a path on this host;
 *                      absent when it has none, and the page keeps
 *                      OneUptime's icons
 *
 * Kept apart from Index.ts, which starts the express app when it is loaded,
 * so a test can render these without booting the server.
 */
export const getProductBrandingIndexVariables: () => JSONObject =
  (): JSONObject => {
    const branding: ProductBranding | null =
      EnterpriseEdition.getProductBranding();

    const variables: JSONObject = {
      productName: ProductBrandingUtil.getProductName(branding),
    };

    if (branding?.faviconUrl) {
      variables["productFaviconUrl"] = branding.faviconUrl;
    }

    return variables;
  };
