import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import { EnterprisePluginComponent } from "../../Enterprise/EnterprisePlugins";

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();

  /*
   * The entries of the Enterprise settings pages (EnterpriseSettingsPage),
   * read in render, never at module load. They draw themselves, and draw
   * nothing for a page the license does not allow.
   */
  const EnterpriseSettingsItems: EnterprisePluginComponent | undefined =
    getAdminDashboardPlugins().SettingsSideMenuItems;

  return (
    <SideMenu>
      <SideMenuSection title={t("sideMenu.basic")}>
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsAuthentication"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />
        {EnterpriseSettingsItems ? <EnterpriseSettingsItems /> : <></>}
      </SideMenuSection>

      {/*
       * Every page here is set up once and revisited rarely, so only Basic
       * starts open, and the sections below fold down to their titles: an
       * index of what can be configured, each opening with one click and by
       * itself on its own pages. The shared SideMenuSection folds a section
       * by its English title (see SideMenuSectionState.ts); these titles are
       * already translated, so each one says it here.
       */}
      <SideMenuSection
        title={t("sideMenu.settingsAuthentication")}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: "Global SSO",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_GLOBAL_SSO] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />
        <SideMenuItem
          link={{
            title: "Global OIDC",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />
      </SideMenuSection>

      <SideMenuSection
        title={t("sideMenu.settingsNotifications")}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsEmails"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SMTP] as Route,
            ),
          }}
          icon={IconProp.Email}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsCallSms"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_CALL_AND_SMS] as Route,
            ),
          }}
          icon={IconProp.Call}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsWhatsapp"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_WHATSAPP] as Route,
            ),
          }}
          icon={IconProp.WhatsApp}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsTelegram"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TELEGRAM] as Route,
            ),
          }}
          icon={IconProp.Telegram}
        />
      </SideMenuSection>

      <SideMenuSection
        title={t("sideMenu.settingsMonitoring")}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsGlobalProbes"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_PROBES] as Route,
            ),
          }}
          icon={IconProp.Signal}
        />
      </SideMenuSection>
      <SideMenuSection
        title={t("sideMenu.settingsDataRetention")}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsDataRetention"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_DATA_RETENTION] as Route,
            ),
          }}
          icon={IconProp.Database}
        />
      </SideMenuSection>
      <SideMenuSection title={t("sideMenu.settingsAi")} defaultCollapsed={true}>
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsGlobalAiAgents"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route,
            ),
          }}
          icon={IconProp.Automation}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsGlobalLlmProviders"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route,
            ),
          }}
          icon={IconProp.Brain}
        />
      </SideMenuSection>
      <SideMenuSection
        title={t("sideMenu.settingsApiIntegrations")}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsApiKey"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_API_KEY] as Route,
            ),
          }}
          icon={IconProp.Code}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
