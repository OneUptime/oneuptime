import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import NeedsAttentionCard from "../ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CLOUD_RESOURCE_HEALTH_SELECT,
  getCloudResourceAttentionItems,
} from "./CloudResourceAttention";

/*
 * "Which of my cloud resources needs me now, and why?" - on the Cloud
 * Overview, over every account, and on an account's Overview, over its
 * own: every resource failing its status checks, out of storage, with
 * failing requests or throttled, the most urgent first, each one step from
 * its page (CloudResourceHealth's rules, through CloudResourceAttention).
 *
 * It reads only the resources whose last read found something
 * (CloudResource.healthSeverity, a partial index), so it works for an
 * estate of any size, and again every minute while the page is open. A
 * calm estate draws no card; a read that fails says so in the card's
 * frame, with Refresh.
 */

// How often the card reads again while the page is open.
export const CLOUD_ATTENTION_REFRESH_MS: number = 60 * 1000;

// The most resources one read lists; the card says when there are more.
export const CLOUD_ATTENTION_READ_LIMIT: number = 100;

export const CLOUD_ATTENTION_DESCRIPTION: string = translationKey(
  "Resources whose key metrics show something wrong, the most urgent first.",
);

export function getCloudAttentionQuery(
  base: Query<CloudResource>,
): Query<CloudResource> {
  return {
    ...base,
    cloudResourceKind: CloudResourceKind.Resource,
    isArchived: false,
    healthSeverity: new NotNull(),
  } as Query<CloudResource>;
}

export interface CloudAttention {
  items: Array<ResourceAttentionItem>;
  // Resources the server found, which can be more than one read lists.
  total: number;
}

export async function fetchCloudAttention(data: {
  query: Query<CloudResource>;
  showAccount: boolean;
}): Promise<CloudAttention> {
  const result: ListResult<CloudResource> = await ModelAPI.getList({
    modelType: CloudResource,
    query: getCloudAttentionQuery(data.query),
    select: CLOUD_RESOURCE_HEALTH_SELECT,
    // "critical" sorts before "warning": the most urgent are read first.
    sort: { healthSeverity: SortOrder.Ascending },
    skip: 0,
    limit: CLOUD_ATTENTION_READ_LIMIT,
  });

  return {
    items: getCloudResourceAttentionItems({
      resources: result.data,
      now: OneUptimeDate.getCurrentDate(),
      showAccount: data.showAccount,
      getResourceRoute: (resourceId: string): Route => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
          { modelId: new ObjectID(resourceId) },
        );
      },
    }),
    total: result.count,
  };
}

export interface ComponentProps {
  // Which resources: the project's, or one account's (CloudAccountScope).
  query: Query<CloudResource>;
  // Name the account under each resource: the Overview reads every account.
  showAccount?: boolean | undefined;
  // Read again when this changes: the page's refresh.
  refreshToken?: string | number | undefined;
  testId?: string | undefined;
  // What it found, for the page's own counts.
  onLoaded?: ((attention: CloudAttention) => void) | undefined;
  // That it could not read them: the page's counts say they are not known.
  onFailed?: (() => void) | undefined;
}

const CloudAttentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [attention, setAttention] = useState<CloudAttention | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const queryKey: string = JSON.stringify(props.query);

  const retry: () => void = useCallback((): void => {
    setAttempt((value: number): number => {
      return value + 1;
    });
  }, []);

  useEffect(() => {
    let ignore: boolean = false;

    const read: () => void = (): void => {
      fetchCloudAttention({
        query: props.query,
        showAccount: props.showAccount === true,
      })
        .then((found: CloudAttention): void => {
          if (!ignore) {
            setError("");
            setAttention(found);
            props.onLoaded?.(found);
          }
        })
        .catch((err: Error): void => {
          if (!ignore) {
            setError(API.getFriendlyMessage(err));
            props.onFailed?.();
          }
        });
    };

    read();

    const timer: ReturnType<typeof setInterval> = setInterval(
      read,
      CLOUD_ATTENTION_REFRESH_MS,
    );

    return (): void => {
      ignore = true;
      clearInterval(timer);
    };
  }, [queryKey, props.refreshToken, attempt]);

  return (
    <NeedsAttentionCard
      testId={props.testId || "cloud-attention"}
      description={CLOUD_ATTENTION_DESCRIPTION}
      items={attention?.items || []}
      error={error}
      onRetry={retry}
    />
  );
};

export default CloudAttentionCard;
