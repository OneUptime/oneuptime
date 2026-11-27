import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  cloudConnectionDocsUrl,
  getCloudConnectionAwsRoleSetup,
} from "../../Components/Cloud/Connect/CloudConnectApi";
import CloudConnectionFormModal from "../../Components/Cloud/Connect/CloudConnectionFormModal";
import {
  CLOUD_CONNECT_CLOUD_QUERY_PARAM,
  CLOUD_CONNECT_CONNECTION_QUERY_PARAM,
  isCloudConnectionIdInLink,
} from "../../Components/Cloud/Connect/CloudConnectRoutes";
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
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
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
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
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
 * what it holds; a row can also stream - an AWS account's CloudWatch metrics
 * and logs through Amazon Data Firehose, an Azure subscription's metrics and
 * resource logs through event hubs OneUptime reads, a Google Cloud project's
 * logs through Pub/Sub - within minutes, between reads. A link with
 * ?cloud=aws (azure, gcp) opens that cloud's
 * form at once, so the empty All Resources page can send people straight
 * to it. A link with ?connection=<id> opens that connection's form to edit
 * it, for someone who may: a security case's step links there to turn
 * Security case checks on for the AWS connection it means (#11039).
 */

export const CLOUD_QUERY_PARAM: string = CLOUD_CONNECT_CLOUD_QUERY_PARAM;

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

/*
 * The connection a link names, as its form edits it - its name, its cloud
 * and its settings, never its credentials - or null: gone, not a cloud's,
 * or not readable.
 */
async function readLinkedConnection(
  connectionId: string,
): Promise<CloudConnection | null> {
  try {
    const connection: CloudConnection | null =
      await ModelAPI.getItem<CloudConnection>({
        modelType: CloudConnection,
        id: new ObjectID(connectionId),
        select: { _id: true, name: true, provider: true, config: true },
      });

    return connection && isCloudConnectionProvider(connection.provider)
      ? connection
      : null;
  } catch {
    return null;
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
  /*
   * Bumped when the list loads again after a change made there - a
   * connection deleted - so the tiles count it at once.
   */
  const [knownVersion, setKnownVersion] = useState<number>(0);
  const listHasLoaded: MutableRefObject<boolean> = useRef<boolean>(false);
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
  }, [refreshCounter, knownVersion, disableTelemetryForThisProject]);

  /*
   * A link naming a connection opens its form to edit it, once it is read
   * (#11039) - for someone who may change it. Anyone else sees the list,
   * whose Edit says what it takes; a connection gone since opens nothing.
   */
  useEffect(() => {
    const linked: string | null = Navigation.getQueryStringByName(
      CLOUD_CONNECT_CONNECTION_QUERY_PARAM,
    );

    if (
      disableTelemetryForThisProject ||
      !updateGate.isAllowed ||
      !isCloudConnectionIdInLink(linked)
    ) {
      return;
    }

    let isCurrent: boolean = true;

    void readLinkedConnection(linked).then(
      (connection: CloudConnection | null) => {
        if (isCurrent && connection && connection.provider) {
          const provider: CloudProvider = connection.provider;

          setFormState(
            (
              current:
                | { provider: CloudProvider; connection?: CloudConnection }
                | undefined,
            ) => {
              return current || { provider, connection };
            },
          );
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [disableTelemetryForThisProject]);

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
      <ResellerPlanNotice
        project={props.currentProject}
        product="Cloud Monitoring"
      />
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
    if (
      Navigation.getQueryStringByName(CLOUD_QUERY_PARAM) ||
      Navigation.getQueryStringByName(CLOUD_CONNECT_CONNECTION_QUERY_PARAM)
    ) {
      Navigation.setQueryString({
        [CLOUD_QUERY_PARAM]: "",
        [CLOUD_CONNECT_CONNECTION_QUERY_PARAM]: "",
      });
    }
  };

  return (
    <Fragment>
      <div className="space-y-6" data-testid="cloud-connect-page">
        <Card
          title="Connect a cloud account"
          description="See every resource in your AWS, Azure and Google Cloud accounts, with its key metrics. One command in your cloud's terminal connects an account."
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

            {/* Side by side from xl, as the tiles above: narrower, they stack. */}
            <ul
              className="mt-5 grid grid-cols-1 gap-3 border-t border-gray-200 pt-4 text-sm text-gray-600 xl:grid-cols-3"
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
                  icon={IconProp.Bell}
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

              // A later load follows a change in the list: count again.
              if (listHasLoaded.current) {
                setKnownVersion((value: number): number => {
                  return value + 1;
                });
              }

              listHasLoaded.current = true;
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
              "Already run an OpenTelemetry Collector?",
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
            const provider: CloudProvider = formState.provider;

            closeForm();
            // A new connection hears how its cloud streams, between reads.
            if (!saved.isNew) {
              setNotice(
                translator.translateText(
                  "Saved. The connection is read again within a minute.",
                ),
              );
            } else if (provider === CloudProvider.AWS) {
              setNotice(
                translator.translateText(
                  "Connected. The first read starts within a minute; resources appear under All Resources as it finds them. For metrics within minutes, and CloudWatch Logs, choose Stream metrics and logs in its row.",
                ),
              );
            } else if (provider === CloudProvider.Azure) {
              setNotice(
                translator.translateText(
                  "Connected. The first read starts within a minute; resources appear under All Resources as it finds them. For metrics within minutes, and resource logs, choose Stream metrics and logs in its row.",
                ),
              );
            } else if (provider === CloudProvider.GCP) {
              setNotice(
                translator.translateText(
                  "Connected. The first read starts within a minute; resources appear under All Resources as it finds them. For its logs as they are written, choose Stream logs in its row.",
                ),
              );
            } else {
              setNotice(
                translator.translateText(
                  "Connected. The first read starts within a minute; resources appear under All Resources as it finds them.",
                ),
              );
            }
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
