import React, { FunctionComponent, ReactElement } from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import {
  getCloudProviderForPlatform,
  getManagedCloudPlatformDescriptor,
  ManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import CloudConnectionLogo from "../Cloud/Connect/CloudConnectionLogo";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
} from "../TelemetryResource/ResourceHeroLayout";
import {
  CLOUD_APP_STATE_LABELS,
  CloudAppState,
  getCloudAppGroupNoun,
  getCloudAppRevisionNoun,
  getCloudAppState,
  getShortRevision,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import { APP_INSTANCE_COUNT, APP_LAST_SEEN } from "./CloudAppCells";

/*
 * The top of an App Platforms app's page, above its tabs - what the app is
 * and whether it is all right, as a platform console's service header says
 * it: its name, Running or Not reporting and on how many instances, where
 * it runs, the revision it runs and since when, and the service its
 * telemetry is under. The time range for every tab's numbers sits at its
 * end, as on every resource's Overview.
 */

export const APP_REVISION: string = translationKey("Revision {{revision}}");
export const APP_REVISION_DEPLOYED: string =
  translationKey("deployed {{time}}");
export const APP_REVISION_REPLACED: string = translationKey(
  "replaced {{revision}}",
);
export const APP_NO_REVISION: string = translationKey(
  "No revision reported yet",
);
export const APP_OPEN_SERVICE: string = translationKey(
  "Open the service {{service}}",
);

const STATE_PILL_CLASS_NAMES: Readonly<Record<CloudAppState, string>> = {
  [CloudAppState.Running]: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  [CloudAppState.NotReporting]: "bg-amber-50 text-amber-700 ring-amber-200",
};

const STATE_DOT_CLASS_NAMES: Readonly<Record<CloudAppState, string>> = {
  [CloudAppState.Running]: "bg-emerald-500",
  [CloudAppState.NotReporting]: "bg-amber-500",
};

export interface ComponentProps {
  app: CloudApp;
  environment: CloudResource;
  // Live instances, when they were read.
  liveInstances?: number | undefined;
  // The service the app's telemetry is under, in Services, when it has one.
  serviceRoute?: Route | undefined;
  environmentRoute: Route;
  controls?: ReactElement | undefined;
}

const CloudAppHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { app, environment } = props;
  const state: CloudAppState = getCloudAppState(app.lastSeenAt);
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(app.cloudPlatform);
  const groupNoun: string | null = getCloudAppGroupNoun(app.cloudPlatform);

  const where: Array<string> = [];

  if (descriptor) {
    where.push(descriptor.productName);
  }

  if (environment.cloudRegion) {
    where.push(environment.cloudRegion);
  }

  if (app.groupName && groupNoun) {
    where.push(
      translator.translateTemplate("{{noun}} {{name}}", {
        noun: (translator.translateText(groupNoun) || groupNoun).toLowerCase(),
        name: app.groupName,
      }),
    );
  }

  const stateLabel: string =
    translator.translateText(CLOUD_APP_STATE_LABELS[state]) ||
    CLOUD_APP_STATE_LABELS[state];

  const stateDetail: string =
    state === CloudAppState.Running
      ? props.liveInstances !== undefined
        ? translator.translatePlural(APP_INSTANCE_COUNT, props.liveInstances)
        : ""
      : app.lastSeenAt
        ? translator.translateTemplate(APP_LAST_SEEN, {
            time: OneUptimeDate.fromNow(
              OneUptimeDate.fromString(app.lastSeenAt),
            ),
          })
        : "";

  const revisionNoun: string = getCloudAppRevisionNoun(app.cloudPlatform);
  const revision: string = getShortRevision({
    revision: app.currentRevision,
    appName: app.name,
  });

  return (
    <div
      className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="cloud-app-header"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        <div
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
          aria-hidden="true"
        />
      </div>
      <div className="relative px-6 py-5">
        <div className={RESOURCE_HERO_TOP_ROW_CLASS_NAME}>
          <div className={RESOURCE_HERO_IDENTITY_CLASS_NAME}>
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ring-indigo-200">
              <CloudConnectionLogo
                provider={
                  getCloudProviderForPlatform(app.cloudPlatform) ||
                  environment.cloudProvider ||
                  undefined
                }
                size="md"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="break-words text-xl font-semibold text-gray-900"
                  data-testid="cloud-app-name"
                >
                  {app.name || "—"}
                </h1>
                <span
                  data-testid="cloud-app-header-state"
                  data-state={state}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_PILL_CLASS_NAMES[state]}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATE_DOT_CLASS_NAMES[state]}`}
                  />
                  {stateLabel}
                </span>
                {stateDetail ? (
                  <span className="text-xs text-gray-500">{stateDetail}</span>
                ) : (
                  <></>
                )}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                <AppLink
                  to={props.environmentRoute}
                  className="hover:underline"
                >
                  <bdi>{where.join(" · ") || environment.name || ""}</bdi>
                </AppLink>
              </div>
              <div
                className="mt-1 text-sm text-gray-600"
                data-testid="cloud-app-header-revision"
              >
                {/*
                 * Three facts, each kept whole: the line breaks between them,
                 * never inside "deployed 25 minutes ago".
                 */}
                {revision ? (
                  <>
                    <span
                      className="whitespace-nowrap"
                      title={
                        translator.translateText(revisionNoun) || revisionNoun
                      }
                    >
                      <bdi>
                        {translator.translateTemplate(APP_REVISION, {
                          revision: revision,
                        })}
                      </bdi>
                    </span>
                    {app.currentRevisionSince ? (
                      <>
                        {" · "}
                        <span className="whitespace-nowrap">
                          {translator.translateTemplate(APP_REVISION_DEPLOYED, {
                            time: OneUptimeDate.fromNow(
                              OneUptimeDate.fromString(
                                app.currentRevisionSince,
                              ),
                            ),
                          })}
                        </span>
                      </>
                    ) : (
                      <></>
                    )}
                    {app.previousRevision ? (
                      <>
                        {" · "}
                        <span className="whitespace-nowrap text-gray-400">
                          <bdi>
                            {translator.translateTemplate(
                              APP_REVISION_REPLACED,
                              {
                                revision: getShortRevision({
                                  revision: app.previousRevision,
                                  appName: app.name,
                                }),
                              },
                            )}
                          </bdi>
                        </span>
                      </>
                    ) : (
                      <></>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400">
                    {translator.translateText(APP_NO_REVISION)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {props.controls ? (
            <div className={RESOURCE_HERO_CONTROLS_CLASS_NAME}>
              {props.controls}
            </div>
          ) : (
            <></>
          )}
        </div>

        {props.serviceRoute || app.image ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {props.serviceRoute && app.serviceName ? (
              <AppLink
                to={props.serviceRoute}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                title={translator.translateTemplate(APP_OPEN_SERVICE, {
                  service: app.serviceName,
                })}
              >
                <Icon icon={IconProp.Workflow} className="h-3 w-3" />
                <span className="font-medium">
                  <bdi>{app.serviceName}</bdi>
                </span>
              </AppLink>
            ) : (
              <></>
            )}
            {app.image ? (
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                title={app.image}
              >
                <Icon icon={IconProp.Cube} className="h-3 w-3 text-gray-500" />
                <span className="truncate font-mono">
                  <bdi>{app.image}</bdi>
                </span>
              </span>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default CloudAppHeader;
