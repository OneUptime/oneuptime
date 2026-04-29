import Help from "./Help";
import Logo from "./Logo";
import UserProfile from "./UserProfile";
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
            <EditionLabel className="mr-3 hidden md:inline-flex" />
            <Button
              title={t("header.exitAdmin")}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                Navigation.navigate(DASHBOARD_URL);
              }}
            />
            <Help />
            <UserProfile />
          </>
        }
      />
    </>
  );
};

export default DashboardHeader;
