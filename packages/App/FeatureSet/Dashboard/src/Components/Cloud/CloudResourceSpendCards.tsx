import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import {
  CloudResourceDailyCost,
  CloudRightSizing,
  CloudRightSizingProfile,
  CloudRightSizingVerdict,
  CloudSizeSteps,
  CloudUsageObservation,
  buildCloudRightSizing,
  getCloudRightSizingProfile,
  getCloudSizeSteps,
  hasCloudRightSizingChange,
  isCloudRightSizingRecommendationId,
  isRecommenderSizeRecommendation,
  readCloudResourceSize,
} from "Common/Types/Cloud/CloudRightSizing";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getCloudMonitoredResourceAttributeFilters } from "../../Pages/Cloud/Utils/CloudMonitoredResourceScope";
import {
  CloudResourceCost,
  CloudResourceCostCardView,
  fetchCloudResourceCost,
  hasCloudResourceCostToShow,
} from "./CloudResourceCostCard";
import CloudResourceRightSizingCard from "./CloudResourceRightSizingCard";
import {
  fetchCloudResourceDailyCost,
  fetchCloudResourceUsage,
} from "./CloudRightSizingReads";

/*
 * What a cloud resource costs and how its size fits, on its Overview, side
 * by side: "What it costs" from its cloud's own billing and recommender
 * (CloudResourceCostCard), and its right-sizing from OneUptime's own
 * readings of its CPU and memory (CloudResourceRightSizingCard) - for a
 * resource no recommender of its cloud speaks for. Each is read once
 * here, so the right-sizing says what a change saves from the same cost
 * the other card shows, and OneUptime's own right-sizing is said once:
 * its card, not a row of the other. Nothing is drawn until both are read,
 * nor for a resource with neither.
 */

export interface ComponentProps {
  projectId: ObjectID;
  resource: CloudResource;
}

// What the two cards show, decided from what was read.
export interface CloudResourceSpendCardsShown {
  cost: CloudResourceCost | null;
  costRows: Array<CloudCostRecommendation>;
  sizing: CloudRightSizing | null;
}

// Whether a recommender of its cloud speaks for the resource's size.
export function isCoveredByRecommender(
  cost: CloudResourceCost | null,
): boolean {
  return (cost?.recommendations || []).some(
    (recommendation: CloudCostRecommendation): boolean => {
      return isRecommenderSizeRecommendation({
        kind: recommendation.kind,
        recommendationId: recommendation.recommendationId,
      });
    },
  );
}

/*
 * Which cards a resource's Overview shows: its cost when there is one or a
 * way to spend less, its right-sizing when it was sized and no recommender
 * of its cloud speaks for it - and then OneUptime's own right-sizing row is
 * left out of the cost card, which would say it a second time.
 */
export function decideCloudResourceSpendCards(data: {
  cost: CloudResourceCost | null;
  sizing: CloudRightSizing | null;
  usage: CloudUsageObservation | null;
}): CloudResourceSpendCardsShown {
  const recommendations: Array<CloudCostRecommendation> =
    data.cost?.recommendations || [];
  const isCovered: boolean = isCoveredByRecommender(data.cost);
  const showSizing: boolean = Boolean(
    data.sizing &&
      data.usage &&
      data.usage.samples > 0 &&
      !isCovered &&
      data.sizing.verdict !== CloudRightSizingVerdict.NotSized,
  );
  const costRows: Array<CloudCostRecommendation> = showSizing
    ? recommendations.filter(
        (recommendation: CloudCostRecommendation): boolean => {
          return !isCloudRightSizingRecommendationId(
            recommendation.recommendationId,
          );
        },
      )
    : recommendations;

  return {
    cost: hasCloudResourceCostToShow({
      cost: data.cost,
      recommendations: costRows,
    })
      ? data.cost
      : null,
    costRows,
    sizing: showSizing ? data.sizing : null,
  };
}

const CloudResourceSpendCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const resource: CloudResource = props.resource;
  const provider: string = (resource.cloudProvider as string) || "";
  const providerResourceId: string = resource.providerResourceId || "";
  const resourceId: string = resource.id?.toString() || "";

  // How it is sized: a type OneUptime can size, its size, its metrics.
  const profile: CloudRightSizingProfile | null = getCloudRightSizingProfile(
    provider,
    resource.cloudResourceType as string,
  );
  const size: string | null = profile
    ? readCloudResourceSize(profile, resource.cloudProperties)
    : null;
  const attributeFilters: Record<string, string> = useMemo(() => {
    return getCloudMonitoredResourceAttributeFilters(resource);
  }, [resource.cloudResourceKind, resource.telemetryAttributes]);
  const steps: CloudSizeSteps | null = profile
    ? getCloudSizeSteps(profile.ladder, size)
    : null;
  const canSize: boolean = Boolean(
    profile &&
      size &&
      steps?.isKnown &&
      !steps.isBurstable &&
      Object.keys(attributeFilters).length > 0,
  );

  const [cost, setCost] = useState<CloudResourceCost | null>(null);
  const [usage, setUsage] = useState<CloudUsageObservation | null>(null);
  const [dailyCost, setDailyCost] = useState<CloudResourceDailyCost | null>(
    null,
  );
  const [isRead, setIsRead] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;
    const now: Date = OneUptimeDate.getCurrentDate();

    setIsRead(false);
    setDailyCost(null);

    const read: () => Promise<void> = async (): Promise<void> => {
      // Only figures beside the resource: a read that fails is nothing.
      const foundCost: CloudResourceCost | null =
        providerResourceId && resource.id
          ? await fetchCloudResourceCost({
              projectId: props.projectId,
              resourceRecordId: resource.id,
              provider,
              providerResourceId,
              now,
            }).catch((): null => {
              return null;
            })
          : null;

      /*
       * Its readings only when no recommender of its cloud speaks for it:
       * its right-sizing card is not drawn then.
       */
      const foundUsage: CloudUsageObservation | null =
        canSize && profile && !isCoveredByRecommender(foundCost)
          ? await fetchCloudResourceUsage({
              projectId: props.projectId,
              profile,
              attributeFilters,
              now,
            }).catch((): null => {
              return null;
            })
          : null;

      /*
       * What a change saves or costs: its cost a day, read only when there
       * is a change to say it of and a cost to read.
       */
      let foundDailyCost: CloudResourceDailyCost | null = null;

      if (
        profile &&
        foundUsage &&
        foundCost?.hasCosts &&
        hasCloudRightSizingChange(
          buildCloudRightSizing({ profile, size, observation: foundUsage }),
        )
      ) {
        foundDailyCost = await fetchCloudResourceDailyCost({
          projectId: props.projectId,
          provider,
          providerResourceId,
          currency: foundCost.currency,
          now,
        }).catch((): null => {
          return null;
        });
      }

      if (!ignore) {
        setCost(foundCost);
        setUsage(foundUsage);
        setDailyCost(foundDailyCost);
        setIsRead(true);
      }
    };

    read().catch((): void => {
      if (!ignore) {
        setIsRead(true);
      }
    });

    return (): void => {
      ignore = true;
    };
  }, [resourceId, provider, providerResourceId, size, canSize]);

  if (!isRead) {
    return <></>;
  }

  const sizing: CloudRightSizing | null =
    profile && usage
      ? buildCloudRightSizing({ profile, size, observation: usage, dailyCost })
      : null;
  const shown: CloudResourceSpendCardsShown = decideCloudResourceSpendCards({
    cost,
    sizing,
    usage,
  });

  if (!shown.cost && !shown.sizing) {
    return <></>;
  }

  return (
    <CardGrid columns={2} dataTestId="cloud-resource-spend-cards">
      {shown.cost ? (
        <CloudResourceCostCardView
          cost={shown.cost}
          recommendations={shown.costRows}
        />
      ) : null}
      {shown.sizing ? (
        <CloudResourceRightSizingCard sizing={shown.sizing} />
      ) : null}
    </CardGrid>
  );
};

export default CloudResourceSpendCards;
