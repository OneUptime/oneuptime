import React, { FunctionComponent, ReactElement, useState } from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import { STORED_CLOUD_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudLogGroups";
import ObjectID from "Common/Types/ObjectID";
import ViewSwitch from "Common/UI/Components/ViewSwitch/ViewSwitch";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import DashboardLogsViewer from "../Logs/LogsViewer";
import {
  AZURE_RESOURCE_NO_LOGS_IN_RANGE,
  AZURE_RESOURCE_NO_STREAMED_LOGS,
  getCloudResourceLogsQuery,
} from "../../Pages/Cloud/View/Logs";

/*
 * An App Platforms app's Logs (#10294): the logs its own telemetry sends -
 * and, for an App Service app whose site is found, the site's own logs
 * that Azure's diagnostic settings stream (console output, HTTP and
 * platform logs: AppServiceConsoleLogs, AppServiceHTTPLogs and the rest),
 * which the stream files under the site's ARM id
 * (AzureDiagnosticRecords), never under the app's attributes. Before,
 * those were only on the site's page in Cloud, and the app's tab said "No
 * logs found" beside them.
 *
 * A switch picks which: the app's own when it sends any, else Azure's.
 * Each is the viewer the site's or the app's own page shows, with the same
 * saved views.
 */

export enum CloudAppLogSource {
  App = "app",
  Azure = "azure",
}

export const CLOUD_APP_LOG_SOURCE_LABEL: string = translationKey(
  "Show the logs that come",
);
export const CLOUD_APP_LOGS_FROM_APP: string = translationKey("From the app");
export const CLOUD_APP_LOGS_FROM_AZURE: string = translationKey(
  "From Azure diagnostic settings",
);
export const CLOUD_APP_NO_LOGS: string = translationKey(
  "Logs appear here when they carry this app's resource attributes and its environment's.",
);

// The source the tab opens on: the app's own when it sends any, else Azure's.
export function getInitialCloudAppLogSource(data: {
  appSendsLogs: boolean;
  azureSendsLogs: boolean;
}): CloudAppLogSource {
  return !data.appSendsLogs && data.azureSendsLogs
    ? CloudAppLogSource.Azure
    : CloudAppLogSource.App;
}

export interface ComponentProps {
  appId: ObjectID;
  app: CloudApp;
  logQuery: Query<Log>;
  attributeFilterDisplayKeys: Record<string, string>;
  attributeFilterDisplayValues: Record<string, string>;
  // The app's App Service site, when found: its streamed logs are offered.
  site?: CloudResource | null | undefined;
  // Whether the site's connection streams (it has a stream key).
  siteStreams?: boolean | undefined;
  // When the site's latest streamed log arrived; null when none lately.
  diagnosticLogsLastReceivedAt?: Date | null | undefined;
}

const CloudAppLogsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const siteResourceId: string = props.site?.providerResourceId || "";
  const [source, setSource] = useState<CloudAppLogSource>(
    getInitialCloudAppLogSource({
      appSendsLogs: Boolean(props.app.logsLastReceivedAt),
      azureSendsLogs: Boolean(props.diagnosticLogsLastReceivedAt),
    }),
  );

  const appLogs: ReactElement = (
    <DashboardLogsViewer
      id={`cloud-app-logs-${props.appId.toString()}`}
      savedViewScope={buildSavedViewScope(
        SavedViewScopeKind.CloudApp,
        props.appId,
      )}
      logQuery={props.logQuery}
      attributeFilterDisplayKeys={props.attributeFilterDisplayKeys}
      attributeFilterDisplayValues={props.attributeFilterDisplayValues}
      showFilters={true}
      enableRealtime={true}
      noLogsMessage={CLOUD_APP_NO_LOGS}
    />
  );

  if (!props.site || !siteResourceId || !props.site._id) {
    return appLogs;
  }

  const siteId: ObjectID = new ObjectID(props.site._id.toString());

  return (
    <div data-testid="cloud-app-logs">
      <div className="mb-4">
        <ViewSwitch<CloudAppLogSource>
          options={[
            { value: CloudAppLogSource.App, label: CLOUD_APP_LOGS_FROM_APP },
            {
              value: CloudAppLogSource.Azure,
              label: CLOUD_APP_LOGS_FROM_AZURE,
            },
          ]}
          value={source}
          onChange={setSource}
          ariaLabel={CLOUD_APP_LOG_SOURCE_LABEL}
          dataTestId="cloud-app-log-source"
          fillWidthOnPhone={true}
        />
      </div>
      {source === CloudAppLogSource.App ? (
        appLogs
      ) : (
        /*
         * The site's Logs tab, as its page in Cloud shows it: its id as
         * the filter, its name on the locked chip. Its saved views are this
         * tab's, the app's (#5549): a view saved here is not listed on the
         * site's page in Cloud, nor one saved there here.
         */
        <DashboardLogsViewer
          key={siteId.toString()}
          id={`cloud-resource-streamed-logs-${siteId.toString()}`}
          savedViewScope={buildSavedViewScope(
            SavedViewScopeKind.CloudApp,
            props.appId,
            siteId,
          )}
          logQuery={getCloudResourceLogsQuery(siteResourceId)}
          attributeFilterDisplayKeys={{
            [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: "Resource",
          }}
          attributeFilterDisplayValues={{
            [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]:
              props.site.name || siteResourceId,
          }}
          showFilters={true}
          enableRealtime={true}
          noLogsMessage={
            props.siteStreams
              ? AZURE_RESOURCE_NO_LOGS_IN_RANGE
              : AZURE_RESOURCE_NO_STREAMED_LOGS
          }
        />
      )}
    </div>
  );
};

export default CloudAppLogsTab;
