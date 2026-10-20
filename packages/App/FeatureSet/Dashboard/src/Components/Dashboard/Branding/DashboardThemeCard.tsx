import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardTheme from "Common/Types/Dashboard/DashboardTheme";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PublicPageThemeCard from "../../PublicPageTheme/PublicPageThemeCard";
import DashboardThemeCopy, {
  DASHBOARD_THEME_CARD_TEST_ID,
  DASHBOARD_THEME_CHOICES,
} from "./DashboardThemeCopy";
import DashboardThemePreview from "./DashboardThemePreview";

/*
 * Theme, on a dashboard's Branding page: how its public link looks to
 * visitors - Light, Dark, or as each visitor's device is set - one choice
 * of three (DashboardThemeCopy), each beside a small picture of a dashboard
 * in it (DashboardThemePreview).
 *
 * It is every public page's Theme card (PublicPageThemeCard, which a status
 * page's shares): a pick saves at once and says "Saved", a refused one goes
 * back with the reason, and someone who may not edit the dashboard sees the
 * choices locked. Only the theme is read and sent.
 */

export interface ComponentProps {
  dashboardId: ObjectID;
}

const DashboardThemeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <PublicPageThemeCard<Dashboard>
      modelType={Dashboard}
      modelId={props.dashboardId}
      select={{ theme: true }}
      copy={DashboardThemeCopy}
      choices={DASHBOARD_THEME_CHOICES}
      renderPreview={(
        theme: DashboardTheme,
        isSelected: boolean,
      ): ReactElement => {
        return <DashboardThemePreview theme={theme} isSelected={isSelected} />;
      }}
      testId={DASHBOARD_THEME_CARD_TEST_ID}
    />
  );
};

export default DashboardThemeCard;
