import { DashboardEnterprisePlugins } from "./EnterprisePlugins";

/*
 * What "@oneuptime/ee-dashboard" resolves to in the Community Edition: no
 * enterprise screens at all, so every shell renders its upsell card.
 *
 * This file is the target of that specifier everywhere except the Enterprise
 * image build - the Dashboard, AdminDashboard, Common and App tsconfig
 * "paths", the Common and App jest moduleNameMapper, and esbuild whenever ee/
 * is absent or ONEUPTIME_EDITION=community. Keep it empty: anything added here
 * ships in the Community image.
 */
const CommunityPlugins: DashboardEnterprisePlugins = {};

export default CommunityPlugins;
