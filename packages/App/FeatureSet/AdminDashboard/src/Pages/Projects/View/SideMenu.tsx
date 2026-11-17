import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BILLING_ENABLED } from "Common/UI/Config";

export interface SideMenuProps {
  modelId: ObjectID;
}

const SideMenuComponent: FunctionComponent<SideMenuProps> = (
  props: SideMenuProps,
): ReactElement => {
  const { t } = useTranslation();
  return (
    <SideMenu>
      <SideMenuSection title={t("sideMenu.basic")} isTitleTranslated={true}>
        <SideMenuItem
          link={{
            title: t("sideMenu.overview"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_VIEW] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Info}
        />
        {/*
         * What the project sends, on every install: its members see the same
         * under Project Settings > Telemetry & APM > Usage.
         */}
        <SideMenuItem
          link={{
            title: t("sideMenu.telemetryUsage"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_TELEMETRY_USAGE] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        {/*
         * The budgets the instance admin holds the project to, beside what it
         * sends: its members see them, read only, on their Usage page.
         */}
        <SideMenuItem
          link={{
            title: t("sideMenu.ingestionBudgets"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_INGESTION_BUDGETS] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Gauge}
        />
      </SideMenuSection>

      <SideMenuSection title={t("sideMenu.members")} isTitleTranslated={true}>
        <SideMenuItem
          link={{
            title: t("sideMenu.users"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_USERS] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.User}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.teams"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_TEAMS] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      {/*
       * Subscriptions only exist on the hosted (billing enabled) edition.
       *
       * Billing and Support start collapsed, folded down to their titles:
       * the project's members are what this menu is opened for, and these
       * are looked at now and then. Each opens with one click, and by itself
       * on its own page.
       */}
      {BILLING_ENABLED ? (
        <SideMenuSection
          title={t("sideMenu.billing")}
          isTitleTranslated={true}
          defaultCollapsed={true}
        >
          <SideMenuItem
            link={{
              title: t("sideMenu.subscription"),
              isTitleTranslated: true,
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_SUBSCRIPTION] as Route,
                {
                  modelId: props.modelId,
                },
              ),
            }}
            icon={IconProp.CreditCard}
          />
          {/*
           * The invoices the payment provider raised for the project, which
           * staff may void when they waive a charge.
           */}
          <SideMenuItem
            link={{
              title: t("sideMenu.invoices"),
              isTitleTranslated: true,
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_INVOICES] as Route,
                {
                  modelId: props.modelId,
                },
              ),
            }}
            icon={IconProp.Invoice}
          />
        </SideMenuSection>
      ) : (
        <></>
      )}

      {/*
       * Advanced starts collapsed, as it does in every menu. The shared
       * SideMenuSection does that by itself only for the English title, and
       * this one is already translated, so it is said here.
       */}
      <SideMenuSection
        title={t("sideMenu.advanced")}
        isTitleTranslated={true}
        defaultCollapsed={true}
      >
        {/*
         * Whether OneUptime's support team may sign in to this project. It
         * had a Support section of its own, for this one entry (#9216).
         * There is no OneUptime customer support team to grant access to on
         * a self-hosted install, so it is hosted-only for the same reason
         * the subscription section above is.
         */}
        {BILLING_ENABLED ? (
          <SideMenuItem
            link={{
              title: t("sideMenu.customerSupportAccess"),
              isTitleTranslated: true,
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_SUPPORT] as Route,
                {
                  modelId: props.modelId,
                },
              ),
            }}
            icon={IconProp.Help}
          />
        ) : (
          <></>
        )}
        <SideMenuItem
          link={{
            title: t("sideMenu.deleteProject"),
            isTitleTranslated: true,
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_DELETE] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Trash}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default SideMenuComponent;
