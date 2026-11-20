import React, { FunctionComponent, ReactElement } from "react";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import {
  AppServiceDeploymentStatus,
  AppServiceInstanceState,
  AppServiceSiteActivity,
  AppServiceSiteActivityPart,
  AppServiceSiteDeployment,
  AppServiceSiteInstance,
  AppServiceSiteReadError,
} from "Common/Types/Cloud/AppServiceSiteActivity";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  EmptyMessageParts,
  splitEmptyMessage,
} from "Common/UI/Components/Table/EmptyTableMessage";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  CLOUD_APP_AZURE_IMAGE,
  getShortAppServiceDeploymentId,
} from "../../Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import { APP_LAST_SEEN } from "./CloudAppCells";

/*
 * WHAT AZURE SAYS OF AN APP SERVICE APP (#10294): its instances on the
 * app's Instances tab, its deployments on its Revisions tab, each under
 * what the app's own telemetry names - so an app whose telemetry names no
 * instance and no version still shows what runs it and what was deployed,
 * and one that names them shows Azure's list beside its own (an instance
 * whose telemetry never arrives stands out). Read live through the site's
 * connection (AppServiceSiteActivity); a part Azure would not answer says
 * why, in the reader's words.
 */

export const APP_SERVICE_INSTANCES_TITLE: string =
  translationKey("Instances in Azure");
export const APP_SERVICE_INSTANCES_DESCRIPTION: string = translationKey(
  "The instances Azure runs this App Service app on, and when each one's telemetry last arrived.",
);
export const APP_SERVICE_DEPLOYMENTS_TITLE: string = translationKey(
  "Deployments in Azure",
);
export const APP_SERVICE_DEPLOYMENTS_DESCRIPTION: string = translationKey(
  "The deployments Azure keeps of this App Service app, the newest first.",
);
export const APP_SERVICE_NO_INSTANCES: string = translationKey(
  "Azure lists no instance of this App Service app.",
);
export const APP_SERVICE_NO_DEPLOYMENTS: string = translationKey(
  "Azure keeps no deployment of this App Service app. A container app's deploys are the image it runs.",
);
export const APP_SERVICE_NOT_ASKED: string = translationKey(
  "OneUptime could not ask Azure. Try again in a minute.",
);

// Why a list could not be read, in the reader's words.
export const APP_SERVICE_READ_ERRORS: Readonly<
  Record<AppServiceSiteReadError, string>
> = {
  [AppServiceSiteReadError.NoAccess]: translationKey(
    "Azure did not let the connection's app read them. Give it the Monitoring Reader role on the app's subscription.",
  ),
  [AppServiceSiteReadError.NotFound]: translationKey(
    "Azure has no such App Service app any more: it was deleted or moved.",
  ),
  [AppServiceSiteReadError.Busy]: translationKey(
    "Azure was asked too often. Try again in a minute.",
  ),
  [AppServiceSiteReadError.Failed]: translationKey(
    "Azure did not answer. Try again in a minute.",
  ),
};

const INSTANCE_STATES: Readonly<
  Record<AppServiceInstanceState, { label: string; color: Color }>
> = {
  [AppServiceInstanceState.Ready]: {
    label: translationKey("Ready"),
    color: Green,
  },
  [AppServiceInstanceState.Stopped]: {
    label: translationKey("Stopped"),
    color: Gray500,
  },
  [AppServiceInstanceState.Unknown]: {
    label: translationKey("Unknown"),
    color: Gray500,
  },
};

const DEPLOYMENT_STATUSES: Readonly<
  Record<AppServiceDeploymentStatus, { label: string; color: Color }>
> = {
  [AppServiceDeploymentStatus.Succeeded]: {
    label: translationKey("Succeeded"),
    color: Green,
  },
  [AppServiceDeploymentStatus.Failed]: {
    label: translationKey("Failed"),
    color: Red,
  },
  [AppServiceDeploymentStatus.InProgress]: {
    label: translationKey("In progress"),
    color: Yellow,
  },
  [AppServiceDeploymentStatus.Pending]: {
    label: translationKey("Pending"),
    color: Gray500,
  },
  [AppServiceDeploymentStatus.Unknown]: {
    label: translationKey("Unknown"),
    color: Gray500,
  },
};

export const APP_SERVICE_ACTIVE_DEPLOYMENT: string =
  translationKey("Running now");

/*
 * What a card says in place of its list: why it could not be read, or
 * that Azure lists none. Null while there is a list to show.
 */
export function getAppServiceActivityNotice<T>(data: {
  activity: AppServiceSiteActivity | null;
  part: (activity: AppServiceSiteActivity) => AppServiceSiteActivityPart<T>;
  emptyMessage: string;
}): { kind: TableEmptyStateKind; message: string } | null {
  if (!data.activity) {
    return { kind: TableEmptyStateKind.Error, message: APP_SERVICE_NOT_ASKED };
  }

  const part: AppServiceSiteActivityPart<T> = data.part(data.activity);

  if (!part.items) {
    return {
      kind:
        part.error === AppServiceSiteReadError.NoAccess
          ? TableEmptyStateKind.NoAccess
          : TableEmptyStateKind.Error,
      message:
        APP_SERVICE_READ_ERRORS[part.error || AppServiceSiteReadError.Failed],
    };
  }

  if (part.items.length === 0) {
    return { kind: TableEmptyStateKind.Empty, message: data.emptyMessage };
  }

  return null;
}

// One instance as its row shows it: Azure's, with what its telemetry says.
interface InstanceRow extends AppServiceSiteInstance {
  telemetrySeenAt: Date | null;
}

/*
 * Azure's instances, each with when the app's telemetry last named it: an
 * instance whose service.instance.id is its WEBSITE_INSTANCE_ID, as the App
 * Service resource detectors set it, is the same instance.
 */
export function getAppServiceInstanceRows(data: {
  instances: ReadonlyArray<AppServiceSiteInstance>;
  telemetryInstances: ReadonlyArray<CloudResourceInstance>;
}): Array<InstanceRow> {
  const seen: Map<string, Date> = new Map<string, Date>();

  for (const instance of data.telemetryInstances) {
    const name: string = (instance.instanceName || "").trim().toLowerCase();
    const at: Date | null = instance.lastSeenAt
      ? new Date(instance.lastSeenAt)
      : null;

    if (name && at && !Number.isNaN(at.getTime())) {
      seen.set(name, at);
    }
  }

  return data.instances.map((instance: AppServiceSiteInstance): InstanceRow => {
    return {
      ...instance,
      telemetrySeenAt: seen.get(instance.id.toLowerCase()) || null,
    };
  });
}

const ActivityNotice: FunctionComponent<{
  notice: { kind: TableEmptyStateKind; message: string };
  dataTestId: string;
}> = (props: {
  notice: { kind: TableEmptyStateKind; message: string };
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  // Headed by its first sentence, in the reader's language, as a list's own message is.
  const parts: EmptyMessageParts = splitEmptyMessage(
    translator.translateText(props.notice.message) || props.notice.message,
  );

  return (
    <TableEmptyState
      kind={props.notice.kind}
      title={parts.title}
      description={parts.description}
      isCompact={true}
      isCardBody={true}
      dataTestId={props.dataTestId}
    />
  );
};

export interface InstancesCardProps {
  // Null when Azure could not be asked.
  activity: AppServiceSiteActivity | null;
  // The instances the app's own telemetry named.
  telemetryInstances: ReadonlyArray<CloudResourceInstance>;
}

export const AppServiceInstancesCard: FunctionComponent<InstancesCardProps> = (
  props: InstancesCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const notice: { kind: TableEmptyStateKind; message: string } | null =
    getAppServiceActivityNotice<AppServiceSiteInstance>({
      activity: props.activity,
      part: (activity: AppServiceSiteActivity) => {
        return activity.instances;
      },
      emptyMessage: APP_SERVICE_NO_INSTANCES,
    });

  return (
    <div className="mt-6" data-testid="app-service-instances">
      <Card
        title={APP_SERVICE_INSTANCES_TITLE}
        description={APP_SERVICE_INSTANCES_DESCRIPTION}
      >
        {notice || !props.activity?.instances.items ? (
          <ActivityNotice
            notice={
              notice || {
                kind: TableEmptyStateKind.Error,
                message: APP_SERVICE_NOT_ASKED,
              }
            }
            dataTestId="app-service-instances-notice"
          />
        ) : (
          <LocalTable<InstanceRow>
            id="app-service-instances-table"
            data={getAppServiceInstanceRows({
              instances: props.activity.instances.items,
              telemetryInstances: props.telemetryInstances,
            })}
            singularLabel="Instance"
            pluralLabel="Instances"
            columns={[
              {
                key: "id",
                title: "Instance",
                type: FieldType.Element,
                disableSort: true,
                wrapContent: true,
                getElement: (row: InstanceRow): ReactElement => {
                  return (
                    <span className="font-mono text-sm text-gray-900">
                      <BreakableName text={row.id} />
                    </span>
                  );
                },
              },
              {
                key: "state",
                title: "State",
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: InstanceRow): ReactElement => {
                  return (
                    <Pill
                      text={INSTANCE_STATES[row.state].label}
                      color={INSTANCE_STATES[row.state].color}
                    />
                  );
                },
              },
              {
                key: "telemetrySeenAt",
                title: "Telemetry",
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: InstanceRow): ReactElement => {
                  return row.telemetrySeenAt ? (
                    <span className="text-sm text-gray-700">
                      {translator.translateTemplate(APP_LAST_SEEN, {
                        time: OneUptimeDate.fromNow(row.telemetrySeenAt),
                      })}
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
};

export interface DeploymentsCardProps {
  // Null when Azure could not be asked.
  activity: AppServiceSiteActivity | null;
}

export const AppServiceDeploymentsCard: FunctionComponent<
  DeploymentsCardProps
> = (props: DeploymentsCardProps): ReactElement => {
  const translator: Translator = useTranslator();
  const notice: { kind: TableEmptyStateKind; message: string } | null =
    getAppServiceActivityNotice<AppServiceSiteDeployment>({
      activity: props.activity,
      part: (activity: AppServiceSiteActivity) => {
        return activity.deployments;
      },
      emptyMessage: APP_SERVICE_NO_DEPLOYMENTS,
    });
  const image: string = props.activity?.image || "";

  return (
    <div className="mt-6" data-testid="app-service-deployments">
      <Card
        title={APP_SERVICE_DEPLOYMENTS_TITLE}
        description={APP_SERVICE_DEPLOYMENTS_DESCRIPTION}
      >
        {image ? (
          <p
            className="mb-4 break-words text-sm text-gray-700"
            data-testid="app-service-image"
          >
            {translator.translateTemplate(CLOUD_APP_AZURE_IMAGE, { image })}
          </p>
        ) : (
          <></>
        )}
        {notice || !props.activity?.deployments.items ? (
          <ActivityNotice
            notice={
              notice || {
                kind: TableEmptyStateKind.Error,
                message: APP_SERVICE_NOT_ASKED,
              }
            }
            dataTestId="app-service-deployments-notice"
          />
        ) : (
          <LocalTable<AppServiceSiteDeployment>
            id="app-service-deployments-table"
            data={props.activity.deployments.items}
            singularLabel="Deployment"
            pluralLabel="Deployments"
            columns={[
              {
                key: "id",
                title: "Deployment",
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: AppServiceSiteDeployment): ReactElement => {
                  return (
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className="font-mono text-sm text-gray-900"
                        title={row.id}
                      >
                        <bdi>{getShortAppServiceDeploymentId(row.id)}</bdi>
                      </span>
                      {row.active ? (
                        <Pill
                          text={APP_SERVICE_ACTIVE_DEPLOYMENT}
                          color={Green}
                        />
                      ) : (
                        <></>
                      )}
                    </span>
                  );
                },
              },
              {
                key: "status",
                title: "Status",
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: AppServiceSiteDeployment): ReactElement => {
                  return (
                    <Pill
                      text={DEPLOYMENT_STATUSES[row.status].label}
                      color={DEPLOYMENT_STATUSES[row.status].color}
                    />
                  );
                },
              },
              {
                key: "author",
                title: "Deployed By",
                type: FieldType.Element,
                disableSort: true,
                hideOnMobile: true,
                getElement: (row: AppServiceSiteDeployment): ReactElement => {
                  const by: string = row.author || row.deployer;

                  return by ? (
                    <span className="text-sm text-gray-700">
                      <bdi>{by}</bdi>
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
              {
                key: "message",
                title: "Message",
                type: FieldType.Element,
                disableSort: true,
                wrapContent: true,
                hideOnMobile: true,
                getElement: (row: AppServiceSiteDeployment): ReactElement => {
                  return row.message ? (
                    <span className="text-sm text-gray-700 [overflow-wrap:anywhere]">
                      <bdi>{row.message}</bdi>
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
              {
                key: "endTime",
                title: "Finished",
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: AppServiceSiteDeployment): ReactElement => {
                  const at: string | null = row.endTime || row.startTime;

                  return at ? (
                    <span
                      className="text-sm text-gray-700"
                      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        new Date(at),
                      )}
                    >
                      {OneUptimeDate.fromNow(new Date(at))}
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
};
