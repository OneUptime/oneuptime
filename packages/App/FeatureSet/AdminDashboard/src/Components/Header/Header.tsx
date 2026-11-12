import Help from "./Help";
import Logo from "./Logo";
import UserProfile from "./UserProfile";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Header from "Common/UI/Components/Header/Header";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import { DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const DashboardHeader: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <>
      <Header
        leftComponents={
          <>
            <Logo onClick={() => {}} />
          </>
        }
        centerComponents={
          <>
            {/* <SearchBox
                            key={2}
                            selectedProject={props.selectedProject}
                            onChange={(_value: string) => { }}
                        />{' '} */}
          </>
        }
        rightComponents={
          <>
            {/*
             * "Exit Admin" is the one entry here wide enough to crowd out the
             * buttons beside it on a phone, and it is a duplicate: the profile
             * menu below offers a master admin the same action, and log out
             * with it. Help and the profile button stay at every width.
             */}
            {/*
             * The Enterprise plugin's license details, read here in render
             * (never at module load); the Community stub has none.
             *
             * Below lg the header holds the logo, the pill, help and the
             * profile button: a long state in a long language ("Enterprise
             * Edition (Marketplace-Berichte schlagen fehl) Abrechnung
             * prüfen") ran over the logo, so the pill is held to a width
             * there and wraps its action onto a second line.
             */}
            <EditionLabel
              className="mr-3 max-md:hidden md:inline-flex max-lg:max-w-[26rem]"
              licenseDetails={getAdminDashboardPlugins().LicenseDetails}
            />
            <div className="max-lg:hidden items-center lg:flex">
              <Button
                title={t("header.exitAdmin")}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  Navigation.navigate(DASHBOARD_URL);
                }}
              />
            </div>
            <Help />
            <UserProfile />
          </>
        }
      />
    </>
  );
};

export default DashboardHeader;
