import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import ProductBrandingUtil, {
  ProductBranding,
} from "../../Types/Branding/ProductBranding";
import { JSONObject } from "../../Types/JSON";

/*
 * What a server-rendered page is told about how the installation names and
 * shows itself (EnterpriseEdition.getProductBranding), so the page is branded
 * before any JavaScript runs: every frontend's index page
 * (FeatureSet/Frontend) and the pages the server renders itself
 * (Response.render: sign-in messages, on-call acknowledgements). EJS escapes
 * each value (<%= %>).
 *
 *   productName        "OneUptime" unless the installation goes by another
 *                      name
 *   productLogoUrl     its own logo for light backgrounds, a path on this
 *                      host; absent when it has none
 *   productFaviconUrl  its own browser tab icon, a path on this host; absent
 *                      when it has none
 *
 * A page rendered without them shows OneUptime's.
 */
export const getProductBrandingViewVariables: () => JSONObject =
  (): JSONObject => {
    const branding: ProductBranding | null =
      EnterpriseEdition.getProductBranding();

    const variables: JSONObject = {
      productName: ProductBrandingUtil.getProductName(branding),
    };

    if (branding?.logoUrl) {
      variables["productLogoUrl"] = branding.logoUrl;
    }

    if (branding?.faviconUrl) {
      variables["productFaviconUrl"] = branding.faviconUrl;
    }

    return variables;
  };
