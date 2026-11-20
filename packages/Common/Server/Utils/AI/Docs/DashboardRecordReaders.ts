import Alert from "../../../../Models/DatabaseModels/Alert";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import Form from "../../../../Models/DatabaseModels/Form";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncomingCallPolicy from "../../../../Models/DatabaseModels/IncomingCallPolicy";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import Team from "../../../../Models/DatabaseModels/Team";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import { AskAiRecordKind } from "../../../../Types/AI/AskAiRecordPages";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import {
  formatRecordNumber,
  getNumberedRecordName,
} from "../../../../Utils/Project/RecordNumber";
import AlertService from "../../../Services/AlertService";
import DashboardService from "../../../Services/DashboardService";
import FormService from "../../../Services/FormService";
import IncidentService from "../../../Services/IncidentService";
import IncomingCallPolicyService from "../../../Services/IncomingCallPolicyService";
import MonitorService from "../../../Services/MonitorService";
import OnCallDutyPolicyScheduleService from "../../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import RunbookService from "../../../Services/RunbookService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveService from "../../../Services/ServiceLevelObjectiveService";
import ServiceService from "../../../Services/ServiceService";
import StatusPageService from "../../../Services/StatusPageService";
import TeamService from "../../../Services/TeamService";
import WorkflowService from "../../../Services/WorkflowService";

/*
 * WHETHER THE PERSON MAY OPEN A RECORD, AND WHAT THEY CALL IT (#7065).
 *
 * find_dashboard_page offers a button to one record's own page - this
 * status page's Custom Domains - only after reading that record with the
 * props of whoever asked (ToolContext.props): their own in Ask AI, so the
 * permission layer applies their role, their teams' blocks, their labels
 * and the project they are in, exactly as the record's own page would.
 * A record they may not read, one of another project, one that does not
 * exist and a read that fails all answer null, so nothing - not even
 * whether it exists - is said of a record they could not open.
 *
 * What it answers is the record's name as the person's own page heads it:
 * a status page or a monitor by its name, an incident, an alert or a
 * maintenance event by its number, then its title ("INC-42 Checkout
 * down"), the way Ask AI's page context names it. "" for a record they
 * may read that has none.
 */

export type DashboardRecordReader = (data: {
  id: ObjectID;
  props: DatabaseCommonInteractionProps;
}) => Promise<string | null>;

// A name as read, or "" for none.
const nameOf: (name: string | undefined | null) => string = (
  name: string | undefined | null,
): string => {
  return (name || "").trim();
};

export const DASHBOARD_RECORD_READERS: Readonly<
  Record<AskAiRecordKind, DashboardRecordReader>
> = {
  [AskAiRecordKind.StatusPage]: async (data): Promise<string | null> => {
    const record: StatusPage | null = await StatusPageService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Monitor]: async (data): Promise<string | null> => {
    const record: Monitor | null = await MonitorService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Incident]: async (data): Promise<string | null> => {
    const record: Incident | null = await IncidentService.findOneById({
      id: data.id,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
      props: data.props,
    });
    return record
      ? getNumberedRecordName({
          number: formatRecordNumber({
            number: record.incidentNumber,
            numberWithPrefix: record.incidentNumberWithPrefix,
          }),
          name: record.title,
        })
      : null;
  },
  [AskAiRecordKind.Alert]: async (data): Promise<string | null> => {
    const record: Alert | null = await AlertService.findOneById({
      id: data.id,
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      props: data.props,
    });
    return record
      ? getNumberedRecordName({
          number: formatRecordNumber({
            number: record.alertNumber,
            numberWithPrefix: record.alertNumberWithPrefix,
          }),
          name: record.title,
        })
      : null;
  },
  [AskAiRecordKind.OnCallPolicy]: async (data): Promise<string | null> => {
    const record: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: data.id,
        select: { _id: true, name: true },
        props: data.props,
      });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.OnCallSchedule]: async (data): Promise<string | null> => {
    const record: OnCallDutyPolicySchedule | null =
      await OnCallDutyPolicyScheduleService.findOneById({
        id: data.id,
        select: { _id: true, name: true },
        props: data.props,
      });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.IncomingCallPolicy]: async (
    data,
  ): Promise<string | null> => {
    const record: IncomingCallPolicy | null =
      await IncomingCallPolicyService.findOneById({
        id: data.id,
        select: { _id: true, name: true },
        props: data.props,
      });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.MaintenanceEvent]: async (data): Promise<string | null> => {
    const record: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: data.id,
        select: {
          _id: true,
          title: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        },
        props: data.props,
      });
    return record
      ? getNumberedRecordName({
          number: formatRecordNumber({
            number: record.scheduledMaintenanceNumber,
            numberWithPrefix: record.scheduledMaintenanceNumberWithPrefix,
          }),
          name: record.title,
        })
      : null;
  },
  [AskAiRecordKind.Service]: async (data): Promise<string | null> => {
    const record: Service | null = await ServiceService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Team]: async (data): Promise<string | null> => {
    const record: Team | null = await TeamService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Workflow]: async (data): Promise<string | null> => {
    const record: Workflow | null = await WorkflowService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Dashboard]: async (data): Promise<string | null> => {
    const record: Dashboard | null = await DashboardService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Runbook]: async (data): Promise<string | null> => {
    const record: Runbook | null = await RunbookService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Slo]: async (data): Promise<string | null> => {
    const record: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneById({
        id: data.id,
        select: { _id: true, name: true },
        props: data.props,
      });
    return record ? nameOf(record.name) : null;
  },
  [AskAiRecordKind.Form]: async (data): Promise<string | null> => {
    const record: Form | null = await FormService.findOneById({
      id: data.id,
      select: { _id: true, name: true },
      props: data.props,
    });
    return record ? nameOf(record.name) : null;
  },
};

/*
 * The record's name, read for the person - or null when they may not open
 * it, it is not there, or the read failed. Never throws, never reads as
 * OneUptime: a person who asked is always who it reads for.
 */
export const readDashboardRecordName: (data: {
  kind: AskAiRecordKind;
  id: ObjectID;
  props: DatabaseCommonInteractionProps;
}) => Promise<string | null> = async (data: {
  kind: AskAiRecordKind;
  id: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<string | null> => {
  // Only for someone: a read with no person behind it opens no page.
  if (data.props.isRoot || !data.props.userId || !data.props.tenantId) {
    return null;
  }

  try {
    return await DASHBOARD_RECORD_READERS[data.kind]({
      id: data.id,
      props: data.props,
    });
  } catch {
    return null;
  }
};
