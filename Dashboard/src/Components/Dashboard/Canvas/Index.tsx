import React, { FunctionComponent, ReactElement } from "react";
import BlankCanvasElement from "./BlankCanvas";

export interface ComponentProps {
  
}

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {

  return (
    <BlankCanvasElement onDrop={ ()=>{} } />
  );
};

export default DashboardCanvas;
