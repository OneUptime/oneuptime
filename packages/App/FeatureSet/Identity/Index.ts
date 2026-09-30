import AuthenticationAPI from "./API/Authentication";
import ResellerAPI from "./API/Reseller";
import StatusPageAuthenticationAPI from "./API/StatusPageAuthentication";
import { SSO_ROUTERS } from "./SsoRouters";
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
     * Single sign-on - SAML and OIDC for projects, the whole instance and
     * status pages (./SsoRouters.ts) - is served in every edition, at the
     * paths customers' identity providers are configured with.
     */
    for (const ssoRouter of SSO_ROUTERS) {
      app.use([`/${APP_NAME}`, "/"], ssoRouter.router);
    }

    /*
     * The Enterprise Edition module (ee/) adds SCIM provisioning for projects
     * and status pages, mounted right after core's identity routers at the
     * same two prefixes, so the SCIM base URLs configured at customers'
     * identity providers keep working unchanged. The Community Edition mounts
     * none. They are mounted once, but every SCIM route asks the license per
     * request and refuses while SCIM is not active (a lapsed license). No SCIM
     * path overlaps an SSO path, so the order between the two blocks does not
     * change which router answers.
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
