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
  CloudAppRevisionMarkerSource,
  CloudAppState,
  getCloudAppGroupLabel,
  getCloudAppRevisionNoun,
  getCloudAppState,
  getShortRevision,
  isCloudAppRolledBack,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import {
  APP_DEPLOYED,
  APP_INSTANCE_COUNT,
  APP_LAST_SEEN,
  APP_ROLLED_BACK,
} from "./CloudAppCells";
import CloudAppFacts, { CloudAppFact } from "./CloudAppFacts";
import { REVISION_REPLACED } from "./CloudAppRevisionsTab";

/*
 * The top of an App Platforms app's page, above its tabs - what the app is
 * and whether it is all right, as a platform console's service header says
 * it: its name, Running or Not reporting and on how many instances, where
 * it runs, the revision it runs and since when - deployed, or rolled back
 * to - and the service its telemetry is under. The time range for every
 * tab's numbers sits at its end, as on every resource's Overview.
 *
 * Laid out as every resource hero is (ResourceHeroLayout): the name and its
 * facts keep their room and the controls give way. The facts wrap, so on
 * their own they asked for no room at all, and beside the side menu at 1024
 * - or in German at 1280, where the controls are wider - they were squeezed
 * to a word a line: "us-" over "east-1", "Revision 43 ·" over "Deployed 25
 * minutes ago" (#5511's UI review). They ask for 20rem from md up, as a
 * hero's description does, so the controls move under them instead; each
 * line is a CloudAppFacts, kept whole between its dots.
 */

export const APP_REVISION: string = translationKey("Revision {{revision}}");
export const APP_NO_REVISION: string = translationKey(
  "No revision reported yet",
);
export const APP_OPEN_SERVICE: string = translationKey(
  "Open the service {{service}}",
);
export const APP_SET_UP_ALERTS: string = translationKey("Set up alerts");
export const APP_SET_UP_ALERTS_HINT: string = translationKey(
  "The alerts recommended for this app's service: failed requests, error bursts, slow requests, traffic that stops, new exceptions.",
);
// The words beside the name and the facts under it ask for this much room.
export const CLOUD_APP_HEADER_TEXT_CLASS_NAME: string =
  "min-w-0 flex-1 md:min-w-[20rem]";

// A keyboard's focus on the header's links, as on its buttons.
const LINK_FOCUS_CLASS_NAME: string =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

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
  /*
   * The app's revisions, when they were read: they say whether the revision
   * it runs is one it went back to (a rollback) rather than a deploy.
   */
  revisions?: ReadonlyArray<CloudAppRevisionMarkerSource> | undefined;
  // The service the app's telemetry is under, in Services, when it has one.
  serviceRoute?: Route | undefined;
  // That service's recommended alerts, when it has a service.
  alertsRoute?: Route | undefined;
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
  const group: string = getCloudAppGroupLabel({
    groupName: app.groupName,
    cloudPlatform: app.cloudPlatform,
    translator,
  });

  const where: Array<CloudAppFact> = [];

  if (descriptor) {
    where.push({ key: "platform", content: descriptor.productName });
  }

  if (environment.cloudRegion) {
    where.push({ key: "region", content: environment.cloudRegion });
  }

  if (group) {
    where.push({ key: "group", content: group });
  }

  // Nothing the platform says: the environment's name stands for it.
  if (where.length === 0 && environment.name) {
    where.push({ key: "environment", content: environment.name });
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
  const isRolledBack: boolean = isCloudAppRolledBack({
    revisions: props.revisions || [],
    currentRevision: app.currentRevision,
    currentRevisionSince: app.currentRevisionSince,
    previousRevision: app.previousRevision,
  });

  /*
   * Three facts about what it runs: the revision, since when and how it got
   * there - deployed, or rolled back to - and the revision it replaced.
   */
  const revisionFacts: Array<CloudAppFact> = [];

  if (revision) {
    revisionFacts.push({
      key: "revision",
      content: translator.translateTemplate(APP_REVISION, { revision }),
      title: translator.translateText(revisionNoun) || revisionNoun,
    });

    if (app.currentRevisionSince) {
      revisionFacts.push({
        key: isRolledBack ? "rolled-back" : "deployed",
        content: translator.translateTemplate(
          isRolledBack ? APP_ROLLED_BACK : APP_DEPLOYED,
          {
            time: OneUptimeDate.fromNow(
              OneUptimeDate.fromString(app.currentRevisionSince),
            ),
          },
        ),
        className: isRolledBack ? "font-medium text-amber-700" : undefined,
      });
    }

    if (app.previousRevision) {
      revisionFacts.push({
        key: "replaced",
        content: translator.translateTemplate(REVISION_REPLACED, {
          revision: getShortRevision({
            revision: app.previousRevision,
            appName: app.name,
          }),
        }),
        className: "text-gray-500",
      });
    }
  }

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
            <div className={CLOUD_APP_HEADER_TEXT_CLASS_NAME}>
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
              {where.length > 0 ? (
                <AppLink
                  to={props.environmentRoute}
                  className={`mt-1 block max-w-full rounded-sm text-sm text-gray-600 hover:text-gray-900 hover:underline ${LINK_FOCUS_CLASS_NAME}`}
                  dataTestId="cloud-app-header-where"
                >
                  <CloudAppFacts facts={where} />
                </AppLink>
              ) : (
                <></>
              )}
              <div
                className="mt-1 text-sm text-gray-600"
                data-testid="cloud-app-header-revision"
                data-change={
                  revision ? (isRolledBack ? "rolled-back" : "deployed") : ""
                }
              >
                {revision ? (
                  <CloudAppFacts facts={revisionFacts} />
                ) : (
                  <span className="text-gray-500">
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

        {props.serviceRoute || app.image || props.alertsRoute ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {/*
             * Alerts that work out of the box: the service's recommended
             * monitors - its requests failing, slowing or stopping - one
             * click from the app.
             */}
            {props.alertsRoute ? (
              <AppLink
                to={props.alertsRoute}
                className={`inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 ${LINK_FOCUS_CLASS_NAME}`}
                title={translator.translateText(APP_SET_UP_ALERTS_HINT)}
              >
                <Icon icon={IconProp.Bell} className="h-3 w-3" />
                <span>{translator.translateText(APP_SET_UP_ALERTS)}</span>
              </AppLink>
            ) : (
              <></>
            )}
            {props.serviceRoute && app.serviceName ? (
              <AppLink
                to={props.serviceRoute}
                className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-indigo-300 hover:text-indigo-700 ${LINK_FOCUS_CLASS_NAME}`}
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
