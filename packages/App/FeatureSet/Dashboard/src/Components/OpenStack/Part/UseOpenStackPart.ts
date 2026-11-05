import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_SERVICE_STATUS_DOWN,
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchOpenStackRow,
  fetchOpenStackRows,
} from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import { getOpenStackOptionalService } from "Common/Types/OpenStack/OpenStackOptionalServices";
import { getOpenStackRowsAsThisCredentialReadsThem } from "../../../Pages/OpenStack/Utils/OpenStackServices";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
  openStackIdFromRouteParam,
} from "./OpenStackPartRoutes";

/*
 * A part's page, before anything is drawn: which cloud and which part its address names,
 * the cloud's name, and the part's row. The address is
 * .../openstack/:modelId/<kind>/:subModelId, where the last holds the part's external id.
 *
 * Once a read has succeeded, a later one that fails leaves what it showed on screen. A
 * first read that fails says so, in place of "not reported".
 */
export interface OpenStackPart {
  kind: OpenStackResourceKind;
  openStackCloudId: ObjectID;
  externalId: string;
  routes: OpenStackPartRoutes;
  isLoadingCloud: boolean;
  cloudError: string;
  cloudName: string;
  row: OpenStackResource | null;
  isLoadingRow: boolean;
  rowError: string;
  refreshToken: number;
  retry: () => void;
}

/*
 * A Placement this credential can't read says down, as a stopped one does. It takes what else
 * this credential reads to tell them apart, and only that row's page needs to ask. The services
 * that read down when refused need nothing else: their own row says whether they've ever read up.
 */
async function asThisCredentialReadsIt(
  row: OpenStackResource,
  openStackCloudId: ObjectID,
): Promise<OpenStackResource> {
  if (
    row.kind !== OpenStackResourceKind.Api ||
    row.status !== OPENSTACK_SERVICE_STATUS_DOWN
  ) {
    return row;
  }
  if (getOpenStackOptionalService(row.name)?.readsDownWhenRefused) {
    return (
      getOpenStackRowsAsThisCredentialReadsThem({
        rows: [row],
        apis: [],
        workers: [],
      })[0] || row
    );
  }
  if (row.name !== OpenStackServiceType.Placement) {
    return row;
  }
  try {
    const facts: JSONObject = { family: OpenStackServiceFamily.Compute };
    const [apis, workers]: [
      Array<OpenStackResource>,
      Array<OpenStackResource>,
    ] = await Promise.all([
      fetchOpenStackRows({
        openStackCloudId,
        kind: OpenStackResourceKind.Api,
        limit: 200,
      }),
      fetchOpenStackRows({
        openStackCloudId,
        kind: OpenStackResourceKind.Service,
        query: { facts: facts },
        limit: 200,
      }),
    ]);
    return (
      getOpenStackRowsAsThisCredentialReadsThem({
        rows: [row],
        apis: apis,
        workers: workers,
      })[0] || row
    );
  } catch {
    // The row's own word stands when nothing can be said against it.
    return row;
  }
}

export default function useOpenStackPart(
  kind: OpenStackResourceKind,
): OpenStackPart {
  const openStackCloudId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = openStackIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(openStackCloudId);
  }, [openStackCloudId.toString()]);

  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(true);
  const [cloudError, setCloudError] = useState<string>("");
  const [cloudName, setCloudName] = useState<string>("");
  const [row, setRow] = useState<OpenStackResource | null>(null);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [rowError, setRowError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const hasRead: MutableRefObject<boolean> = useRef<boolean>(false);
  const sequence: MutableRefObject<number> = useRef<number>(0);

  const readRow: () => void = (): void => {
    const current: number = ++sequence.current;
    fetchOpenStackRow({ openStackCloudId, kind, externalId })
      .then((found: OpenStackResource | null) => {
        return found ? asThisCredentialReadsIt(found, openStackCloudId) : found;
      })
      .then((found: OpenStackResource | null) => {
        if (current !== sequence.current) {
          return;
        }
        hasRead.current = true;
        setRow(found);
        setRowError("");
        setIsLoadingRow(false);
      })
      .catch((err: Error) => {
        if (current !== sequence.current) {
          return;
        }
        if (!hasRead.current) {
          setRowError(API.getFriendlyMessage(err));
        }
        setIsLoadingRow(false);
      });
  };

  useEffect(() => {
    ModelAPI.getItem<OpenStackCloud>({
      modelType: OpenStackCloud,
      id: openStackCloudId,
      select: { name: true },
    })
      .then((cloud: OpenStackCloud | null) => {
        setCloudName(cloud?.name || "");
        setIsLoadingCloud(false);
      })
      .catch((err: Error) => {
        setCloudError(API.getFriendlyMessage(err));
        setIsLoadingCloud(false);
      });
    readRow();
  }, []);

  return {
    kind,
    openStackCloudId,
    externalId,
    routes,
    isLoadingCloud,
    cloudError,
    cloudName,
    row,
    isLoadingRow,
    rowError,
    refreshToken,
    retry: (): void => {
      setIsLoadingRow(true);
      setRefreshToken(Date.now());
      readRow();
    },
  };
}
