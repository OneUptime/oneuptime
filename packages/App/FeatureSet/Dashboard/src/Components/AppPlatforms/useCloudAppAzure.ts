import { useEffect, useState } from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { AppServiceSiteActivity } from "Common/Types/Cloud/AppServiceSiteActivity";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  CloudAppAzureLink,
  fetchCloudAppAzureLink,
} from "../../Pages/AppPlatforms/Utils/CloudAppAzureLink";
import {
  getCloudAppSiteName,
  isAppServiceApp,
} from "../../Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { CloudAppAzureMonitorLookup } from "../../Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import {
  fetchAppServiceSiteActivity,
  fetchSiteDiagnosticLogsLastReceivedAt,
} from "./CloudAppAzureReads";

/*
 * What an App Service app's page knows of its site in Azure (#10294), read
 * once for every tab: its way to Azure Monitor (CloudAppAzureLink) - the
 * Overview's Azure Monitor section and Setup check - what Azure says of its
 * instances and deployments (the Instances and Revisions tabs), and when
 * its site's diagnostic logs last arrived (the Setup check's Logs row and
 * the Logs tab).
 *
 * A refresh reads the link and the logs again, keeping what the page shows
 * until the new answer is in. The instances and deployments are asked of
 * Azure itself, so they are read once per site the page shows, not on
 * every tick of the auto-refresh.
 */

export interface CloudAppAzure {
  // Undefined for an app that is not on App Service.
  lookup: CloudAppAzureMonitorLookup | undefined;
  // The site found, when it is.
  site: CloudResource | null;
  // Undefined while read (or with no site); null when it could not be.
  activity: AppServiceSiteActivity | null | undefined;
  // Undefined while read (or with no site); null when none arrived lately.
  diagnosticLogsLastReceivedAt: Date | null | undefined;
}

export function getCloudAppAzureSite(
  lookup: CloudAppAzureMonitorLookup | undefined,
): CloudResource | null {
  return lookup && lookup.status === "read" ? lookup.link.site : null;
}

const useCloudAppAzure: (data: {
  app: CloudApp | null | undefined;
  environment: CloudResource | null | undefined;
  refreshToken: number;
}) => CloudAppAzure = (data: {
  app: CloudApp | null | undefined;
  environment: CloudResource | null | undefined;
  refreshToken: number;
}): CloudAppAzure => {
  const [lookup, setLookup] = useState<CloudAppAzureMonitorLookup | undefined>(
    undefined,
  );
  const [activity, setActivity] = useState<
    AppServiceSiteActivity | null | undefined
  >(undefined);
  const [diagnosticLogsLastReceivedAt, setDiagnosticLogsLastReceivedAt] =
    useState<Date | null | undefined>(undefined);

  const app: CloudApp | null | undefined = data.app;
  const isAppService: boolean = Boolean(
    app && isAppServiceApp(app) && getCloudAppSiteName(app),
  );
  const appKey: string = app
    ? JSON.stringify([
        app._id?.toString(),
        app.name,
        app.groupName,
        app.providerResourceId,
        app.cloudPlatform,
        data.environment?.cloudAccountId,
        data.environment?.cloudRegion,
      ])
    : "";

  useEffect(() => {
    if (!app || !isAppService) {
      setLookup(undefined);
      return;
    }

    let ignore: boolean = false;

    // A refresh keeps what the page shows until the new answer is in.
    setLookup((previous: CloudAppAzureMonitorLookup | undefined) => {
      return previous && previous.status !== "checking"
        ? previous
        : { status: "checking" };
    });

    fetchCloudAppAzureLink({ app, environment: data.environment })
      .then((link: CloudAppAzureLink | null): void => {
        if (!ignore) {
          setLookup(link ? { status: "read", link } : undefined);
        }
      })
      .catch((): void => {
        // No access to Cloud resources, or the read failed: nothing can be said.
        if (!ignore) {
          setLookup({ status: "failed" });
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [appKey, data.refreshToken]);

  const site: CloudResource | null = getCloudAppAzureSite(lookup);
  const siteId: string = site?._id?.toString() || "";
  const siteResourceId: string = site?.providerResourceId || "";

  useEffect(() => {
    if (!siteId) {
      setActivity(undefined);
      return;
    }

    let ignore: boolean = false;
    setActivity(undefined);

    fetchAppServiceSiteActivity(new ObjectID(siteId))
      .then((read: AppServiceSiteActivity): void => {
        if (!ignore) {
          setActivity(read);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setActivity(null);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [siteId]);

  useEffect(() => {
    if (!siteResourceId) {
      setDiagnosticLogsLastReceivedAt(undefined);
      return;
    }

    let ignore: boolean = false;

    fetchSiteDiagnosticLogsLastReceivedAt({
      providerResourceId: siteResourceId,
      now: OneUptimeDate.getCurrentDate(),
    })
      .then((latest: Date | null): void => {
        if (!ignore) {
          setDiagnosticLogsLastReceivedAt(latest);
        }
      })
      .catch((): void => {
        // Unknown, not none: the row says only what the app sent.
        if (!ignore) {
          setDiagnosticLogsLastReceivedAt(undefined);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [siteResourceId, data.refreshToken]);

  return {
    lookup,
    site,
    activity: site ? activity : undefined,
    diagnosticLogsLastReceivedAt: site
      ? diagnosticLogsLastReceivedAt
      : undefined,
  };
};

export default useCloudAppAzure;
