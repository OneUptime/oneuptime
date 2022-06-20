import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  left?: ReactElement | Array<ReactElement> | null
  right?: ReactElement | Array<ReactElement> | null
}

const Footer: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  return (
    <React.Fragment>
      <footer className="footer">
        <div className="container-fluid">
          <div className="row">
            {props.left && <div className="col-md-6">{props.left}</div>}
            {props.right && <div className="col-md-6">
              {props.right}
            </div>}
          </div>
        </div>
      </footer>
    </React.Fragment>
  );
};

export default Footer;
