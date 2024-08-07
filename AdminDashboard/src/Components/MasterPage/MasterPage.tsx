import Footer from "../Footer/Footer";
import Header from "../Header/Header";
import NavBar from "../NavBar/NavBar";
import MasterPage from "Common/UI/src/Components/MasterPage/MasterPage";
import TopAlert from "Common/UI/src/Components/TopAlert/TopAlert";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <TopAlert
        title="OneUptime Admin Dashboard"
        description="You can perform your OneUptime server related tasks on this dashboard."
      />
      <MasterPage
        footer={<Footer />}
        header={<Header />}
        navBar={<NavBar />}
        isLoading={false}
        error={""}
        className="flex flex-col h-screen justify-between"
      >
        {props.children}
      </MasterPage>
    </div>
  );
};

export default DashboardMasterPage;
