import React, { ReactElement } from "react";

//components
import Navbar from "../Navbar/NavBar";
import Header from "../Header/Header";
import Footer from "../Footer/Footer";

export interface ComponentProps {
  children: ReactElement;
}

const Page = (props: ComponentProps) => {

  return (
    <React.Fragment>
      <div id="layout-wrapper">
        <Header />
        <Navbar />
        <div className="main-content">{props.children}</div>
        <Footer />
      </div>
    </React.Fragment>
  );
};

export default Page;
