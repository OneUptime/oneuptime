import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Team compliance: the compliance-status API for teams (a plain router under
 * "/api") and the compliance service behind it.
 *
 * Skeleton: no routers yet. TeamComplianceAPI and TeamComplianceService move
 * here from packages/Common/Server.
 */
const TeamComplianceArea: EnterpriseArea = {
  name: "TeamCompliance",
  getApiRouters: (): Array<ExpressRouter> => {
    return [];
  },
};

export default TeamComplianceArea;
