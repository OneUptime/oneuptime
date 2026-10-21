import type { ExpressRouter } from "Common/Server/Utils/Express";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import EnterpriseArea from "../Types/EnterpriseArea";
import { createWhiteLabelRouter } from "./API/WhiteLabelAPI";
import whiteLabelProvider from "./WhiteLabelProvider";

/*
 * White-labelling: an installation whose license allows it can replace
 * OneUptime's name and logo with its own (Admin Dashboard > Settings >
 * White Label). See ee/README.md, "White-labelling".
 *
 *   init           reads the settings, so the first page after a boot is
 *                  already branded (never throws: a failed read is retried)
 *   getApiRouters  the settings and image routes (API/WhiteLabelAPI.ts)
 *
 * and the module's getProductBranding (../Index.ts) answers core from
 * getProductBranding below.
 */

/*
 * What core shows (EnterpriseServerModule.getProductBranding): null unless
 * the license allows white-labelling. Never throws.
 */
export const getProductBranding: () => ProductBranding | null =
  (): ProductBranding | null => {
    try {
      return whiteLabelProvider.getProductBranding();
    } catch {
      return null;
    }
  };

const WhiteLabelArea: EnterpriseArea = {
  name: "WhiteLabel",
  init: async (): Promise<void> => {
    // Never throws: a failed read is logged and retried on the next ask.
    await whiteLabelProvider.refresh();
  },
  getApiRouters: (): Array<ExpressRouter> => {
    return [createWhiteLabelRouter()];
  },
};

export default WhiteLabelArea;
