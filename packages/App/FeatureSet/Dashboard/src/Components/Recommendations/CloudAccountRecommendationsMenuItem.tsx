import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import CloudAccountRecommendationPlan from "./CloudAccountRecommendationPlan";
import {
  CloudAccountRecommendationCoverage,
  CloudAccountRecommendationResources,
  loadCloudAccountRecommendationCoverage,
  loadCloudAccountRecommendationResources,
} from "./CloudAccountRecommendationData";
import { useRecommendationsChangedCount } from "./RecommendationsChanged";

export interface ComponentProps {
  link: Link;
  // The CloudAccount row whose resources are counted.
  accountId: ObjectID;
  icon?: IconProp | undefined;
}

/*
 * A cloud account's Recommendations entry, with a count of the monitors
 * still to set up on its resources - worked out exactly as the tab behind
 * it works it out (CloudAccountRecommendationData, then
 * CloudAccountRecommendationPlan), so the two never disagree, and able to
 * reach zero: created and dismissed recommendations are not counted, so a
 * cleared count reads as no badge at all.
 *
 * Every failure is swallowed and the entry renders with no badge, as
 * RecommendationsSideMenuItem's does: the page behind it works either way.
 */
const CloudAccountRecommendationsMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [count, setCount] = useState<number | undefined>(undefined);
  // Counted again when the page beside it sets some up.
  const changes: number = useRecommendationsChangedCount();

  useAsyncEffect(async () => {
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      const account: CloudAccount | null = await ModelAPI.getItem<CloudAccount>(
        {
          modelType: CloudAccount,
          id: props.accountId,
          select: { provider: true, accountId: true },
        },
      );

      if (!account?.provider || !account.accountId) {
        return;
      }

      const [read, coverage]: [
        CloudAccountRecommendationResources,
        CloudAccountRecommendationCoverage,
      ] = await Promise.all([
        loadCloudAccountRecommendationResources({
          projectId: projectId,
          provider: account.provider as string,
          cloudAccountId: account.accountId as string,
        }),
        loadCloudAccountRecommendationCoverage(),
      ]);

      setCount(
        CloudAccountRecommendationPlan.getCounts(
          CloudAccountRecommendationPlan.buildGroups({
            resources: read.resources,
            existingMonitors: coverage.existingMonitors,
            dismissals: coverage.dismissals,
          }),
        ).available,
      );
    } catch {
      // Badge simply won't show a count. The page behind it still works.
    }
  }, [props.accountId.toString(), changes]);

  return (
    <SideMenuItem
      link={props.link}
      icon={props.icon || IconProp.Sparkles}
      // Zero is no badge: a cleared count should look cleared.
      badge={count ? count : undefined}
      badgeType={BadgeType.WARNING}
    />
  );
};

export default CloudAccountRecommendationsMenuItem;
