import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import TeamComplianceAPI from "./TeamComplianceAPI";

/*
 * Team compliance: the compliance-status API for teams (a plain router,
 * mounted under "/api" by core's BaseAPI feature set) and the compliance
 * service behind it.
 *
 * The compliance RULES (TeamComplianceSetting) stay a core model with its core
 * CRUD API; creating or changing them is gated on the license by
 * EditionPermission. Reading a team's status is runtime behaviour and is
 * served whenever the Enterprise Edition is loaded.
 */
const TeamComplianceArea: EnterpriseArea = {
  name: "TeamCompliance",
  getApiRouters: (): Array<ExpressRouter> => {
    return [TeamComplianceAPI];
  },
};

export default TeamComplianceArea;
