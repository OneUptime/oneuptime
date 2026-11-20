import AuthenticationAPI from "./API/Authentication";
import FirstAccountAPI from "./API/FirstAccount";
import ResellerAPI from "./API/Reseller";
import MicrosoftSignInAPI from "./API/MicrosoftSignIn";
import GoogleSignInAPI from "./API/GoogleSignIn";
import SignInMethodsAPI from "./API/SignInMethods";
import SsoSignInLinksAPI from "./API/SsoSignInLinks";
import MobileSsoExchangeAPI from "./API/MobileSsoExchange";
import StatusPageAuthenticationAPI from "./API/StatusPageAuthentication";
import DashboardPrivateUserAuthenticationAPI from "./API/DashboardPrivateUserAuthentication";
import { SSO_ROUTERS } from "./SsoRouters";
import { DASHBOARD_PRIVATE_USER_API_ROUTE } from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import FormPrivateUserAuthenticationAPI from "./API/FormPrivateUserAuthentication";
import { FORM_PRIVATE_USER_API_ROUTE } from "Common/Types/Form/FormPrivateUserSignIn";
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

    // Whether a self-hosted server is waiting for its first account.
    app.use([`/${APP_NAME}`, "/"], FirstAccountAPI);

    app.use([`/${APP_NAME}`, "/"], ResellerAPI);

    // Sign in with Microsoft (offered when MICROSOFT_SIGN_IN_CLIENT_ID is set).
    app.use([`/${APP_NAME}`, "/"], MicrosoftSignInAPI);

    // Continue with Google (offered when GOOGLE_SIGN_IN_CLIENT_ID is set).
    app.use([`/${APP_NAME}`, "/"], GoogleSignInAPI);

    /*
     * How this server signs people in - whether it requires single sign-on,
     * and with which providers - for its sign-in pages (./API/SignInMethods).
     */
    app.use([`/${APP_NAME}`, "/"], SignInMethodsAPI);

    /*
     * "Sign in with SSO"'s Email Me My Sign-in Links: the SSO sign-in links
     * of an address's organizations, emailed to it, every address answered
     * alike (./API/SsoSignInLinks, #9987).
     */
    app.use([`/${APP_NAME}`, "/"], SsoSignInLinksAPI);

    /*
     * Where the mobile app redeems the one-time code an SSO sign-in handed
     * back to it, with its PKCE verifier (./API/MobileSsoExchange, #9989).
     */
    app.use([`/${APP_NAME}`, "/"], MobileSsoExchangeAPI);

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
     * request and refuses while SCIM is not active (a lapsed license). On
     * OneUptime Cloud (billing on) the module adds sign-in from Vercel
     * Marketplace (/vercel/sso) too. No path of theirs overlaps an SSO path,
     * so the order between the two blocks does not change which router
     * answers.
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

    /*
     * A dashboard's public link signs its private users in on the host it
     * is served from (#10250): every host passes /public-dashboard-api to
     * the app as /api/dashboard (Nginx/default.conf.template), so the
     * router answers under it, beside the link's other routes - and only
     * there: no route of it is mounted at the root.
     */
    app.use(
      `/api/dashboard${DASHBOARD_PRIVATE_USER_API_ROUTE}`,
      DashboardPrivateUserAuthenticationAPI,
    );

    /*
     * A form's public link signs its private users in on the host it is
     * served from (#10249): its page calls /api/form on OneUptime's address
     * and on every custom domain of the form, so the router answers under
     * it, beside the form's own public routes - and only there.
     */
    app.use(
      `/api/form${FORM_PRIVATE_USER_API_ROUTE}`,
      FormPrivateUserAuthenticationAPI,
    );
  },
};

export default IdentityFeatureSet;
