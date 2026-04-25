import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import IconDropdownItem from "Common/UI/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu from "Common/UI/Components/Header/IconDropdown/IconDropdownMenu";
import { DASHBOARD_URL } from "Common/UI/Config";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

const DashboardUserProfile: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

  return (
    <>
      <HeaderIconDropdownButton
        iconImageUrl={BlankProfilePic}
        name={t("header.userProfile")}
        showDropdown={isDropdownVisible}
        onClick={() => {
          setIsDropdownVisible(true);
        }}
      >
        <IconDropdownMenu>
          {User.isMasterAdmin() ? (
            <IconDropdownItem
              title={t("userProfile.exitAdmin")}
              onClick={() => {
                setIsDropdownVisible(false);
                Navigation.navigate(DASHBOARD_URL);
              }}
              icon={IconProp.ExternalLink}
            />
          ) : (
            <></>
          )}

          <IconDropdownItem
            title={t("userProfile.logOut")}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
            url={RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGOUT] as Route,
            )}
            icon={IconProp.Logout}
          />
        </IconDropdownMenu>
      </HeaderIconDropdownButton>
    </>
  );
};

export default DashboardUserProfile;
