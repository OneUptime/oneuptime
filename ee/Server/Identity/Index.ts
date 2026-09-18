import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Enterprise identity: SAML and OIDC single sign-on for projects, the whole
 * instance and status pages, and SCIM provisioning (projects and status
 * pages). The routers keep their exact paths - customers' identity providers
 * are configured with them.
 *
 * Skeleton: no routers yet. The identity routers move here from
 * packages/App/FeatureSet/Identity/API.
 */
const IdentityArea: EnterpriseArea = {
  name: "Identity",
  getIdentityRouters: (): Array<ExpressRouter> => {
    return [];
  },
};

export default IdentityArea;
