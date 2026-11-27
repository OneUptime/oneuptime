import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import XcpNgCollectionMethod from "Common/Types/XcpNg/XcpNgCollectionMethod";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  XCP_NG_CONNECT_QUERY_PARAM,
  XcpNgPoolReadBy,
  getXcpNgConnectionTypeLabel,
  getXcpNgPoolReadBy,
  isXcpNgPoolInSummary,
} from "./XcpNgConnectionView";

/*
 * How this pool's data reaches OneUptime, on its Settings page (#10996,
 * #10999): sent by the XCP-ng Agent, or read by a probe through one of the
 * project's XCP-ng connections - and the switch between the two.
 *
 * A pool is read by one source at a time, so its history stays one line:
 * "Use the XCP-ng Agent" drops the connection's reads of it from then on,
 * and "Collect With a Probe" picks a connection whose last read saw the
 * pool (the server checks the same). Start the new source before leaving
 * the old one, so nothing is missed - and stop the agent once a probe reads
 * the pool, or every metric arrives twice.
 */

export interface ComponentProps {
  modelId: ObjectID;
}

const CONNECTION_LIST_LIMIT: number = 100;

function getConnectionRoute(id: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route,
    { modelId: new ObjectID(id.toString()) },
  );
}

function getConnectRoute(): Route {
  return new Route(
    `${RouteUtil.populateRouteParams(
      RouteMap[PageMap.XCP_NG_CONNECTIONS] as Route,
    ).toString()}?${XCP_NG_CONNECT_QUERY_PARAM}=1`,
  );
}

const XcpNgPoolDataCollectionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [connections, setConnections] = useState<Array<XcpNgConnection>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [pickedId, setPickedId] = useState<string>("");
  const [isConfirmingAgent, setIsConfirmingAgent] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    const [item, list]: [XcpNgPool | null, ListResult<XcpNgConnection>] =
      await Promise.all([
        ModelAPI.getItem({
          modelType: XcpNgPool,
          id: props.modelId,
          select: {
            poolIdentifier: true,
            collectionMethod: true,
            xcpNgConnectionId: true,
            xcpNgConnection: {
              name: true,
              connectionType: true,
            },
          },
        }),
        ModelAPI.getList<XcpNgConnection>({
          modelType: XcpNgConnection,
          query: {},
          select: {
            _id: true,
            name: true,
            connectionType: true,
            address: true,
            collectionSummary: true,
          },
          sort: {},
          skip: 0,
          limit: CONNECTION_LIST_LIMIT,
        }).catch((): ListResult<XcpNgConnection> => {
          // One who may not read connections still sees how the pool is read.
          return { data: [], count: 0, skip: 0, limit: 0 };
        }),
      ]);

    setPool(item);
    setConnections(list.data);
  };

  const reload: () => void = (): void => {
    setIsLoading(true);
    load()
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    reload();
  }, [props.modelId.toString()]);

  if (isLoading) {
    return <DetailListSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!pool) {
    return <></>;
  }

  const canEdit: boolean = PermissionGate.check(
    new XcpNgPool(),
    ModelAction.Update,
  ).isAllowed;
  const readBy: XcpNgPoolReadBy = getXcpNgPoolReadBy(pool);
  // The connections whose last read saw this pool: the ones that can read it.
  const eligible: Array<XcpNgConnection> = connections.filter(
    (connection: XcpNgConnection): boolean => {
      return isXcpNgPoolInSummary(
        connection.collectionSummary,
        pool.poolIdentifier,
      );
    },
  );

  const save: (data: JSONObject) => void = (data: JSONObject): void => {
    setIsSaving(true);
    setSaveError("");
    ModelAPI.updateById({
      modelType: XcpNgPool,
      id: props.modelId,
      data: data,
    })
      .then(() => {
        setIsPicking(false);
        setIsConfirmingAgent(false);
        reload();
      })
      .catch((err: Error) => {
        setSaveError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const buttons: Array<CardButtonSchema> = [];

  if (canEdit && readBy !== XcpNgPoolReadBy.Agent) {
    buttons.push({
      title: "Use the XCP-ng Agent",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Refresh,
      onClick: () => {
        setSaveError("");
        setIsConfirmingAgent(true);
      },
    });
  }

  if (canEdit && readBy !== XcpNgPoolReadBy.Connection) {
    buttons.push({
      title: "Collect With a Probe",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Refresh,
      onClick: () => {
        setSaveError("");
        setPickedId(
          eligible.length === 1 ? String(eligible[0]!._id) : pickedId,
        );
        setIsPicking(true);
      },
    });
  }

  const connectionName: string =
    pool.xcpNgConnection?.name || pool.xcpNgConnectionId?.toString() || "";

  let body: ReactElement;

  if (readBy === XcpNgPoolReadBy.Connection) {
    body = (
      <p className="text-sm text-gray-700" data-testid="xcp-ng-pool-read-by">
        <TranslatedSentence
          template="A probe reads this pool through {{connection}}. No agent runs for it."
          slots={{
            connection: (
              <AppLink
                to={getConnectionRoute(pool.xcpNgConnectionId!)}
                className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500"
              >
                <bdi>{connectionName}</bdi>
              </AppLink>
            ),
          }}
        />
      </p>
    );
  } else if (readBy === XcpNgPoolReadBy.RemovedConnection) {
    body = (
      <p className="text-sm text-amber-800" data-testid="xcp-ng-pool-read-by">
        {translator.translateText(
          "The connection that read this pool was deleted, so nothing reads it now. Collect it with another connection's probe, or use the XCP-ng Agent.",
        )}
      </p>
    );
  } else {
    body = (
      <p className="text-sm text-gray-700" data-testid="xcp-ng-pool-read-by">
        {translator.translateText(
          "The XCP-ng Agent you run next to Xen Orchestra sends this pool's data. A probe can read it instead, through a connection to its Xen Orchestra or to the pool itself, with nothing to install.",
        )}
      </p>
    );
  }

  return (
    <Fragment>
      <Card
        title="Data Collection"
        description="How this pool's data reaches OneUptime. A pool is read by one source at a time, so its history stays one line."
        buttons={buttons}
      >
        <div data-testid="xcp-ng-pool-data-collection">{body}</div>
      </Card>

      {isPicking ? (
        <Modal
          title="Collect With a Probe"
          description="Pick the connection to read this pool. Once its first read shows here, stop the XCP-ng Agent if nothing else needs it, or every metric arrives twice."
          modalWidth={ModalWidth.Medium}
          submitButtonText="Collect With a Probe"
          disableSubmitButton={!pickedId || isSaving}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsPicking(false);
          }}
          onSubmit={() => {
            save({
              collectionMethod: XcpNgCollectionMethod.Probe,
              xcpNgConnectionId: new ObjectID(pickedId),
            });
          }}
        >
          {eligible.length === 0 ? (
            <div
              className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
              data-testid="xcp-ng-no-eligible-connection"
            >
              <p>
                {translator.translateText(
                  "No connection reads this pool yet. Connect its Xen Orchestra, or the pool itself, and come back once the first read finds it.",
                )}
              </p>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-indigo-700 hover:text-indigo-900"
                onClick={() => {
                  Navigation.navigate(getConnectRoute());
                }}
              >
                {translator.translateText("Connect XCP-ng")}
              </button>
            </div>
          ) : (
            <ul
              className="divide-y divide-gray-200 rounded-md border border-gray-200"
              role="radiogroup"
              data-testid="xcp-ng-eligible-connections"
            >
              {eligible.map((connection: XcpNgConnection) => {
                const id: string = String(connection._id);
                const isPicked: boolean = id === pickedId;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      className={`flex w-full items-start gap-3 p-3 text-start ${
                        isPicked ? "bg-indigo-50" : "hover:bg-gray-50"
                      }`}
                      onClick={() => {
                        setPickedId(id);
                      }}
                    >
                      <span
                        className={`mt-1 inline-block h-3 w-3 flex-none rounded-full border ${
                          isPicked
                            ? "border-indigo-600 bg-indigo-600"
                            : "border-gray-400"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">
                          <bdi>{connection.name || connection.address}</bdi>
                        </span>
                        <span className="flex flex-wrap gap-x-2 text-xs text-gray-500">
                          <span>
                            {getXcpNgConnectionTypeLabel(
                              connection.connectionType,
                              translator,
                            )}
                          </span>
                          <bdi className="font-mono">{connection.address}</bdi>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      ) : (
        <></>
      )}

      {isConfirmingAgent ? (
        <ConfirmModal
          title="Use the XCP-ng Agent"
          description="From now on the probe's reads of this pool are dropped and the XCP-ng Agent's kept. Start the agent next to Xen Orchestra first, so nothing is missed."
          submitButtonText="Use the XCP-ng Agent"
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsConfirmingAgent(false);
          }}
          onSubmit={() => {
            save({ collectionMethod: XcpNgCollectionMethod.Agent });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default XcpNgPoolDataCollectionCard;
