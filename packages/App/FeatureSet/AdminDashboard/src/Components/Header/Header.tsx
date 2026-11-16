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

/*
 * Which dashboard this is, beside the logo, in the trail's own words: the
 * Admin Dashboard and the Dashboard look alike, and every Admin page used to
 * open on a banner saying so (#9041). From 640px up only: below that the
 * logo, help and the profile button fill the header, and the trail every
 * Admin page starts with ("Admin Dashboard > Users") says it. A label, not
 * a control; no bare `hidden`, so a foreign `.hidden` rule cannot hide it.
 */
export const ADMIN_DASHBOARD_LABEL_TEST_ID: string = "admin-dashboard-label";
export const ADMIN_DASHBOARD_LABEL_CLASS_NAME: string =
  "ml-3 max-sm:hidden sm:inline-flex items-center whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700";

const DashboardHeader: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <>
      <Header
        leftComponents={
          <>
            <Logo onClick={() => {}} />
            <span
              data-testid={ADMIN_DASHBOARD_LABEL_TEST_ID}
              className={ADMIN_DASHBOARD_LABEL_CLASS_NAME}
            >
              {t("breadcrumbs.adminDashboard")}
            </span>
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
                isTitleTranslated={true}
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
