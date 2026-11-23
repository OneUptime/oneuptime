import { useEffect, useState } from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import {
  CloudAppPlatformLink,
  fetchCloudAppPlatformLink,
  hasCloudAppPlatformMonitor,
} from "../../Pages/AppPlatforms/Utils/CloudAppPlatformLink";
import { CloudAppPlatformMonitorLookup } from "../../Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";

/*
 * What an app's page knows of the Cloud Resource it runs as off App Service
 * (#6794) - a Container App, a Cloud Run, App Engine, App Runner or ECS
 * service - read once for every tab: its way to its platform's monitoring
 * (CloudAppPlatformLink), which the Overview's platform section and its
 * Setup check's row show. A refresh reads it again, keeping what the page
 * shows until the new answer is in. App Service apps read theirs with
 * useCloudAppAzure.
 */

export interface CloudAppPlatform {
  // Undefined for an app that has no platform monitoring of this kind.
  lookup: CloudAppPlatformMonitorLookup | undefined;
  // The resource found, when it is.
  resource: CloudResource | null;
}

export function getCloudAppPlatformResource(
  lookup: CloudAppPlatformMonitorLookup | undefined,
): CloudResource | null {
  return lookup && lookup.status === "read" ? lookup.link.resource : null;
}

const useCloudAppPlatform: (data: {
  app: CloudApp | null | undefined;
  environment: CloudResource | null | undefined;
  refreshToken: number;
}) => CloudAppPlatform = (data: {
  app: CloudApp | null | undefined;
  environment: CloudResource | null | undefined;
  refreshToken: number;
}): CloudAppPlatform => {
  const [lookup, setLookup] = useState<
    CloudAppPlatformMonitorLookup | undefined
  >(undefined);

  const app: CloudApp | null | undefined = data.app;
  const hasMonitor: boolean = Boolean(app && hasCloudAppPlatformMonitor(app));
  const appKey: string = app
    ? JSON.stringify([
        app._id?.toString(),
        app.name,
        app.groupName,
        app.providerResourceId,
        app.platformCloudResourceId?.toString(),
        app.cloudPlatform,
        data.environment?.cloudAccountId,
        data.environment?.cloudRegion,
      ])
    : "";

  useEffect(() => {
    if (!app || !hasMonitor) {
      setLookup(undefined);
      return;
    }

    let ignore: boolean = false;

    // A refresh keeps what the page shows until the new answer is in.
    setLookup((previous: CloudAppPlatformMonitorLookup | undefined) => {
      return previous && previous.status !== "checking"
        ? previous
        : { status: "checking" };
    });

    fetchCloudAppPlatformLink({ app, environment: data.environment })
      .then((link: CloudAppPlatformLink | null): void => {
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

  return { lookup, resource: getCloudAppPlatformResource(lookup) };
};

export default useCloudAppPlatform;
