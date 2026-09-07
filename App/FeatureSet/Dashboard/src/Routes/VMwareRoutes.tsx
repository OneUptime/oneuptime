import React, { FunctionComponent, ReactElement } from "react";
import { Route, Routes } from "react-router-dom";
import ComponentProps from "../Pages/PageComponentProps";
import VMwareLayout from "../Pages/VMware/Layout";
import VMwareSources from "../Pages/VMware/Sources";
import VMwareSourceView from "../Pages/VMware/Source";
import VMwareResourceView from "../Pages/VMware/Resource";
import VMwareMonitors from "../Pages/VMware/Monitors";
import VMwareSetup from "../Components/VMware/Setup";

const VMwareRoutes: FunctionComponent<ComponentProps> = (): ReactElement => {
  return (
    <Routes>
      <Route path="/" element={<VMwareLayout />}>
        <Route index element={<VMwareSources />} />
        <Route path="documentation" element={<VMwareSetup />} />
        <Route path="monitors" element={<VMwareMonitors />} />
        <Route path=":modelId" element={<VMwareSourceView />} />
        <Route
          path=":modelId/resources/:subModelId"
          element={<VMwareResourceView />}
        />
      </Route>
    </Routes>
  );
};
export default VMwareRoutes;
