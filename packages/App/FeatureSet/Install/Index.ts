import { createInstallFilesRouter } from "./API/InstallFiles";
import { InstallFilesRoot } from "./Config";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";

/*
 * The agents' install scripts and the files they download, served by every
 * OneUptime from its own image (Common/Types/InstallScripts lists them):
 * https://oneuptime.com/install/proxmox-agent on OneUptime Cloud, and the
 * same address on a self-hosted OneUptime's own host. The Dashboard's
 * install commands and the docs name it, never GitHub.
 *
 * "/install" is reserved against both SPA fallbacks
 * (Frontend/RouteReservations.ts), and nginx sends /install/ to the App
 * whatever BILLING_ENABLED says (Nginx/default.conf.template), so the
 * marketing site never answers it on OneUptime Cloud.
 */
const InstallFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    app.use(
      "/install",
      createInstallFilesRouter({
        root: InstallFilesRoot,
        version: AppVersion,
      }),
    );
  },
};

export default InstallFeatureSet;
