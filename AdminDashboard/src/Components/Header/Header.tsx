import Help from "./Help";
import Logo from "./Logo";
import UserProfile from "./UserProfile";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Header from "Common/UI/Components/Header/Header";
import { DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardHeader: FunctionComponent = (): ReactElement => {
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
            <Button
              title="Exit Admin"
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
