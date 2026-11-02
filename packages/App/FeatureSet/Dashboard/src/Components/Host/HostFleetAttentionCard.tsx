import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Host from "Common/Models/DatabaseModels/Host";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import NeedsAttentionCard from "../ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import {
  HOST_FLEET_ATTENTION_TRUNCATED_DESCRIPTION,
  getHostFleetAttentionItems,
} from "../../Pages/Host/Utils/HostAttention";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * "Which of my servers needs me now, and why?" - first on the Hosts list:
 * every host that has stopped reporting, has a filesystem or its inodes
 * nearly full, is short of memory or swap, has more work queued than cores,
 * has failed systemd units, or runs a collector config that did not start,
 * the most urgent first, each row one step from the host's page
 * (HostHealth's rules, through HostAttention).
 *
 * The server reads only the hosts past one of those lines (POST
 * /host/needs-attention), so the card works for a fleet of any size. It
 * reads again every minute - the readings it judges arrive about as often -
 * and whenever the list is refreshed. A calm fleet draws no card; a read
 * that fails says so in the card's frame, with Refresh.
 */

// How often the card reads again while the list is open.
export const HOST_FLEET_ATTENTION_REFRESH_MS: number = 60 * 1000;

export const HOST_FLEET_ATTENTION_TEST_ID: string = "host-fleet-attention";

export interface ComponentProps {
  // Read again when this changes: the list's refresh.
  refreshToken?: string | number | undefined;
}

export interface HostFleetAttention {
  hosts: Array<Host>;
  isTruncated: boolean;
}

export async function fetchHostFleetAttention(): Promise<HostFleetAttention> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    "/host/needs-attention",
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: url,
      data: {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const data: JSONObject = response.data || {};
  const hosts: JSONArray = Array.isArray(data["hosts"])
    ? (data["hosts"] as JSONArray)
    : [];

  return {
    hosts: DatabaseBaseModel.fromJSONArray<Host>(
      hosts as Array<JSONObject>,
      Host,
    ),
    isTruncated: data["isTruncated"] === true,
  };
}

const HostFleetAttentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [attention, setAttention] = useState<HostFleetAttention | null>(null);
  const [error, setError] = useState<string>("");
  const [now, setNow] = useState<Date>(new Date());
  // Only the newest read may land: a slow one never paints over a newer.
  const readSequence: React.MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const sequence: number = ++readSequence.current;
    try {
      const loaded: HostFleetAttention = await fetchHostFleetAttention();
      if (sequence !== readSequence.current) {
        return;
      }
      setAttention(loaded);
      setNow(new Date());
      setError("");
    } catch (err) {
      if (sequence !== readSequence.current) {
        return;
      }
      setError(API.getFriendlyMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [props.refreshToken]);

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void load();
    }, HOST_FLEET_ATTENTION_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <NeedsAttentionCard
        testId={HOST_FLEET_ATTENTION_TEST_ID}
        items={[]}
        error={error}
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  if (!attention) {
    return <></>;
  }

  const items: Array<ResourceAttentionItem> = getHostFleetAttentionItems({
    hosts: attention.hosts,
    now: now,
    getHostRoute: (hostId: string): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOST_VIEW] as Route,
        { modelId: new ObjectID(hostId) },
      );
    },
  });

  return (
    <NeedsAttentionCard
      testId={HOST_FLEET_ATTENTION_TEST_ID}
      items={items}
      showKind={false}
      description={
        attention.isTruncated
          ? HOST_FLEET_ATTENTION_TRUNCATED_DESCRIPTION
          : undefined
      }
    />
  );
};

export default HostFleetAttentionCard;
