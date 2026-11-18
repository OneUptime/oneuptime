import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import GlobalProbeStatusElement from "../../Components/Probe/GlobalProbeStatus";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const HealthProbes: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Global Probes"
      currentRoute={RouteMap[PageMap.HEALTH_PROBES] as Route}
    >
      {/* Global probes — read straight from the Probe model, no new backend needed. */}
      <ModelTable<Probe>
        modelType={Probe}
        modelAPI={AdminModelAPI}
        id="admin-health-probes-table"
        name="Health > Probes"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        query={{
          projectId: new IsNull(),
          isGlobalProbe: true,
        }}
        cardProps={{
          title: "Global probes",
          description:
            "Probes that run monitoring checks for this instance, and whether they are currently reporting in.",
        }}
        noItemsMessage="No global probes have been configured."
        showRefreshButton={true}
        selectMoreFields={{
          lastAlive: true,
          // Whether it is behind (GlobalProbeStatus).
          checksLateSince: true,
          checksLastLateAt: true,
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            // A mark beside the name: the name reads its own way, the cell the page's.
            getLineText: drawsItsOwnLines,
            getElement: (item: Probe): ReactElement => {
              return <ProbeElement probe={item} />;
            },
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Text,
            // Connected, Behind - its monitors checked late (#9488) - or Disconnected.
            getElement: (item: Probe): ReactElement => {
              return <GlobalProbeStatusElement probe={item} />;
            },
          },
          {
            field: {
              probeVersion: true,
            },
            title: "Version",
            type: FieldType.Text,
            hideOnMobile: true,
            getElement: (item: Probe): ReactElement => {
              return (
                <span>
                  {item["probeVersion"]?.toString() || <TableEmptyValue />}
                </span>
              );
            },
          },
        ]}
        userPreferencesKey="admin-health-probes-table"
      />
    </HealthPage>
  );
};

export default HealthProbes;
