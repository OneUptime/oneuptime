import PageComponentProps from "../PageComponentProps";
import LatencyMatrixGrid from "../../Components/NetworkDevice/LatencyMatrixGrid";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LatencyMatrix, {
  LatencyMatrixAxisItem,
  LatencyMatrixCell,
} from "Common/Types/Monitor/LatencyMatrix";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const EMPTY_MATRIX: LatencyMatrix = { monitors: [], probes: [], cells: {} };

// Narrow an untyped axis payload into LatencyMatrixAxisItem[], dropping bad rows.
const parseAxis: (raw: unknown) => Array<LatencyMatrixAxisItem> = (
  raw: unknown,
): Array<LatencyMatrixAxisItem> => {
  const rawItems: JSONArray = Array.isArray(raw) ? (raw as JSONArray) : [];
  return rawItems
    .map((row: unknown): LatencyMatrixAxisItem | null => {
      const item: JSONObject = (row || {}) as JSONObject;
      if (!item["id"]) {
        return null;
      }
      return {
        id: item["id"] as string,
        name: (item["name"] as string) || (item["id"] as string),
      };
    })
    .filter((i: LatencyMatrixAxisItem | null): i is LatencyMatrixAxisItem => {
      return i !== null;
    });
};

// Narrow an untyped API payload into a LatencyMatrix, dropping malformed rows.
const parseLatencyMatrixResponse: (
  data: JSONObject | undefined,
) => LatencyMatrix = (data: JSONObject | undefined): LatencyMatrix => {
  const monitors: Array<LatencyMatrixAxisItem> = parseAxis(data?.["monitors"]);
  const probes: Array<LatencyMatrixAxisItem> = parseAxis(data?.["probes"]);

  const rawCells: JSONObject =
    data?.["cells"] && typeof data["cells"] === "object"
      ? (data["cells"] as JSONObject)
      : {};

  const cells: Record<string, Record<string, LatencyMatrixCell>> = {};

  for (const monitorId of Object.keys(rawCells)) {
    const rawRow: JSONObject =
      rawCells[monitorId] && typeof rawCells[monitorId] === "object"
        ? (rawCells[monitorId] as JSONObject)
        : {};
    const row: Record<string, LatencyMatrixCell> = {};

    for (const probeId of Object.keys(rawRow)) {
      const rawCell: JSONObject = (rawRow[probeId] || {}) as JSONObject;
      row[probeId] = {
        monitorId: (rawCell["monitorId"] as string) || monitorId,
        probeId: (rawCell["probeId"] as string) || probeId,
        hasData: Boolean(rawCell["hasData"]),
        latencyInMs: rawCell["latencyInMs"] as number | undefined,
        isOnline: rawCell["isOnline"] as boolean | undefined,
        ageInSeconds: rawCell["ageInSeconds"] as number | undefined,
      };
    }

    cells[monitorId] = row;
  }

  return { monitors, probes, cells };
};

const NetworkDeviceLatencyMatrix: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [matrix, setMatrix] = useState<LatencyMatrix>(EMPTY_MATRIX);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchMatrix: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
        "/network-device/latency-matrix",
      );

      /*
       * Project scoping is attached automatically via the tenantid header
       * that ModelAPI.getCommonHeaders() sets from the current project.
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url,
          data: {
            projectId: ProjectUtil.getCurrentProjectId()?.toString(),
          },
          headers: { ...ModelAPI.getCommonHeaders() },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setMatrix(parseLatencyMatrixResponse(response.data));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchMatrix().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <Card
        title="Probe Latency Matrix"
        description="Latest response time each probe measured for every target — spot slow paths at a glance."
        buttons={[
          {
            title: "Refresh",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            onClick: () => {
              fetchMatrix().catch((err: Error) => {
                setError(API.getFriendlyMessage(err));
              });
            },
          },
        ]}
      >
        <LatencyMatrixGrid matrix={matrix} />
      </Card>
    </Fragment>
  );
};

export default NetworkDeviceLatencyMatrix;
