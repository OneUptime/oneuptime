import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * A status page's access controls: the Reader Sessions card on Security >
 * Access (how long a private user stays signed in), and Who Can Subscribe on
 * Subscribers > Settings (only private users, and the email domains
 * subscribers may use).
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import a core
 * shell that reads these plugins (StatusPageSessionLengthSettings,
 * SubscriberRestrictionsSettings) back - that cycle crashes the Enterprise
 * bundle (see src/Enterprise/Plugins.ts).
 */
type StatusPageAccessControlsPluginKeys =
  | "StatusPageSessionLength"
  | "StatusPageSubscriberRestrictions";

const StatusPageAccessControlsPlugins: Pick<
  DashboardEnterprisePlugins,
  StatusPageAccessControlsPluginKeys
> = {
  StatusPageSessionLength: lazy(() => {
    return import("./StatusPageSessionLengthCard");
  }),
  StatusPageSubscriberRestrictions: lazy(() => {
    return import("./SubscriberRestrictionsCard");
  }),
};

export default StatusPageAccessControlsPlugins;
