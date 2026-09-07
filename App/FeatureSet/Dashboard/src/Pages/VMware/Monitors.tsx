import React, { FunctionComponent, ReactElement } from "react";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import MonitorType from "Common/Types/Monitor/MonitorType";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorTable from "../../Components/Monitor/MonitorTable";
import Navigation from "Common/UI/Utils/Navigation";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { monitorRoute } from "./Utils";

const VMwareMonitors: FunctionComponent = (): ReactElement => (
  <MonitorTable
    query={{ monitorType: MonitorType.VMware }}
    title="VMware monitors"
    description="Alert on collection failures, expected VM availability, ESXi host health, and datastore capacity."
    disableCreate={true}
    cardButtons={[
      PermissionGate.gateCardButton(
        {
          title: "Create VMware monitor",
          icon: IconProp.Add,
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: () => {
            Navigation.navigate(monitorRoute());
          },
        },
        new Monitor(),
        ModelAction.Create,
      ),
    ].filter(
      (button: CardButtonSchema | null): button is CardButtonSchema =>
        button !== null,
    )}
  />
);
export default VMwareMonitors;
