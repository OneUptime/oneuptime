import DataPathGraph, { NEUTRAL_EDGE_COLOR } from "./DataPathGraph";
import {
  DataPathGraph as DataPathGraphModel,
  DataPathStore,
  buildDataPathGraph,
  getDataPathServiceIds,
} from "./DataPathModel";
import { FLOW_KIND_AI_PROVIDER, FLOW_KIND_EXTERNAL_HOST } from "./FlowKinds";
import { canOpenIdentities, getAccessIdentityRoute } from "./IdentityCells";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Blue500, Orange500, Red500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * WHO CAN REACH A STORE AND WHERE ITS DATA GOES, ON ITS OVERVIEW.
 *
 * Reads the store's access entries, the flows out of it, and the AI and
 * outside calls of the services that use it, and draws them as one map
 * (DataPathModel, DataPathGraph). The tables behind it stay where they
 * were - Who Can Reach It and Data Flows - for searching and filtering
 * what the map folds away.
 */

// The access entries read: a store with more folds the rest into "+N more".
export const DATA_PATH_ACCESS_READ: number = 1000;

// The flows read out of the store, and onward from its services.
export const DATA_PATH_FLOWS_READ: number = 500;

const ACCESS_SELECT: Select<DataStoreAccess> = {
  _id: true,
  principal: true,
  principalName: true,
  principalType: true,
  accessLevel: true,
  isExternal: true,
  isPublic: true,
  isUnused: true,
  isSeenInTraces: true,
};

const FLOW_SELECT: Select<DataSecurityFlow> = {
  _id: true,
  kind: true,
  sourceDataStoreId: true,
  serviceId: true,
  service: { name: true },
  destinationDataStoreId: true,
  destinationDataStore: { name: true, kind: true },
  destination: true,
  sensitivity: true,
  isConfirmed: true,
  overlapPercent: true,
  callCount: true,
};

const EMPTY: string = translationKey(
  "Nobody is known to reach this store yet, and no data is seen leaving it. Access is read with its configuration, and flows appear once its services send traces to OneUptime.",
);

const LEGEND_RED: string = translationKey(
  "Anyone on the internet, or Restricted data",
);
const LEGEND_ORANGE: string = translationKey(
  "Outside your accounts, or Confidential data",
);
const LEGEND_BLUE: string = translationKey("Internal data");
const LEGEND_DASHED: string = translationKey(
  "Path only: no scan has found the data there yet",
);

interface DataPathReads {
  access: ListResult<DataStoreAccess>;
  outgoing: Array<DataSecurityFlow>;
  onward: Array<DataSecurityFlow>;
}

async function readDataPaths(dataStoreId: ObjectID): Promise<DataPathReads> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectQuery: { projectId?: ObjectID } = projectId
    ? { projectId: projectId }
    : {};

  const [access, outgoing] = await Promise.all([
    ModelAPI.getList<DataStoreAccess>({
      modelType: DataStoreAccess,
      query: { ...projectQuery, dataStoreId: dataStoreId },
      limit: DATA_PATH_ACCESS_READ,
      skip: 0,
      select: ACCESS_SELECT,
      // Outside your accounts first, as on Who Can Reach It.
      sort: { isExternal: SortOrder.Descending },
    }),
    ModelAPI.getList<DataSecurityFlow>({
      modelType: DataSecurityFlow,
      query: { ...projectQuery, sourceDataStoreId: dataStoreId },
      limit: DATA_PATH_FLOWS_READ,
      skip: 0,
      select: FLOW_SELECT,
      sort: { lastSeenAt: SortOrder.Descending },
    }),
  ]);

  const serviceIds: Array<string> = getDataPathServiceIds(
    access.data,
    outgoing.data,
  );

  const onward: Array<DataSecurityFlow> =
    serviceIds.length > 0
      ? (
          await ModelAPI.getList<DataSecurityFlow>({
            modelType: DataSecurityFlow,
            query: {
              ...projectQuery,
              serviceId: new Includes(serviceIds),
              kind: new Includes([
                FLOW_KIND_AI_PROVIDER,
                FLOW_KIND_EXTERNAL_HOST,
              ]),
            },
            limit: DATA_PATH_FLOWS_READ,
            skip: 0,
            select: FLOW_SELECT,
            sort: { lastSeenAt: SortOrder.Descending },
          })
        ).data
      : [];

  return { access: access, outgoing: outgoing.data, onward: onward };
}

// A swatch of an arrow, and what it stands for.
const LegendItem: FunctionComponent<{
  color: string;
  isDashed?: boolean | undefined;
  text: string;
}> = (props: {
  color: string;
  isDashed?: boolean | undefined;
  text: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="8" aria-hidden={true} className="shrink-0">
        <line
          x1="1"
          y1="4"
          x2="21"
          y2="4"
          stroke={props.color}
          strokeWidth="2"
          strokeDasharray={props.isDashed ? "5 3" : undefined}
        />
      </svg>
      <span>{translator.translateText(props.text) || props.text}</span>
    </span>
  );
};

export interface ComponentProps {
  dataStoreId: ObjectID;
  store: DataPathStore;
  // Changes when the page reads the store again: the map is read again too.
  refreshToken?: number | undefined;
}

const StoreDataPaths: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dataStoreIdString: string = props.dataStoreId.toString();

  const [reads, setReads] = useState<DataPathReads | null>(null);
  const [error, setError] = useState<string>("");
  const [openError, setOpenError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    readDataPaths(props.dataStoreId)
      .then((result: DataPathReads): void => {
        if (isCurrent) {
          setReads(result);
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dataStoreIdString, props.refreshToken, readCount]);

  const graph: DataPathGraphModel | null =
    useMemo((): DataPathGraphModel | null => {
      if (!reads) {
        return null;
      }

      return buildDataPathGraph({
        store: props.store,
        access: reads.access.data,
        accessTotal: reads.access.count,
        outgoing: reads.outgoing,
        onward: reads.onward,
      });
    }, [
      reads,
      props.store.id,
      props.store.name,
      props.store.kind,
      props.store.sensitivity,
      props.store.exposure,
    ]);

  // An identity's page is found from one of its grants; it may not be worked out yet.
  const openIdentity: (access: DataStoreAccess) => void = useCallback(
    (access: DataStoreAccess): void => {
      setOpenError("");

      getAccessIdentityRoute(access)
        .then((route: Route): void => {
          Navigation.navigate(route);
        })
        .catch((err: unknown): void => {
          setOpenError(API.getFriendlyMessage(err));
        });
    },
    [],
  );

  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.dataStoreId,
    });
  };

  let content: ReactElement;

  if (error) {
    content = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!graph) {
    content = <ComponentLoader />;
  } else if (graph.isEmpty) {
    content = (
      <p className="text-sm text-gray-500">
        {translator.translateText(EMPTY) || EMPTY}
      </p>
    );
  } else {
    content = (
      <div className="space-y-3">
        {openError ? (
          <Alert
            type={AlertType.DANGER}
            title={openError}
            onClose={() => {
              setOpenError("");
            }}
          />
        ) : (
          <></>
        )}
        <DataPathGraph
          graph={graph}
          storeId={dataStoreIdString}
          onOpenIdentity={canOpenIdentities() ? openIdentity : undefined}
        />
        <div
          className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500"
          data-testid="data-path-legend"
        >
          <LegendItem color={Red500.toString()} text={LEGEND_RED} />
          <LegendItem color={Orange500.toString()} text={LEGEND_ORANGE} />
          <LegendItem color={Blue500.toString()} text={LEGEND_BLUE} />
          <LegendItem
            color={NEUTRAL_EDGE_COLOR}
            isDashed={true}
            text={LEGEND_DASHED}
          />
        </div>
      </div>
    );
  }

  return (
    <Card
      headerLayout="stacked"
      title="Who Can Reach It and Where It Goes"
      description="Who can reach this store, the services that use it, and where its data can go from there. Open a card for its page."
      buttons={[
        {
          title: "Who Can Reach It",
          icon: IconProp.Key,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            Navigation.navigate(
              routeOf(PageMap.DATA_SECURITY_STORE_VIEW_ACCESS),
            );
          },
        },
        {
          title: "Data Flows",
          icon: IconProp.Share,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            Navigation.navigate(
              routeOf(PageMap.DATA_SECURITY_STORE_VIEW_FLOWS),
            );
          },
        },
      ]}
    >
      {content}
    </Card>
  );
};

export default StoreDataPaths;
