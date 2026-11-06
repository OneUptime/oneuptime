import React, { FunctionComponent, ReactElement } from "react";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { useRecommendationsToSetUpCount } from "./RecommendationsCount";

export interface ComponentProps {
  link: Link;
  resourceType: MonitorRecommendationResourceType;
  resourceId: ObjectID;
  icon?: IconProp | undefined;
}

/*
 * The Recommendations side-menu entry, with a count of what still needs doing.
 *
 * It cannot use `CountModelSideMenuItem` — that counts rows in one table, and
 * this number is not stored anywhere. It is the catalog (a constant) minus the
 * monitors that already cover a recommendation (a fingerprint diff) minus what
 * the team dismissed (a table): RecommendationsCount works it out, as an App
 * Platforms app's Recommendations tab counts it too. The whole point of the
 * badge is that it can reach zero: a badge showing the catalog size would read
 * the same forever and would be ignored within a week.
 *
 * Every failure path is swallowed and renders the item with no badge.
 * A side-menu entry that disappears, or a red error where a number should be,
 * is a much worse outcome than a missing count — the page behind it works
 * either way.
 */
const RecommendationsSideMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const count: number | undefined = useRecommendationsToSetUpCount({
    resourceType: props.resourceType,
    resourceId: props.resourceId,
  });

  return (
    <SideMenuItem
      link={props.link}
      icon={props.icon || IconProp.Sparkles}
      /*
       * Zero is rendered as no badge rather than as "0". A cleared count
       * should look cleared.
       */
      badge={count ? count : undefined}
      badgeType={BadgeType.WARNING}
    />
  );
};

export default RecommendationsSideMenuItem;
