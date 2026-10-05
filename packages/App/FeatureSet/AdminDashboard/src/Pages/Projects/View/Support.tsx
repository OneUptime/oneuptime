import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import { BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useTranslation } from "react-i18next";

/*
 * A project's Support page: whether OneUptime customer support can open
 * the project, as one switch that saves the moment it is flipped (the
 * shared ModelSwitchCard, through AdminModelAPI). It is the same column,
 * Project.letCustomerSupportAccessProject, as the switch the customer has
 * in their own Project Settings.
 *
 * The customer owns the switch. Staff turn it on here only when the
 * customer has asked support to look at their project, so turning it on
 * asks first, with that consent warning - which used to be a warning banner
 * above the card on every visit. Turning it off saves at once.
 */

export const PROJECT_SUPPORT_ACCESS_SWITCH_TEST_ID: string =
  "admin-project-support-access-switch";

const ProjectSupport: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const modelIdString: string = Navigation.getLastParamAsString(1);

  /*
   * The switch card reads its record again whenever the id it is handed
   * changes, and ModelPage refetches on the id's identity. A fresh ObjectID
   * per render would refetch on every render, so the id is memoized on the
   * route param it came from. Same reasoning as the subscription page next
   * door.
   */
  const modelId: ObjectID = useMemo(() => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  const breadcrumbLinks: Array<{ title: string; to: Route }> = [
    {
      title: t("breadcrumbs.adminDashboard"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: t("breadcrumbs.projects"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      title: t("breadcrumbs.project"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_VIEW] as Route,
        { modelId: modelId },
      ),
    },
    {
      title: t("breadcrumbs.projectSupport"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_SUPPORT] as Route,
        { modelId: modelId },
      ),
    },
  ];

  /*
   * Customer support is a hosted-edition function: on a self-hosted install
   * the operator already has full access to their own instance, so there is
   * nobody to grant access to. The side menu hides the link on that edition,
   * and this early return covers the URL being reached directly.
   */
  if (!BILLING_ENABLED) {
    return (
      <ModelPage<Project>
        modelId={modelId}
        modelNameField="name"
        modelType={Project}
        modelAPI={AdminModelAPI}
        title={t("pages.projectSupport.title")}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<SideMenuComponent modelId={modelId} />}
      >
        <Alert
          type={AlertType.INFO}
          title={t("pages.projectSupport.billingDisabled")}
        />
      </ModelPage>
    );
  }

  return (
    <ModelPage<Project>
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectSupport.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <ModelSwitchCard<Project>
        modelType={Project}
        modelId={modelId}
        column="letCustomerSupportAccessProject"
        modelAPI={AdminModelAPI}
        cardTitle={t("pages.projectSupport.cardTitle")}
        cardDescription={t("pages.projectSupport.cardDescription")}
        title={t("pages.projectSupport.fieldLabel")}
        note={t("pages.projectSupport.fieldDescription")}
        getConfirmation={(
          isTurningOn: boolean,
        ): ModelSwitchConfirmation | undefined => {
          if (!isTurningOn) {
            return undefined;
          }

          return {
            title: t("pages.projectSupport.allowConfirmTitle"),
            description: t("pages.projectSupport.consentWarning"),
            submitButtonText: t("pages.projectSupport.allowConfirmButton"),
          };
        }}
        dataTestId={PROJECT_SUPPORT_ACCESS_SWITCH_TEST_ID}
      />
    </ModelPage>
  );
};

export default ProjectSupport;
