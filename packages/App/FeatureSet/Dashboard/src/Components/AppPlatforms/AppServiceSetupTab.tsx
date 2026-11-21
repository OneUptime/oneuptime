import React, { FunctionComponent, ReactElement } from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "Common/Types/Cloud/CloudMonitoredResource";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { CloudAppAzureLink } from "../../Pages/AppPlatforms/Utils/CloudAppAzureLink";
import { getCloudAppSiteName } from "../../Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import {
  APP_SERVICE_STACK_OPTIONS,
  AppServiceGuideApp,
  getAppServiceTelemetryGuide,
  resolveAppServiceStack,
} from "./AppServiceTelemetryGuide";

/*
 * An App Service app's Setup tab (#10294): the steps that send its traces,
 * metrics and logs, for the stack it runs, with its own name, resource
 * group and subscription in every command (AppServiceTelemetryGuide). The
 * Setup check's Traces and Logs rows open it.
 */

export const APP_SERVICE_SETUP_TITLE: string = translationKey(
  "Send this app's traces and logs",
);
export const APP_SERVICE_SETUP_DESCRIPTION: string = translationKey(
  "The steps for its stack, with its own name and resource group in every command.",
);
export const APP_SERVICE_SETUP_OPTIONS_LABEL: string = translationKey(
  "What does the app run?",
);

/*
 * The values the commands are filled in with: the site's, when it is found,
 * else what the app's telemetry says of it.
 */
export function getAppServiceGuideApp(data: {
  app: Pick<CloudApp, "name" | "providerResourceId" | "cloudPlatform">;
  link: CloudAppAzureLink | null;
}): Partial<AppServiceGuideApp> {
  const ids: Array<string> = [
    data.link?.site?.providerResourceId || "",
    data.app.providerResourceId || "",
  ];
  let parsed: ParsedAzureResourceId | null = null;

  for (const id of ids) {
    parsed = id ? parseAzureResourceId(id) : null;

    if (parsed) {
      break;
    }
  }

  return {
    siteName: parsed?.name || getCloudAppSiteName(data.app),
    resourceGroup:
      data.link?.site?.cloudResourceGroup || parsed?.resourceGroup || "",
    subscriptionId: parsed?.subscriptionId || data.link?.subscription?.id || "",
  };
}

export interface ComponentProps {
  app: CloudApp;
  link: CloudAppAzureLink | null;
}

const AppServiceSetupTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const app: Partial<AppServiceGuideApp> = getAppServiceGuideApp({
    app: props.app,
    link: props.link,
  });

  return (
    <div data-testid="app-service-setup">
      <SetupGuideCard
        title={APP_SERVICE_SETUP_TITLE}
        description={APP_SERVICE_SETUP_DESCRIPTION}
        icon={IconProp.Code}
        newKeyName={translationKey("App Service key")}
        optionsLabel={APP_SERVICE_SETUP_OPTIONS_LABEL}
        options={APP_SERVICE_STACK_OPTIONS}
        getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
          return getAppServiceTelemetryGuide({
            oneuptimeUrl: context.oneuptimeUrl,
            apiKey: context.apiKey,
            stack: resolveAppServiceStack(context.option),
            app,
            translator,
          });
        }}
      />
    </div>
  );
};

export default AppServiceSetupTab;
