import AuthenticationAPI from "./API/Authentication";
import ResellerAPI from "./API/Reseller";
import StatusPageAuthenticationAPI from "./API/StatusPageAuthentication";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import "ejs";

const IdentityFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    const APP_NAME: string = "api/identity";

    app.use([`/${APP_NAME}`, "/"], AuthenticationAPI);

    app.use([`/${APP_NAME}`, "/"], ResellerAPI);

    /*
     * Enterprise identity protocols - SAML and OIDC single sign-on for
     * projects, the whole instance and status pages, and SCIM provisioning -
     * are served by the Enterprise Edition module (ee/). They are mounted at
     * the same paths and in the same position the core routers used to have,
     * so the ACS, redirect and SCIM URLs configured at customers' identity
     * providers keep working unchanged. The Community Edition mounts none.
     */
    const enterpriseIdentityRouters: Array<ExpressRouter> =
      EnterpriseEdition.getModule()?.getIdentityRouters() || [];

    for (const enterpriseIdentityRouter of enterpriseIdentityRouters) {
      app.use([`/${APP_NAME}`, "/"], enterpriseIdentityRouter);
    }

    app.use(
      [`/${APP_NAME}/status-page`, "/status-page"],
      StatusPageAuthenticationAPI,
    );
  },
};

export default IdentityFeatureSet;
