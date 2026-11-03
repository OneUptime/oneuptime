import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import NeedsAttentionCard from "../ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import {
  DATABASE_FLEET_ATTENTION_LIMIT,
  DATABASE_FLEET_ATTENTION_SELECT,
  DATABASE_FLEET_ATTENTION_TRUNCATED_DESCRIPTION,
  getDatabaseFleetAttentionItems,
  getDatabaseFleetAttentionQueries,
  isDatabaseFleetAttentionTruncated,
} from "../../Pages/Database/Utils/DatabaseFleetAttention";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * "Which of my databases needs me now, and why?" - first on the Databases
 * list: every database past one of its engine's recommended alerts' lines
 * (connections near the limit, a replica behind, memory near maxmemory, a
 * restart, a full tablespace, a red cluster) and every one whose engine
 * metrics stopped, the most urgent first, each row one step from the
 * database's page (DatabaseHealth's rules, through DatabaseFleetAttention).
 *
 * It asks only for the databases whose stored verdict may need someone,
 * so it works for a fleet of any size, and reads again every minute - the
 * readings it judges arrive about as often - and whenever the list is
 * refreshed. A calm fleet draws no card; a read that fails says so in the
 * card's frame, with Refresh.
 */

// How often the card reads again while the list is open.
export const DATABASE_FLEET_ATTENTION_REFRESH_MS: number = 60 * 1000;

export const DATABASE_FLEET_ATTENTION_TEST_ID: string =
  "database-fleet-attention";

export interface ComponentProps {
  // Read again when this changes: the list's refresh.
  refreshToken?: string | number | undefined;
}

interface FleetRead {
  databases: Array<DatabaseServer>;
  isTruncated: boolean;
  readAt: Date;
}

export async function fetchDatabaseFleetAttention(
  now: Date,
): Promise<FleetRead> {
  const results: Array<ListResult<DatabaseServer>> = await Promise.all(
    getDatabaseFleetAttentionQueries(now).map(
      (
        query: Query<DatabaseServer>,
      ): Promise<ListResult<DatabaseServer>> => {
        return ModelAPI.getList<DatabaseServer>({
          modelType: DatabaseServer,
          query: query,
          select: DATABASE_FLEET_ATTENTION_SELECT,
          sort: { name: SortOrder.Ascending },
          skip: 0,
          limit: DATABASE_FLEET_ATTENTION_LIMIT,
        });
      },
    ),
  );

  return {
    databases: results.flatMap(
      (result: ListResult<DatabaseServer>): Array<DatabaseServer> => {
        return result.data || [];
      },
    ),
    isTruncated: isDatabaseFleetAttentionTruncated(
      results.map((result: ListResult<DatabaseServer>): number => {
        return (result.data || []).length;
      }),
    ),
    readAt: now,
  };
}

const DatabaseFleetAttentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [read, setRead] = useState<FleetRead | null>(null);
  const [error, setError] = useState<string>("");
  // Only the newest read may land: a slow one never paints over a newer.
  const readSequence: React.MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const sequence: number = ++readSequence.current;
    try {
      const loaded: FleetRead = await fetchDatabaseFleetAttention(new Date());
      if (sequence !== readSequence.current) {
        return;
      }
      setRead(loaded);
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
    }, DATABASE_FLEET_ATTENTION_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <NeedsAttentionCard
        testId={DATABASE_FLEET_ATTENTION_TEST_ID}
        items={[]}
        error={error}
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  if (!read) {
    return <></>;
  }

  const items: Array<ResourceAttentionItem> = getDatabaseFleetAttentionItems({
    databases: read.databases,
    now: read.readAt,
    getDatabaseRoute: (databaseId: string): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route,
        { modelId: new ObjectID(databaseId) },
      );
    },
  });

  return (
    <NeedsAttentionCard
      testId={DATABASE_FLEET_ATTENTION_TEST_ID}
      items={items}
      description={
        read.isTruncated
          ? translator.translateTemplate(
              DATABASE_FLEET_ATTENTION_TRUNCATED_DESCRIPTION,
              { count: translator.formatNumber(DATABASE_FLEET_ATTENTION_LIMIT) },
            )
          : undefined
      }
    />
  );
};

export default DatabaseFleetAttentionCard;
