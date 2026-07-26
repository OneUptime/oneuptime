import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageComponentProps from "../../PageComponentProps";
import {
  getSloTableColumns,
  getSloViewRoute,
  SLO_TABLE_SELECT_MORE_FIELDS,
} from "../../Slo/Slos";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * The SLOs that measure this monitor.
 *
 * An SRE looking at a monitor that has been flapping needs to know which
 * reliability targets that flapping is spending — and, conversely, before
 * pausing or reconfiguring a monitor, which objectives depend on it. The
 * relationship was previously only navigable from the SLO side.
 *
 * The columns come from the SLOs list so the two surfaces cannot drift
 * apart in what they call at-risk.
 */
const MonitorSlos: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <ModelTable<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        id="monitor-slos-table"
        userPreferencesKey="monitor-slos-table"
        name="Monitor > SLOs"
        isDeleteable={false}
        isEditable={false}
        /*
         * Creating an SLO needs a target, a window and a multi-monitor
         * mode that have nothing to do with this monitor — that belongs on
         * the SLOs page, which this table's empty state points at.
         */
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          monitors: new Includes([modelId]),
        }}
        cardProps={{
          title: "Service Level Objectives",
          description:
            "Reliability targets that measure this monitor. Downtime on this monitor spends their error budgets.",
        }}
        noItemsMessage="No SLO measures this monitor. Create one on the SLOs page to track a reliability target for it."
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              sloStatus: true,
            },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SloStatus),
          },
        ]}
        documentationLink={new Route("/docs/slo/introduction")}
        columns={getSloTableColumns()}
        selectMoreFields={SLO_TABLE_SELECT_MORE_FIELDS}
        onViewPage={(item: ServiceLevelObjective): Promise<Route> => {
          return Promise.resolve(getSloViewRoute(item));
        }}
      />
    </Fragment>
  );
};

export default MonitorSlos;
