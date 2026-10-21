import AdminModelAPI from "../../../Utils/ModelAPI";
import {
  PROJECT_CREATION_SWITCH_TEST_ID,
  REQUIRE_SSO_COPY,
  REQUIRE_SSO_SWITCH_TEST_ID,
  SIGN_UP_SWITCH_TEST_ID,
} from "./AuthenticationSwitchesCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import Page from "Common/UI/Components/Page/Page";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Authentication: three instance-wide switches, each saving the
 * moment it is flipped (the shared ModelSwitchCard, through AdminModelAPI).
 * Each used to be a card whose Edit dialog held the one switch.
 *
 *   - Sign Up: "Let people sign up", on while GlobalConfig.disableSignup is
 *     false. People invited to a project can create their account either
 *     way (the /signup route lets them in), so it locks nobody out.
 *   - Single Sign-On (SSO): "Require SSO for Login". Turning it on asks
 *     first, with a red button: everyone but master admins is refused every
 *     project until they sign in with SSO. Master admins are exempt, so it
 *     can always be turned off again; turning it off saves at once.
 *   - Project Creation: "Let users create projects", on while
 *     GlobalConfig.disableUserProjectCreation is false. Master admins can
 *     always create projects.
 *
 * The SSO card's strings are looked up by their English text, as the
 * shared components look theirs up (AuthenticationSwitchesCopy). The other
 * cards' come from this page's locale keys.
 *
 * GlobalConfig is one row, with the zero id.
 */

export const getRequireSsoConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: REQUIRE_SSO_COPY.confirmTitle,
    description: REQUIRE_SSO_COPY.confirmDescription,
    submitButtonText: REQUIRE_SSO_COPY.confirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const globalConfigId: ObjectID = ObjectID.getZeroObjectID();

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.authentication"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <ModelSwitchCard<GlobalConfig>
        modelType={GlobalConfig}
        modelId={globalConfigId}
        column="disableSignup"
        isInverted={true}
        modelAPI={AdminModelAPI}
        cardTitle={t("pages.settings.authentication.signUpCardTitle")}
        cardDescription={t(
          "pages.settings.authentication.signUpCardDescription",
        )}
        title={t("pages.settings.authentication.signUpSwitchTitle")}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? t("pages.settings.authentication.signUpSwitchOnDescription")
            : t("pages.settings.authentication.signUpSwitchOffDescription");
        }}
        dataTestId={SIGN_UP_SWITCH_TEST_ID}
      />

      <ModelSwitchCard<GlobalConfig>
        modelType={GlobalConfig}
        modelId={globalConfigId}
        column="requireSsoForLogin"
        modelAPI={AdminModelAPI}
        cardTitle={REQUIRE_SSO_COPY.cardTitle}
        cardDescription={REQUIRE_SSO_COPY.cardDescription}
        title={REQUIRE_SSO_COPY.switchTitle}
        note={REQUIRE_SSO_COPY.note}
        getConfirmation={getRequireSsoConfirmation}
        dataTestId={REQUIRE_SSO_SWITCH_TEST_ID}
      />

      <ModelSwitchCard<GlobalConfig>
        modelType={GlobalConfig}
        modelId={globalConfigId}
        column="disableUserProjectCreation"
        isInverted={true}
        modelAPI={AdminModelAPI}
        cardTitle={t("pages.settings.authentication.projectCreationCardTitle")}
        cardDescription={t(
          "pages.settings.authentication.projectCreationCardDescription",
        )}
        title={t("pages.settings.authentication.projectCreationSwitchTitle")}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? t(
                "pages.settings.authentication.projectCreationSwitchOnDescription",
              )
            : t(
                "pages.settings.authentication.projectCreationSwitchOffDescription",
              );
        }}
        dataTestId={PROJECT_CREATION_SWITCH_TEST_ID}
      />
    </Page>
  );
};

export default Settings;
