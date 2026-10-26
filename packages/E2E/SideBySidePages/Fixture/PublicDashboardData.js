/*
 * What the fixture's public dashboard API answers for one dashboard
 * (Pages.js), in the shapes the real API answers: its metadata, and a board
 * of one text widget that says which dashboard it is.
 */
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import DashboardTextComponentUtil from "Common/Utils/Dashboard/Components/DashboardTextComponent";
import JSONFunctions from "Common/Types/JSONFunctions";

export const metadataAnswer = (dashboard, isUnlocked) => {
  const isPromptOnly = dashboard.hasPassword && !isUnlocked;

  return {
    _id: dashboard.id,
    name: dashboard.title,
    isPublicDashboard: true,
    enableMasterPassword: Boolean(dashboard.hasPassword),
    pageTitle: dashboard.title,
    faviconFile: null,
    description: isPromptOnly ? "" : dashboard.text,
    pageDescription: isPromptOnly ? "" : dashboard.text,
    logoFile: null,
    theme: "Light",
  };
};

export const viewConfigAnswer = (dashboard) => {
  const component = DashboardTextComponentUtil.getDefaultComponent();

  component.arguments = {
    ...component.arguments,
    text: `## ${dashboard.title}\n\n${dashboard.text}`,
    isMarkdown: true,
  };
  component.widthInDashboardUnits = 6;
  component.heightInDashboardUnits = 3;

  const config = DashboardViewConfigUtil.addComponentToDashboard({
    component,
    dashboardViewConfig:
      DashboardViewConfigUtil.createDefaultDashboardViewConfig(),
  });

  return {
    _id: dashboard.id,
    name: dashboard.title,
    description: dashboard.text,
    pageTitle: dashboard.title,
    pageDescription: dashboard.text,
    logoFile: null,
    dashboardViewConfig: JSONFunctions.serialize(config),
  };
};
