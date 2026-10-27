import AdminModelAPI from "../../../Utils/ModelAPI";
import {
  PROJECT_CREATION_SWITCH_TEST_ID,
  SIGN_UP_SSO_REQUIRED_TEST_ID,
  SIGN_UP_SWITCH_TEST_ID,
} from "./AuthenticationSwitchesCopy";
import { SIGN_UP_WHILE_SSO_REQUIRED } from "../SSO/SsoSettingsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Page from "Common/UI/Components/Page/Page";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Authentication: two instance-wide switches, each saving the
 * moment it is flipped (the shared ModelSwitchCard, through AdminModelAPI).
 * Each used to be a card whose Edit dialog held the one switch.
 *
 *   - Sign Up: "Let people sign up", on while GlobalConfig.disableSignup is
 *     false. People invited to a project can create their account either
 *     way (the /signup route lets them in), so it locks nobody out. While
 *     the server requires SSO nobody signs up, whatever it says
 *     (SsoRequiredSignIn), and a line under it says so.
 *   - Project Creation: "Let users create projects", on while
 *     GlobalConfig.disableUserProjectCreation is false. Master admins can
 *     always create projects.
 *
 * Require SSO for Login, which was the card between them, is on Settings >
 * Single Sign-On now, under the providers it depends on (../SSO).
 *
 * GlobalConfig is one row, with the zero id.
 */

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

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
        // Whether the server requires SSO, read with the switch.
        select={{ requireSsoForLogin: true }}
        getDetails={(item: GlobalConfig): ReactNode => {
          if (!item.requireSsoForLogin) {
            return null;
          }

          return (
            <p
              className="text-sm text-gray-600"
              data-testid={SIGN_UP_SSO_REQUIRED_TEST_ID}
            >
              {translator.translateText(SIGN_UP_WHILE_SSO_REQUIRED)}
            </p>
          );
        }}
        dataTestId={SIGN_UP_SWITCH_TEST_ID}
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
