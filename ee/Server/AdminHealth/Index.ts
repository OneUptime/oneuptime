import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * The enterprise admin-health routes (the query console), mounted at
 * "/api/admin/health" ahead of core's AdminHealth router, which answers the
 * same paths with 402 on the Community Edition.
 *
 * Skeleton: no router yet. The query console moves here from
 * packages/App/API/AdminHealth.ts.
 */
export const getAdminHealthRouter: () => ExpressRouter | null =
  (): ExpressRouter | null => {
    return null;
  };

const AdminHealthArea: EnterpriseArea = {
  name: "AdminHealth",
};

export default AdminHealthArea;
