import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import IncidentSlaStatus from "Common/Types/Incident/IncidentSlaStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow, Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";

const IncidentViewSla: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const getStatusColor = (status: IncidentSlaStatus | undefined): Color => {
    switch (status) {
      case IncidentSlaStatus.OnTrack:
        return Green;
      case IncidentSlaStatus.AtRisk:
        return Yellow;
      case IncidentSlaStatus.ResponseBreached:
      case IncidentSlaStatus.ResolutionBreached:
        return Red;
      case IncidentSlaStatus.Met:
        return Green;
      default:
        return Gray500;
    }
  };

  const formatTimeRemaining = (deadline: Date | undefined): string => {
    if (!deadline) {
      return "N/A";
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const diffMinutes: number = OneUptimeDate.getDifferenceInMinutes(
      deadline,
      now,
    );

    if (diffMinutes < 0) {
      const overdue: number = Math.abs(diffMinutes);
      if (overdue < 60) {
        return `Overdue by ${Math.round(overdue)} min`;
      }
      const hours: number = Math.floor(overdue / 60);
      if (hours < 24) {
        return `Overdue by ${hours}h ${Math.round(overdue % 60)}m`;
      }
      const days: number = Math.floor(hours / 24);
      return `Overdue by ${days}d ${hours % 24}h`;
    }

    if (diffMinutes < 60) {
      return `${Math.round(diffMinutes)} min remaining`;
    }

    const hours: number = Math.floor(diffMinutes / 60);
    if (hours < 24) {
      return `${hours}h ${Math.round(diffMinutes % 60)}m remaining`;
    }

    const days: number = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h remaining`;
  };

  return (
    <Fragment>
      <ModelTable<IncidentSla>
        modelType={IncidentSla}
        id="table-incident-sla"
        name="Incident > SLA"
        userPreferencesKey="incident-sla-table"
        isEditable={false}
        isDeleteable={false}
        isCreateable={false}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incidentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "SLA Tracking",
          description:
            "View SLA status and deadlines for this incident. SLA rules are automatically applied when incidents are created.",
        }}
        noItemsMessage={"No SLA rules matched this incident."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[]}
        columns={[
          {
            field: {
              incidentSlaRule: {
                name: true,
              },
            },
            title: "SLA Rule",
            type: FieldType.Text,
            getElement: (item: IncidentSla): ReactElement => {
              const ruleName: string =
                (item.incidentSlaRule as { name?: string })?.name || "Unknown Rule";
              return <span>{ruleName}</span>;
            },
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Text,
            getElement: (item: IncidentSla): ReactElement => {
              const status: IncidentSlaStatus | undefined = item.status;
              return (
                <Pill
                  color={getStatusColor(status)}
                  text={status || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              responseDeadline: true,
            },
            title: "Response Deadline",
            type: FieldType.DateTime,
            getElement: (item: IncidentSla): ReactElement => {
              if (!item.responseDeadline) {
                return <span className="text-gray-400">Not configured</span>;
              }

              const isResponded: boolean = !!item.respondedAt;
              const deadline: Date = item.responseDeadline;
              const formattedDeadline: string =
                OneUptimeDate.getDateAsLocalFormattedString(deadline);

              if (isResponded) {
                const respondedAt: Date = item.respondedAt as Date;
                const wasOnTime: boolean = OneUptimeDate.isBefore(
                  respondedAt,
                  deadline,
                );
                return (
                  <div>
                    <span
                      className={
                        wasOnTime ? "text-green-600" : "text-red-600"
                      }
                    >
                      {wasOnTime ? "Met" : "Missed"}
                    </span>
                    <div className="text-xs text-gray-500">
                      Deadline: {formattedDeadline}
                    </div>
                    <div className="text-xs text-gray-500">
                      Responded:{" "}
                      {OneUptimeDate.getDateAsLocalFormattedString(respondedAt)}
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <div>{formattedDeadline}</div>
                  <div className="text-xs text-gray-500">
                    {formatTimeRemaining(deadline)}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              resolutionDeadline: true,
            },
            title: "Resolution Deadline",
            type: FieldType.DateTime,
            getElement: (item: IncidentSla): ReactElement => {
              if (!item.resolutionDeadline) {
                return <span className="text-gray-400">Not configured</span>;
              }

              const isResolved: boolean = !!item.resolvedAt;
              const deadline: Date = item.resolutionDeadline;
              const formattedDeadline: string =
                OneUptimeDate.getDateAsLocalFormattedString(deadline);

              if (isResolved) {
                const resolvedAt: Date = item.resolvedAt as Date;
                const wasOnTime: boolean = OneUptimeDate.isBefore(
                  resolvedAt,
                  deadline,
                );
                return (
                  <div>
                    <span
                      className={
                        wasOnTime ? "text-green-600" : "text-red-600"
                      }
                    >
                      {wasOnTime ? "Met" : "Missed"}
                    </span>
                    <div className="text-xs text-gray-500">
                      Deadline: {formattedDeadline}
                    </div>
                    <div className="text-xs text-gray-500">
                      Resolved:{" "}
                      {OneUptimeDate.getDateAsLocalFormattedString(resolvedAt)}
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <div>{formattedDeadline}</div>
                  <div className="text-xs text-gray-500">
                    {formatTimeRemaining(deadline)}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              slaStartedAt: true,
            },
            title: "SLA Started",
            type: FieldType.DateTime,
          },
          {
            field: {
              respondedAt: true,
            },
            title: "Responded At",
            type: FieldType.DateTime,
            noValueMessage: "Not responded",
          },
          {
            field: {
              resolvedAt: true,
            },
            title: "Resolved At",
            type: FieldType.DateTime,
            noValueMessage: "Not resolved",
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentViewSla;
