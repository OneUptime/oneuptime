import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement } from "react";
import { useTranslation } from "react-i18next";

const Upgrade: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();

  return (
    <Button
      title={t("upgrade.upgradePlan")}
      onClick={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_BILLING] as Route,
          ),
        );
      }}
      buttonStyle={ButtonStyleType.LINK}
      icon={IconProp.Star}
    />
  );
};

export default Upgrade;
