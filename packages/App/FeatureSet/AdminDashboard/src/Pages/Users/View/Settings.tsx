import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import SideMenuComponent from "./SideMenu";
import User from "Common/Models/DatabaseModels/User";
import ModelPage from "Common/UI/Components/Page/ModelPage";

/*
 * A user's Settings: whether they are a master admin, as one switch that
 * saves the moment it is flipped (the shared ModelSwitchCard, through
 * AdminModelAPI). It used to be a card whose Update Access dialog held the
 * one switch.
 *
 * It asks both ways, because both ways change who can run this server:
 *   - making someone a master admin gives them full access to the entire
 *     platform - every project, every user and this Admin Dashboard, where
 *     they can make others master admins too;
 *   - removing it takes this Admin Dashboard away from them. On your own
 *     account that locks you out of this page as you confirm, and only
 *     another master admin can give the access back, so that dialog says
 *     so and its button is red.
 */

export const MASTER_ADMIN_SWITCH_TEST_ID: string = "admin-master-admin-switch";

// The page's locale lookup: a key of pages.userView in, its text out.
type Translate = (key: string) => string;

export const getMasterAdminConfirmation: (data: {
  isTurningOn: boolean;
  isOwnAccount: boolean;
  t: Translate;
}) => ModelSwitchConfirmation = (data: {
  isTurningOn: boolean;
  isOwnAccount: boolean;
  t: Translate;
}): ModelSwitchConfirmation => {
  const t: Translate = data.t;

  if (data.isTurningOn) {
    return {
      title: t("pages.userView.masterAdminGrantConfirmTitle"),
      description: t("pages.userView.masterAdminGrantConfirmDescription"),
      submitButtonText: t("pages.userView.masterAdminGrantConfirmButton"),
    };
  }

  if (data.isOwnAccount) {
    return {
      title: t("pages.userView.masterAdminRevokeOwnConfirmTitle"),
      description: t("pages.userView.masterAdminRevokeOwnConfirmDescription"),
      submitButtonText: t("pages.userView.masterAdminRevokeOwnConfirmButton"),
      submitButtonType: ButtonStyleType.DANGER,
    };
  }

  return {
    title: t("pages.userView.masterAdminRevokeConfirmTitle"),
    description: t("pages.userView.masterAdminRevokeConfirmDescription"),
    submitButtonText: t("pages.userView.masterAdminRevokeConfirmButton"),
  };
};

const UserSettings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // Whether this page is the signed-in master admin's own account.
  const isOwnAccount: boolean =
    UserUtil.getUserId().toString() === modelId.toString();

  return (
    <ModelPage<User>
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      modelAPI={AdminModelAPI}
      title={t("pages.userView.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: t("breadcrumbs.user"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_VIEW] as Route,
            {
              modelId: modelId,
            },
          ),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_SETTINGS] as Route,
            {
              modelId: modelId,
            },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <ModelSwitchCard<User>
        modelType={User}
        modelId={modelId}
        column="isMasterAdmin"
        modelAPI={AdminModelAPI}
        cardTitle={t("pages.userView.masterAdminCardTitle")}
        cardDescription={t("pages.userView.masterAdminCardDescription")}
        title={t("pages.userView.masterAdminSwitchTitle")}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? t("pages.userView.masterAdminSwitchOnDescription")
            : t("pages.userView.masterAdminSwitchOffDescription");
        }}
        getConfirmation={(isTurningOn: boolean): ModelSwitchConfirmation => {
          return getMasterAdminConfirmation({
            isTurningOn: isTurningOn,
            isOwnAccount: isOwnAccount,
            t: (key: string): string => {
              return t(key);
            },
          });
        }}
        dataTestId={MASTER_ADMIN_SWITCH_TEST_ID}
      />
    </ModelPage>
  );
};

export default UserSettings;
