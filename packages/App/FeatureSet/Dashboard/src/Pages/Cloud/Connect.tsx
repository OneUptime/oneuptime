import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  cloudConnectionDocsUrl,
  getCloudConnectionAwsRoleSetup,
} from "../../Components/Cloud/Connect/CloudConnectApi";
import CloudConnectionFormModal from "../../Components/Cloud/Connect/CloudConnectionFormModal";
import CloudConnectionTiles from "../../Components/Cloud/Connect/CloudConnectionTiles";
import CloudConnectionsTable from "../../Components/Cloud/Connect/CloudConnectionsTable";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import Route from "Common/Types/API/Route";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { isCloudConnectionProvider } from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionAwsRoleSetup } from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Cloud > Connect: AWS, Azure and Google Cloud, a tile each. Picking one
 * opens its guided form - run one command in the cloud's own browser
 * terminal, paste what it printed, test, connect - and OneUptime then reads
 * the account on a schedule: its resources appear under All Resources, by
 * service and region, with their key metrics. Nothing to install.
 *
 * Connected accounts are listed under the tiles with how each is doing and
 * what it holds. A link with ?cloud=aws (azure, gcp) opens that cloud's
 * form at once, so the empty All Resources page can send people straight
 * to it.
 */

export const CLOUD_QUERY_PARAM: string = "cloud";

// The project's connections, for the tiles' counts; undefined when the read fails.
async function readCloudConnections(
  projectId: ObjectID,
): Promise<Array<CloudConnection> | undefined> {
  try {
    const result: ListResult<CloudConnection> =
      await ModelAPI.getList<CloudConnection>({
        modelType: CloudConnection,
        query: { projectId },
        select: { _id: true, provider: true },
        limit: 100,
        skip: 0,
        sort: {},
      });

    return result.data;
  } catch {
    return undefined;
  }
}

const CloudConnectPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [formState, setFormState] = useState<
    { provider: CloudProvider; connection?: CloudConnection } | undefined
  >(() => {
    const fromAddress: string | null =
      Navigation.getQueryStringByName(CLOUD_QUERY_PARAM);

    return isCloudConnectionProvider(fromAddress)
      ? { provider: fromAddress }
      : undefined;
  });
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [known, setKnown] = useState<Array<CloudConnection> | undefined>(
    undefined,
  );
  const [listHasRows, setListHasRows] = useState<boolean>(false);
  const [awsRoleSetup, setAwsRoleSetup] = useState<
    CloudConnectionAwsRoleSetup | undefined
  >(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  /*
   * Every write here goes through ModelAPI directly, which ModelTable's own
   * gating never sees, so the affordances are gated up front.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new CloudConnection(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new CloudConnection(),
    ModelAction.Update,
  );

  useEffect(() => {
    if (disableTelemetryForThisProject) {
      return;
    }

    let isCurrent: boolean = true;

    void readCloudConnections(ProjectUtil.getCurrentProjectId()!).then(
      (connections: Array<CloudConnection> | undefined) => {
        if (isCurrent) {
          setKnown(connections);
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [refreshCounter, disableTelemetryForThisProject]);

  /*
   * Whether this OneUptime can sign in to an AWS role, asked once: the AWS
   * form offers a role only then. A failed ask is read as "no", and the
   * form offers an access key.
   */
  useEffect(() => {
    if (disableTelemetryForThisProject || !createGate.isAllowed) {
      return;
    }

    let isCurrent: boolean = true;

    getCloudConnectionAwsRoleSetup()
      .then((setup: CloudConnectionAwsRoleSetup) => {
        if (isCurrent) {
          setAwsRoleSetup(setup);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setAwsRoleSetup({ isAvailable: false, externalId: "" });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [disableTelemetryForThisProject]);

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  const connectionCounts: Partial<Record<CloudProvider, number>> = {};

  for (const connection of known || []) {
    if (connection.provider) {
      connectionCounts[connection.provider] =
        (connectionCounts[connection.provider] || 0) + 1;
    }
  }

  /*
   * The list shows once there is something in it: until then the tiles
   * are the way in, and an empty table under them would only repeat
   * "nothing connected yet". Once it has shown a row it stays, so a search
   * that finds nothing can still be cleared.
   */
  const showsList: boolean = (known || []).length > 0 || listHasRows;

  const resourcesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CLOUD_MONITORED_RESOURCES] as Route,
  );

  const closeForm: () => void = (): void => {
    setFormState(undefined);

    // A form opened from a link is not opened again by a refresh.
    if (Navigation.getQueryStringByName(CLOUD_QUERY_PARAM)) {
      Navigation.setQueryString({ [CLOUD_QUERY_PARAM]: "" });
    }
  };

  return (
    <Fragment>
      <div className="space-y-6" data-testid="cloud-connect-page">
        <Card
          title="Connect a cloud account"
          description="See every resource in your AWS, Azure and Google Cloud accounts with its key metrics. Run one command in your cloud's terminal, paste what it prints, and OneUptime does the rest."
        >
          <div>
            <CloudConnectionTiles
              connectionCounts={connectionCounts}
              canConnect={createGate.isAllowed}
              connectDisabledReason={createGate.disabledReason}
              onConnect={(provider: CloudProvider) => {
                setNotice(undefined);
                setFormState({ provider });
              }}
            />

            {!createGate.isAllowed && createGate.disabledReason ? (
              <div
                className="mt-4 flex items-start gap-2 text-sm text-gray-600"
                data-testid="cloud-connect-locked"
              >
                <Icon
                  icon={IconProp.Lock}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <span>{createGate.disabledReason}</span>
              </div>
            ) : (
              <></>
            )}

            <ul
              className="mt-5 grid grid-cols-1 gap-3 border-t border-gray-200 pt-4 text-sm text-gray-600 md:grid-cols-3"
              data-testid="cloud-connect-promises"
            >
              <li className="flex items-start gap-2">
                <Icon
                  icon={IconProp.ShieldCheck}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <span>
                  {translator.translateText(
                    "Read-only: OneUptime can read, never change, anything in your cloud.",
                  )}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Icon
                  icon={IconProp.Clock}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <span>
                  {translator.translateText(
                    "Resources and their key metrics are read every few minutes.",
                  )}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <span>
                  {translator.translateText(
                    "Chart them, and alert on them with a metric monitor.",
                  )}
                </span>
              </li>
            </ul>
          </div>
        </Card>

        {notice ? (
          <Alert
            type={AlertType.SUCCESS}
            title={notice}
            dataTestId="cloud-connect-saved"
            onClose={() => {
              setNotice(undefined);
            }}
          />
        ) : (
          <></>
        )}

        <div className={showsList ? "" : "hidden"}>
          <CloudConnectionsTable
            refreshToggle={String(refreshCounter)}
            updateGate={updateGate}
            resourcesRoute={resourcesRoute}
            onEdit={(connection: CloudConnection) => {
              if (connection.provider) {
                setNotice(undefined);
                setFormState({ provider: connection.provider, connection });
              }
            }}
            onConnectionsLoaded={(totalCount: number) => {
              if (totalCount > 0) {
                setListHasRows(true);
              }
            }}
          />
        </div>

        <div
          className="flex items-start gap-2 px-1 text-sm text-gray-500"
          data-testid="cloud-connect-collector-note"
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span>
            {translator.translateText(
              "Already run an OpenTelemetry Collector, or need CloudWatch Metric Streams?",
            )}{" "}
            <a
              href={cloudConnectionDocsUrl(
                "/docs/telemetry/cloud-resources",
              ).toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {translator.translateText(
                "Send cloud metrics from your own collector",
              )}
            </a>
          </span>
        </div>
      </div>

      {formState ? (
        <CloudConnectionFormModal
          provider={formState.provider}
          connection={formState.connection}
          awsRoleSetup={awsRoleSetup}
          onClose={closeForm}
          onSaved={(saved: { name: string; isNew: boolean }) => {
            closeForm();
            setNotice(
              saved.isNew
                ? translator.translateText(
                    "Connected. The first read starts within a minute; resources appear under All Resources as it finds them.",
                  )
                : translator.translateText(
                    "Saved. The connection is read again within a minute.",
                  ),
            );
            setRefreshCounter((value: number): number => {
              return value + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CloudConnectPage;
