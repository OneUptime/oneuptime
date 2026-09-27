import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import DatabaseService from "../../../../Services/DatabaseService";
import IncidentService from "../../../../Services/IncidentService";
import IncidentSeverityService from "../../../../Services/IncidentSeverityService";
import LabelService from "../../../../Services/LabelService";
import MonitorService from "../../../../Services/MonitorService";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../../Services/ScheduledMaintenanceService";
import ModelPermission from "../../../../Types/Database/Permissions/Index";
import Query from "../../../../Types/Database/Query";
import Select from "../../../../Types/Database/Select";
import Sort from "../../../../Types/Database/Sort";
import WorkspaceActionAuthorization, {
  WorkspaceActionResource,
} from "../../WorkspaceActionAuthorization";
import { isValidatedProvenance } from "../DiscordDraftFlow";
import {
  DiscordActionModuleRegistration,
  DiscordActionRequest,
  DiscordActionResult,
  DiscordChoicePage,
  DiscordChoiceQuery,
  DiscordChoiceProviderRegistration,
  DiscordDraftField,
  DiscordDraftSubmissionRequest,
  DiscordDraftSubmissionResult,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
} from "./Types";

type Family = "incident" | "maintenance";
interface References {
  severity: Array<ObjectID>;
  monitors: Array<ObjectID>;
  labels: Array<ObjectID>;
  policies: Array<ObjectID>;
  monitorStatus: Array<ObjectID>;
}
const choiceServices: Readonly<
  Record<string, DatabaseService<DatabaseBaseModel>>
> = {
  severity: IncidentSeverityService,
  monitors: MonitorService,
  labels: LabelService,
  policies: OnCallDutyPolicyService,
  monitorStatus: MonitorStatusService,
};

function fields(family: Family): ReadonlyArray<DiscordDraftField> {
  const result: Array<DiscordDraftField> = [
    {
      kind: "text",
      customId: "title",
      label: "Title",
      required: true,
      minLength: 1,
      maxLength: 200,
      style: "short",
    },
    {
      kind: "text",
      customId: "description",
      label: "Description",
      required: true,
      minLength: 1,
      maxLength: 4000,
      style: "paragraph",
    },
  ];
  if (family === "maintenance") {
    for (const [customId, label] of [
      ["startsAt", "Starts at (ISO 8601 with timezone)"],
      ["endsAt", "Ends at (ISO 8601 with timezone)"],
    ]) {
      result.push({
        kind: "text",
        customId: customId!,
        label: label!,
        required: true,
        maxLength: 35,
        placeholder: "2099-01-01T10:00:00+02:00",
      });
    }
  }
  for (const [customId, label] of [
    ["severity", "Incident severity"],
    ["monitors", "Monitors"],
    ["labels", "Labels"],
    ["policies", "On-call policies"],
    ["monitorStatus", "Update monitor status immediately"],
  ]) {
    if (
      family === "maintenance" &&
      (customId === "severity" || customId === "policies")
    ) {
      continue;
    }
    result.push({
      kind: "choice",
      customId: customId!,
      label: label!,
      provider: `create-${family}-${customId}`,
      required: customId === "severity",
      multiple: ["monitors", "labels", "policies"].includes(customId!),
    });
  }
  return result;
}

function text(value: string | undefined, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new BadDataException(`${label} must contain 1–${limit} characters.`);
  }
  return value;
}

function references(
  request: DiscordDraftSubmissionRequest,
  family: Family,
): References {
  const allowed: Array<string> =
    family === "incident"
      ? ["severity", "monitors", "labels", "policies", "monitorStatus"]
      : ["monitors", "labels", "monitorStatus"];
  const selections: Readonly<Record<string, ReadonlyArray<string>>> =
    request.selections || {};
  if (
    Object.keys(selections).some((key: string): boolean => {
      return !allowed.includes(key);
    })
  ) {
    throw new BadDataException("Unknown creation selection.");
  }
  const result: References = {
    severity: [],
    monitors: [],
    labels: [],
    policies: [],
    monitorStatus: [],
  };
  for (const key of allowed) {
    const selected: ReadonlyArray<string> = selections[key] || [];
    const max: number = key === "severity" || key === "monitorStatus" ? 1 : 100;
    if (
      !Array.isArray(selected) ||
      selected.length > max ||
      new Set(selected).size !== selected.length ||
      selected.some((id: string): boolean => {
        return typeof id !== "string" || !ObjectID.isValidUUID(id);
      })
    ) {
      throw new BadDataException(`Choose up to ${max} distinct ${key}.`);
    }
    result[key as keyof References] = selected.map((id: string): ObjectID => {
      return new ObjectID(id);
    });
  }
  if (family === "incident" && !result.severity.length) {
    throw new BadDataException("Choose an incident severity.");
  }
  if (result.monitorStatus.length && !result.monitors.length) {
    throw new BadDataException(
      "Select monitors before choosing a monitor status.",
    );
  }
  return result;
}

function date(value: string | undefined): Date {
  // Date.parse normalizes impossible days, so validate calendar components first.
  const datePattern: RegExp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
  const match: RegExpExecArray | null =
    typeof value === "string" ? datePattern.exec(value) : null;
  if (!match) {
    throw new BadDataException(
      "Use an ISO 8601 date and time with an explicit timezone.",
    );
  }
  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const parsed: Date = new Date(value!);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6] || "0") > 59 ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.getTime() <= Date.now()
  ) {
    throw new BadDataException("Choose a valid future date and time.");
  }
  return parsed;
}

async function authorizeReferences(
  request: DiscordActionRequest,
  family: Family,
  refs: References,
): Promise<DatabaseCommonInteractionProps> {
  const resources: Array<WorkspaceActionResource> = [];
  for (const [key, ids] of Object.entries(refs)) {
    for (const id of ids) {
      resources.push({ service: choiceServices[key]!, id });
    }
  }
  const props: DatabaseCommonInteractionProps =
    await WorkspaceActionAuthorization.authorize({
      projectId: request.context.projectId,
      userId: request.context.userId,
      modelType: family === "incident" ? Incident : ScheduledMaintenance,
      action: `create ${family === "incident" ? "an incident" : "a maintenance event"}`,
      resources,
    });
  if (refs.policies.length) {
    await WorkspaceActionAuthorization.assertCanCreate({
      props,
      modelType: OnCallDutyPolicyExecutionLog,
      action: "request the selected on-call policies",
      resources: refs.policies.map((id: ObjectID): WorkspaceActionResource => {
        return { service: OnCallDutyPolicyService, id };
      }),
    });
  }
  /*
   * Every monitor permission is checked before resource creation. Updates still
   * use scoped props afterward so a concurrent scope change fails closed.
   */
  if (refs.monitorStatus[0]) {
    for (const id of refs.monitors) {
      const query: Query<Monitor> =
        await ModelPermission.checkUpdateQueryPermissions(
          Monitor,
          { _id: id.toString(), projectId: request.context.projectId },
          { currentMonitorStatusId: refs.monitorStatus[0] },
          props,
        );
      const monitor: Monitor | null = await MonitorService.findOneBy({
        query,
        select: { _id: true, labels: { _id: true } },
        props,
      });
      if (!monitor) {
        throw new NotAuthorizedException(
          "You do not have permission to update a selected monitor.",
        );
      }
      await ModelPermission.checkUpdatePermissionByModel({
        modelType: Monitor,
        fetchModelWithAccessControlIds: async (): Promise<Monitor> => {
          return monitor;
        },
        props,
      });
    }
  }
  return props;
}

async function create(
  request: DiscordDraftSubmissionRequest,
  family: Family,
): Promise<DiscordDraftSubmissionResult> {
  if (!isValidatedProvenance(request.provenance)) {
    throw new BadDataException(
      "Review and submit a current Discord creation draft.",
    );
  }
  const allowed: Array<string> =
    family === "incident"
      ? ["title", "description"]
      : ["title", "description", "startsAt", "endsAt"];
  if (
    Object.keys(request.values).some((key: string): boolean => {
      return !allowed.includes(key);
    })
  ) {
    throw new BadDataException("Unknown creation field.");
  }
  const title: string = text(request.values["title"], "Title", 200);
  const description: string = text(
    request.values["description"],
    "Description",
    4000,
  );
  const refs: References = references(request, family);
  const startsAt: Date | undefined =
    family === "maintenance" ? date(request.values["startsAt"]) : undefined;
  const endsAt: Date | undefined =
    family === "maintenance" ? date(request.values["endsAt"]) : undefined;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new BadDataException("Maintenance must end after it starts.");
  }
  const props: DatabaseCommonInteractionProps = await authorizeReferences(
    request,
    family,
    refs,
  );
  const monitors: Array<Monitor> = refs.monitors.map(
    (id: ObjectID): Monitor => {
      const row: Monitor = new Monitor();
      row.id = id;
      return row;
    },
  );
  const labels: Array<Label> = refs.labels.map((id: ObjectID): Label => {
    const row: Label = new Label();
    row.id = id;
    return row;
  });
  let created: Incident | ScheduledMaintenance;
  if (family === "incident") {
    const incident: Incident = new Incident();
    incident.title = title;
    incident.description = description;
    incident.projectId = request.context.projectId;
    incident.createdByUserId = request.context.userId;
    incident.incidentSeverityId = refs.severity[0]!;
    incident.monitors = monitors;
    incident.labels = labels;
    incident.rootCause = "Incident created via Discord";
    incident.onCallDutyPolicies = refs.policies.map(
      (id: ObjectID): OnCallDutyPolicy => {
        const row: OnCallDutyPolicy = new OnCallDutyPolicy();
        row.id = id;
        return row;
      },
    );
    created = await IncidentService.create({ data: incident, props });
  } else {
    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
    maintenance.title = title;
    maintenance.description = description;
    maintenance.projectId = request.context.projectId;
    maintenance.createdByUserId = request.context.userId;
    maintenance.startsAt = startsAt!;
    maintenance.endsAt = endsAt!;
    maintenance.monitors = monitors;
    maintenance.labels = labels;
    created = await ScheduledMaintenanceService.create({
      data: maintenance,
      props,
    });
  }
  if (!created.id) {
    return {
      outcome: { kind: "ambiguous" },
      response: {
        kind: "message",
        content:
          "Creation outcome is uncertain because the service returned no resource ID. Monitor status updates were not attempted. Inspect the dashboard and notification logs. Do not create another resource to retry.",
        ephemeral: true,
      },
    };
  }
  const label: string = family === "incident" ? "Incident" : "Maintenance";
  let location: string = created.id.toString();
  let linkUnavailable: boolean = false;
  try {
    const link: URL =
      family === "incident"
        ? await IncidentService.getIncidentLinkInDashboard(
            request.context.projectId,
            created.id,
          )
        : await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            request.context.projectId,
            created.id,
          );
    location = link.toString();
  } catch {
    linkUnavailable = true;
  }
  let content: string = `${label} created: ${location}`;
  if (refs.monitorStatus[0]) {
    try {
      for (const id of refs.monitors) {
        const count: number = await MonitorService.updateOneBy({
          query: { _id: id.toString(), projectId: request.context.projectId },
          data: { currentMonitorStatusId: refs.monitorStatus[0] },
          props,
        });
        if (!count) {
          throw new NotAuthorizedException(
            "A selected monitor is no longer available.",
          );
        }
      }
    } catch {
      content = `${label} created, but monitor status updates did not all finish: ${location}. Inspect this resource and its monitors; do not create another copy to retry.`;
    }
  }
  if (linkUnavailable) {
    content +=
      " The dashboard link is unavailable. Inspect this resource in the dashboard. Do not create another copy to retry.";
  }
  if (refs.policies.length) {
    content +=
      " On-call processing is not confirmed; inspect the incident's on-call execution log. Do not create another incident to retry paging.";
  }
  return {
    outcome: {
      kind: "created",
      resourceType: family === "incident" ? "Incident" : "ScheduledMaintenance",
      resourceId: created.id.toString(),
    },
    response: { kind: "message", content, ephemeral: true },
  };
}

async function choices(
  family: Family,
  key: string,
  query: DiscordChoiceQuery,
): Promise<DiscordChoicePage> {
  const skip: number = query.cursor ? Number(query.cursor) : 0;
  const cursorPattern: RegExp = /^\d+$/;
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 25 ||
    !Number.isSafeInteger(skip) ||
    skip < 0 ||
    (query.cursor && !cursorPattern.test(query.cursor)) ||
    (query.search?.length || 0) > 100
  ) {
    throw new BadDataException("Invalid Discord selection page.");
  }
  const props: DatabaseCommonInteractionProps =
    await WorkspaceActionAuthorization.authorize({
      projectId: query.context.projectId,
      userId: query.context.userId,
      modelType: family === "incident" ? Incident : ScheduledMaintenance,
      action: `create ${family === "incident" ? "an incident" : "a maintenance event"}`,
    });
  const search: string = query.search?.trim() || "";
  const rows: Array<DatabaseBaseModel> = await choiceServices[key]!.findBy({
    query: {
      projectId: query.context.projectId,
      ...(search ? { name: new Search(search) } : {}),
    } as Query<DatabaseBaseModel>,
    select: { _id: true, name: true } as Select<DatabaseBaseModel>,
    sort: {
      name: SortOrder.Ascending,
      _id: SortOrder.Ascending,
    } as Sort<DatabaseBaseModel>,
    skip,
    limit: query.limit + 1,
    props,
  });
  return {
    options: rows
      .slice(0, query.limit)
      .map((row: DatabaseBaseModel): { label: string; value: string } => {
        return {
          label: String(row.getColumnValue("name") || "Unnamed").slice(0, 100),
          value: row.id!.toString(),
        };
      }),
    ...(skip
      ? { previousCursor: String(Math.max(0, skip - query.limit)) }
      : {}),
    ...(rows.length > query.limit
      ? { nextCursor: String(skip + query.limit) }
      : {}),
  };
}

export function registerCreationDraft(
  family: Family,
): DiscordActionModuleRegistration {
  const name: string =
    family === "incident" ? "Incident" : "ScheduledMaintenance";
  const draftFields: ReadonlyArray<DiscordDraftField> = fields(family);
  return {
    handlers: [
      {
        actions: [`New${name}`],
        interactionKinds: [
          DiscordInteractionKind.ApplicationCommand,
          DiscordInteractionKind.MessageComponent,
        ],
        responseMode: DiscordHandlerResponseMode.Deferred,
        handle: async (
          request: DiscordActionRequest,
        ): Promise<DiscordActionResult> => {
          await WorkspaceActionAuthorization.authorize({
            projectId: request.context.projectId,
            userId: request.context.userId,
            modelType: family === "incident" ? Incident : ScheduledMaintenance,
            action: `create ${family === "incident" ? "an incident" : "a maintenance event"}`,
          });
          return {
            kind: "draft",
            draft: {
              name: `create-${family}`,
              title:
                family === "incident"
                  ? "Create incident"
                  : "Schedule maintenance",
              submitAction: `SubmitNew${name}`,
              fields: draftFields,
            },
          };
        },
      },
    ],
    draftSubmissions: [
      {
        name: `create-${family}`,
        action: `SubmitNew${name}`,
        handle: async (
          request: DiscordDraftSubmissionRequest,
        ): Promise<DiscordDraftSubmissionResult> => {
          return create(request, family);
        },
      },
    ],
    commands: [
      {
        name:
          family === "incident"
            ? "oneuptime-incident"
            : "oneuptime-maintenance",
        description:
          family === "incident"
            ? "Create a OneUptime incident"
            : "Schedule OneUptime maintenance",
        action: `New${name}`,
      },
    ],
    choiceProviders: draftFields
      .filter((field: DiscordDraftField): boolean => {
        return field.kind === "choice";
      })
      .map((field: DiscordDraftField): DiscordChoiceProviderRegistration => {
        return {
          name: `create-${family}-${field.customId}`,
          getPage: async (
            query: DiscordChoiceQuery,
          ): Promise<DiscordChoicePage> => {
            return choices(family, field.customId, query);
          },
        };
      }),
  };
}
