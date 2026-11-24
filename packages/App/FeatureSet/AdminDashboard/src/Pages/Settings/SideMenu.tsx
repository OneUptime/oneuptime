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
   * nothing for a page the license does not allow. A page that sets up a way
   * OneUptime reaches people belongs under Notifications, not Basic.
   */
  const EnterpriseSettingsItems: EnterprisePluginComponent | undefined =
    getAdminDashboardPlugins().SettingsSideMenuItems;
  const EnterpriseNotificationSettingsItems:
    | EnterprisePluginComponent
    | undefined = getAdminDashboardPlugins().SettingsNotificationSideMenuItems;

  return (
    <SideMenu>
      <SideMenuSection title={t("sideMenu.basic")} isTitleTranslated={true}>
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsAuthentication"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />
        {/*
         * Single sign-on, on one page: the SAML and OpenID Connect
         * providers and Require SSO to Sign In. They were "Global SSO" and
         * "Global OIDC" in a folded section also called Authentication, and
         * the switch was on the Authentication page.
         */}
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsSso"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SSO] as Route,
            ),
          }}
          icon={IconProp.ShieldCheck}
        />
        {/*
         * The products every project on this server offers (#6815): a
         * preset in one click, or a switch per product.
         */}
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsProducts"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_PRODUCTS] as Route,
            ),
          }}
          icon={IconProp.Squares}
        />
        {/*
         * Where the server sends its people for help (#10864-#10866): Help's
         * support address, chat and demo, the footer's link, Give feedback,
         * the mobile app prompts and the sign-in screen's message.
         */}
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsHelpAndSupport"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_HELP_AND_SUPPORT] as Route,
            ),
          }}
          icon={IconProp.Lifebuoy}
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
        title={t("sideMenu.settingsNotifications")}
        isTitleTranslated={true}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsEmails"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SMTP] as Route,
            ),
          }}
          icon={IconProp.Email}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsCallSms"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_CALL_AND_SMS] as Route,
            ),
          }}
          icon={IconProp.Call}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsWhatsapp"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_WHATSAPP] as Route,
            ),
          }}
          icon={IconProp.WhatsApp}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsTelegram"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TELEGRAM] as Route,
            ),
          }}
          icon={IconProp.Telegram}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsPushNotifications"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_PUSH_NOTIFICATIONS] as Route,
            ),
          }}
          icon={IconProp.Notification}
        />
        {EnterpriseNotificationSettingsItems ? (
          <EnterpriseNotificationSettingsItems />
        ) : (
          <></>
        )}
      </SideMenuSection>

      {/*
       * What the server lends every project: the probes that check its
       * monitors, the runners that run its runbooks and code fixes, and the
       * LLM providers its AI falls back to. Each was a section of its own
       * with one page ("Monitoring", "Runbooks", "AI"), and the menu was
       * mostly headings (#9134).
       */}
      <SideMenuSection
        title={t("sideMenu.settingsSharedWithProjects")}
        isTitleTranslated={true}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsGlobalProbes"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_PROBES] as Route,
            ),
          }}
          icon={IconProp.Signal}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsGlobalRunners"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_GLOBAL_RUNNERS] as Route,
            ),
          }}
          icon={IconProp.Terminal}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsGlobalLlmProviders"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route,
            ),
          }}
          icon={IconProp.Brain}
        />
      </SideMenuSection>

      {/*
       * The server's own limits and key: how long resolved incidents and
       * alerts are kept, the daily budget and rate every project gets for
       * each telemetry signal, and the master API key. "Data Retention" was
       * a section holding only Data Retention, and "Telemetry" and "API and
       * Integrations" held one page each (#9134).
       */}
      <SideMenuSection
        title={t("sideMenu.settingsServer")}
        isTitleTranslated={true}
        defaultCollapsed={true}
      >
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsDataRetention"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_DATA_RETENTION] as Route,
            ),
          }}
          icon={IconProp.Database}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsIngestionBudgets"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INGESTION_BUDGETS] as Route,
            ),
          }}
          icon={IconProp.Gauge}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settingsApiKey"),
            isTitleTranslated: true,
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
