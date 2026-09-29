import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import { Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

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
            getElement: (item: Probe): ReactElement => {
              if (
                item &&
                item["lastAlive"] &&
                OneUptimeDate.getNumberOfMinutesBetweenDates(
                  OneUptimeDate.fromString(item["lastAlive"]),
                  OneUptimeDate.getCurrentDate(),
                ) < 5
              ) {
                return (
                  <Statusbubble
                    text="Connected"
                    color={Green}
                    shouldAnimate={true}
                  />
                );
              }

              return (
                <Statusbubble
                  text="Disconnected"
                  color={Red}
                  shouldAnimate={false}
                />
              );
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
              return <span>{item["probeVersion"]?.toString() || "-"}</span>;
            },
          },
        ]}
        userPreferencesKey="admin-health-probes-table"
      />
    </HealthPage>
  );
};

export default HealthProbes;
