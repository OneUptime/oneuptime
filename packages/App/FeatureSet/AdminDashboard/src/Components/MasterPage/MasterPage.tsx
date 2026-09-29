import Footer from "../Footer/Footer";
import Header from "../Header/Header";
import NavBar from "../NavBar/NavBar";
import MasterPage from "Common/UI/Components/MasterPage/MasterPage";
import TopAlert from "Common/UI/Components/TopAlert/TopAlert";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

const DashboardMasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  return (
    <div>
      <TopAlert
        title={t("topAlert.title")}
        description={t("topAlert.description")}
      />
      <MasterPage
        footer={<Footer />}
        header={<Header />}
        navBar={<NavBar />}
        isLoading={false}
        error={""}
        /*
         * min-h-screen, not h-screen — see the dashboard master page: a fixed
         * 100vh caps the sticky top section's containing block at one viewport
         * and the header scrolls away on longer pages.
         */
        className="flex flex-col min-h-screen"
      >
        {props.children}
      </MasterPage>
    </div>
  );
};

export default DashboardMasterPage;
