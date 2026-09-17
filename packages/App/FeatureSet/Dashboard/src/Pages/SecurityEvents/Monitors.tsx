import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorTable from "../../Components/Monitor/MonitorTable";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";

/*
 * The Security Events view of the monitor product: every monitor of type
 * Security Events, listed where the person thinking about security data
 * actually is. The rows are ordinary monitors — same table component, same
 * routes into the monitor views — only the scope is different.
 *
 * Create is a deep link into the normal monitor create page with the type
 * preselected, NOT an inline form: the create page is where the
 * pay-as-you-go consent and the criteria builder live, and this must not
 * become a second door around either. The link is permission-gated the
 * same way MonitorTable gates its own create button, so a viewer is not
 * shown a wizard they cannot submit.
 */
const SecurityEventsMonitorsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same gate as the other Security Events tabs: without telemetry there
   * are no security events for these monitors to count.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  const createMonitorButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: "Create Security Events Monitor",
        onClick: () => {
          Navigation.navigate(
            (
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_CREATE] as Route,
              ) as Route
            ).addQueryParams({
              /*
               * The enum value contains a space, which Route's character
               * validator rejects raw. URLSearchParams decodes it back on
               * the create page, so the enum check there sees the real
               * value.
               */
              monitorType: encodeURIComponent(MonitorType.SecurityEvents),
            }),
          );
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
      new Monitor(),
      ModelAction.Create,
    );

  return (
    <MonitorTable
      /*
       * Scoping caveat: the table's Type facet chip has no mergeQueryValue,
       * so a user picking another type in the filter UI replaces this base
       * monitorType and widens the list. Soft scope, deliberate — the chip
       * is visible, so what happened is at least on screen.
       */
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        monitorType: MonitorType.SecurityEvents,
      }}
      title="Security Events Monitors"
      description="Monitors that count matching security events over a sliding window — including Detection Finding events written by your detection rules — and drive status, alerts, incidents and on-call."
      noItemsMessage="No Security Events monitors yet. Create one to alert on the rate of security events — or of your detections themselves."
      disableCreate={true}
      cardButtons={createMonitorButton ? [createMonitorButton] : []}
      saveFilterProps={{
        tableId: "security-events-monitors-table",
      }}
    />
  );
};

export default SecurityEventsMonitorsPage;
