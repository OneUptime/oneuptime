import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import CloudAccountRecommendationPlan from "./CloudAccountRecommendationPlan";
import { CloudAccountRecommendationResources } from "./CloudAccountRecommendationData";
import { CloudAccountRecommendationCoverage } from "./CloudAccountRecommendationData";
import CloudEnvironmentAppRecommendationPlan from "./CloudEnvironmentAppRecommendationPlan";
import {
  loadCloudEnvironmentAppRecommendationCoverage,
  loadCloudEnvironmentAppRecommendationResources,
} from "./CloudEnvironmentAppRecommendationData";
import { useRecommendationsChangedCount } from "./RecommendationsChanged";

export interface ComponentProps {
  link: Link;
  // The environment whose apps are counted.
  environmentId: ObjectID;
  icon?: IconProp | undefined;
}

/*
 * An App Platforms environment's Recommendations entry, with a count of
 * the monitors still to set up on its apps - worked out exactly as the page
 * behind it works it out (CloudEnvironmentAppRecommendationData, then
 * CloudEnvironmentAppRecommendationPlan), so the two never disagree, and
 * able to reach zero: created and dismissed recommendations are not
 * counted, so a cleared count reads as no badge at all.
 *
 * Every failure is swallowed and the entry renders with no badge, as a
 * cloud account's does (CloudAccountRecommendationsMenuItem): the page
 * behind it works either way.
 */
const CloudEnvironmentRecommendationsMenuItem: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [count, setCount] = useState<number | undefined>(undefined);
  // Counted again when the page beside it sets some up.
  const changes: number = useRecommendationsChangedCount();

  useAsyncEffect(async () => {
    try {
      const [read, coverage]: [
        CloudAccountRecommendationResources,
        CloudAccountRecommendationCoverage,
      ] = await Promise.all([
        loadCloudEnvironmentAppRecommendationResources({
          environmentId: props.environmentId,
          translator: translator,
        }),
        loadCloudEnvironmentAppRecommendationCoverage(),
      ]);

      setCount(
        CloudAccountRecommendationPlan.getCounts(
          CloudEnvironmentAppRecommendationPlan.buildGroups({
            environmentId: props.environmentId.toString(),
            // Not drawn: only the counts are read.
            groupLabel: "",
            resources: read.resources,
            existingMonitors: coverage.existingMonitors,
            dismissals: coverage.dismissals,
          }),
        ).available,
      );
    } catch {
      // Badge simply won't show a count. The page behind it still works.
    }
  }, [props.environmentId.toString(), changes]);

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

export default CloudEnvironmentRecommendationsMenuItem;
