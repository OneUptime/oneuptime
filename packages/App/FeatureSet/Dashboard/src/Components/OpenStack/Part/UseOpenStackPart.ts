import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { fetchOpenStackRow } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
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
