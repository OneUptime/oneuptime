import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { BILLING_ENABLED } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  StorageArrayCollectionStatusView,
  StorageArrayCollectionTone,
  findArrayConnection,
  getCollector,
  getStorageArrayCollectionDescription,
  getStorageArrayCollectionStatusView,
} from "./StorageArrayConnectionView";

/*
 * How an array a probe reads from its management server is collected
 * (#11004), first on its Overview in place of the agent's connection
 * guide: which Unisphere it is read through, whether that is working and
 * the one thing that fixes it, and the way to the connection's page. An
 * array no connection lists any more says so, with the way to connect the
 * one that manages it.
 */

export interface ComponentProps {
  storageSystem: string;
  // The array's own identifier (StorageArray.systemId): a Symmetrix ID.
  systemId: string | null | undefined;
}

function badgeTypeOf(tone: StorageArrayCollectionTone): StatusBadgeType {
  switch (tone) {
    case StorageArrayCollectionTone.Collecting:
      return StatusBadgeType.Success;
    case StorageArrayCollectionTone.Failing:
      return StatusBadgeType.Danger;
    default:
      return StatusBadgeType.Info;
  }
}

const StorageArrayCollectedByCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connections, setConnections] = useState<Array<StorageArrayConnection>>(
    [],
  );
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    ModelAPI.getList<StorageArrayConnection>({
      modelType: StorageArrayConnection,
      query: {
        storageSystem: props.storageSystem,
      },
      select: {
        _id: true,
        name: true,
        address: true,
        username: true,
        projectId: true,
        isPasswordSet: true,
        collectionIntervalInMinutes: true,
        collectionStatus: true,
        collectionErrorCode: true,
        collectionError: true,
        presentedCertificate: true,
        collectionSummary: true,
        nextCollectionAt: true,
        collectionProbeId: true,
        collectionProbe: {
          name: true,
          isGlobalProbe: true,
          projectId: true,
          connectionStatus: true,
        },
      },
      limit: 100,
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<StorageArrayConnection>) => {
        setConnections(result.data);
      })
      .catch(() => {
        // The card then says no connection lists the array.
      })
      .finally(() => {
        setIsLoaded(true);
      });
  }, [props.storageSystem, props.systemId]);

  if (!isLoaded) {
    return <></>;
  }

  const collector: ReturnType<typeof getCollector> = getCollector(
    props.storageSystem,
  );
  const found: ReturnType<typeof findArrayConnection> = findArrayConnection(
    connections,
    props.systemId,
  );

  if (!found) {
    return (
      <Card
        title="Data Collection"
        description="No connection lists this array any more, so nothing reads it. Connect the Unisphere that manages it, or check the one that did."
        rightElement={
          <StatusBadge
            text={translator.translateText("Not collecting") as string}
            type={StatusBadgeType.Danger}
          />
        }
        buttons={[
          {
            title: "View Connections",
            icon: IconProp.Link,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.STORAGE_ARRAYS_CONNECTIONS] as Route,
                ),
              );
            },
          },
        ]}
      />
    );
  }

  const view: StorageArrayCollectionStatusView =
    getStorageArrayCollectionStatusView(
      found.connection,
      translator,
      new Date(),
      BILLING_ENABLED,
    );
  const connectionRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.STORAGE_ARRAYS_CONNECTION_VIEW] as Route,
    { modelId: new ObjectID(found.connection._id!.toString()) },
  );

  return (
    <Card
      title="Data Collection"
      description={getStorageArrayCollectionDescription(
        found.connection,
        translator,
        new Date(),
        BILLING_ENABLED,
      )}
      rightElement={
        <StatusBadge text={view.label} type={badgeTypeOf(view.tone)} />
      }
      buttons={[
        {
          title: "View Connection",
          icon: IconProp.Link,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: () => {
            Navigation.navigate(connectionRoute);
          },
        },
      ]}
    >
      <div
        className="space-y-2 text-sm"
        data-testid="storage-array-collected-by"
      >
        <div className="flex items-start gap-2">
          <Icon
            icon={
              view.tone === StorageArrayCollectionTone.Failing
                ? IconProp.Alert
                : view.tone === StorageArrayCollectionTone.Collecting
                  ? IconProp.CheckCircle
                  : IconProp.Clock
            }
            className={`mt-0.5 h-4 w-4 flex-none ${
              view.tone === StorageArrayCollectionTone.Failing
                ? "text-red-600"
                : view.tone === StorageArrayCollectionTone.Collecting
                  ? "text-emerald-600"
                  : "text-indigo-600"
            }`}
          />
          <div className="min-w-0">
            <div className="font-medium text-gray-900">
              {view.tone === StorageArrayCollectionTone.Collecting
                ? translator.translateTemplate(
                    "Read through {{connection}}, a {{product}} connection.",
                    {
                      connection: found.connection.name || "",
                      product: collector.serverProductName,
                    },
                  )
                : view.title}
            </div>
            {view.nextStep ? (
              <p className="mt-1 text-gray-600">{view.nextStep}</p>
            ) : (
              <></>
            )}
          </div>
        </div>
        {found.array.warnings.length > 0 ? (
          <ul className="space-y-1 text-xs text-gray-600">
            {found.array.warnings.map((warning: string) => {
              return (
                <li key={warning} className="flex items-start gap-1.5">
                  <Icon
                    icon={IconProp.Info}
                    className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-600"
                  />
                  <span className="break-words">{warning}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default StorageArrayCollectedByCard;
