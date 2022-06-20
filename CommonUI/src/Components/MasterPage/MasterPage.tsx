import React, { ReactElement } from "react";

export interface ComponentProps {
  header?: ReactElement, 
  footer?: ReactElement, 
  navBar?: ReactElement
  children: ReactElement | Array<ReactElement>;
}

const Page = (props: ComponentProps) => {

  return (
    <React.Fragment>
      <div id="layout-wrapper">
        {props.header && props.header}
        {props.navBar && props.navBar}
        <div className="main-content">{props.children}</div>
        {props.footer && props.footer}
      </div>
    </React.Fragment>
  );
};

export default Page;
