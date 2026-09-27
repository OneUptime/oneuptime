import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import MonitorService from "../../../../Server/Services/MonitorService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import * as DiscordDraftFlow from "../../../../Server/Utils/Workspace/Discord/DiscordDraftFlow";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import { DiscordIncidentCreationModule } from "../../../../Server/Utils/Workspace/Discord/Actions/IncidentCreation";
import { DiscordMaintenanceCreationModule } from "../../../../Server/Utils/Workspace/Discord/Actions/ScheduledMaintenanceCreation";
import {
  DiscordActionContext,
  DiscordActionRegistration,
  DiscordActionModuleRegistration,
  DiscordChoicePage,
  DiscordChoiceProviderRegistration,
  DiscordDraftSubmissionRegistration,
  DiscordDraftSubmissionRequest,
  DiscordDraftSubmissionResult,
  DiscordDraftProvenance,
  DiscordActionResult,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import URL from "../../../../Types/API/URL";

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const severityId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();
const labelId: ObjectID = ObjectID.generate();
const policyId: ObjectID = ObjectID.generate();
const statusId: ObjectID = ObjectID.generate();
const createdId: ObjectID = ObjectID.generate();
const props: DatabaseCommonInteractionProps = {
  userId,
  tenantId: projectId,
  userTeamIds: [],
  userTenantAccessPermission: {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          isBlockPermission: false,
          labelIds: [],
        },
      ],
    },
  },
};
const context: DiscordActionContext = {
  projectId,
  userId,
  props: { isRoot: true },
  guildId: "123456789012345678",
  discordUserId: "123456789012345679",
};
const selections: Readonly<Record<string, ReadonlyArray<string>>> = {
  severity: [severityId.toString()],
  monitors: [monitorId.toString()],
  labels: [labelId.toString()],
  policies: [policyId.toString()],
  monitorStatus: [statusId.toString()],
};

const validatedProvenance: DiscordDraftProvenance = Object.freeze(
  {},
) as DiscordDraftProvenance;

async function submit(
  module: DiscordActionModuleRegistration,
  action: string,
  values: Record<string, string>,
  selected: Readonly<Record<string, ReadonlyArray<string>>>,
  provenance: DiscordDraftProvenance = validatedProvenance,
): Promise<DiscordDraftSubmissionResult> {
  const handler: DiscordDraftSubmissionRegistration | undefined =
    module.draftSubmissions?.find(
      (entry: DiscordDraftSubmissionRegistration): boolean => {
        return entry.action === action;
      },
    );
  expect(handler).toBeDefined();
  const request: DiscordDraftSubmissionRequest = {
    action,
    values,
    selections: selected,
    context,
    provenance,
  };
  return handler!.handle(request);
}

async function invoke(
  module: DiscordActionModuleRegistration,
  action: string,
  values: Record<string, string> = {
    title: "From Discord",
    description: "Details",
  },
  selected: Readonly<Record<string, ReadonlyArray<string>>> = selections,
): Promise<DiscordActionResult> {
  if (action.startsWith("Submit")) {
    return (await submit(module, action, values, selected)).response;
  }
  const handler: DiscordActionRegistration | undefined = module.handlers.find(
    (entry: DiscordActionRegistration): boolean => {
      return entry.actions.includes(action);
    },
  );
  expect(handler).toBeDefined();
  return handler!.handle({ action, values, selections: selected, context });
}

beforeEach((): void => {
  jest
    .spyOn(DiscordDraftFlow, "isValidatedProvenance")
    .mockImplementation((value: unknown): value is DiscordDraftProvenance => {
      return value === validatedProvenance;
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(props);
  const monitor: Monitor = new Monitor();
  monitor.id = monitorId;
  monitor.projectId = projectId;
  monitor.labels = [];
  jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(monitor);
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockResolvedValue(new IncidentSeverity());
  jest.spyOn(LabelService, "findOneBy").mockResolvedValue(new Label());
  jest
    .spyOn(OnCallDutyPolicyService, "findOneBy")
    .mockResolvedValue(new OnCallDutyPolicy());
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockResolvedValue(new MonitorStatus());
  const incident: Incident = new Incident();
  incident.id = createdId;
  incident.projectId = projectId;
  const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
  maintenance.id = createdId;
  maintenance.projectId = projectId;
  jest.spyOn(IncidentService, "create").mockResolvedValue(incident);
  jest
    .spyOn(ScheduledMaintenanceService, "create")
    .mockResolvedValue(maintenance);
  jest.spyOn(MonitorService, "updateOneBy").mockResolvedValue(1);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.test/${projectId}/incidents/${createdId}`,
      ),
    );
  jest
    .spyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    )
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.test/${projectId}/scheduled-maintenance/${createdId}`,
      ),
    );
});
test("creation submissions are not ordinary wire handlers and require provenance", async (): Promise<void> => {
  expect(
    DiscordMaintenanceCreationModule.handlers.some(
      (entry: DiscordActionRegistration): boolean => {
        return entry.actions.includes("SubmitNewScheduledMaintenance");
      },
    ),
  ).toBe(false);
  await expect(
    DiscordMaintenanceCreationModule.draftSubmissions![0]!.handle({
      action: "SubmitNewScheduledMaintenance",
      values: {
        title: "Window",
        description: "Work",
        startsAt: "2099-01-01T10:00:00Z",
        endsAt: "2099-01-01T11:00:00Z",
      },
      selections: {},
      context,
      provenance: undefined as unknown as DiscordDraftProvenance,
    }),
  ).rejects.toThrow();
  expect(ScheduledMaintenanceService.create).not.toHaveBeenCalled();
});
afterEach((): void => {
  jest.restoreAllMocks();
});

test("incident creation retains every selected relation and actor", async (): Promise<void> => {
  await invoke(DiscordIncidentCreationModule, "SubmitNewIncident");
  expect(IncidentService.create).toHaveBeenCalledWith({
    props,
    data: expect.objectContaining({
      title: "From Discord",
      description: "Details",
      projectId,
      createdByUserId: userId,
      incidentSeverityId: severityId,
      monitors: [expect.objectContaining({ _id: monitorId.toString() })],
      labels: [expect.objectContaining({ _id: labelId.toString() })],
      onCallDutyPolicies: [
        expect.objectContaining({ _id: policyId.toString() }),
      ],
    }),
  });
  expect(MonitorService.updateOneBy).toHaveBeenCalledWith({
    query: { _id: monitorId.toString(), projectId },
    data: { currentMonitorStatusId: statusId },
    props,
  });
});

test.each(["", "  ", "x".repeat(201)])(
  "invalid title cannot create",
  async (title: string): Promise<void> => {
    await expect(
      invoke(DiscordIncidentCreationModule, "SubmitNewIncident", {
        title,
        description: "Details",
      }),
    ).rejects.toThrow();
    expect(IncidentService.create).not.toHaveBeenCalled();
  },
);
test("missing severity cannot create", async (): Promise<void> => {
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident", undefined, {
      ...selections,
      severity: [],
    }),
  ).rejects.toThrow();
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test.each(["monitors", "labels", "policies"])(
  "duplicate %s is rejected",
  async (key: string): Promise<void> => {
    await expect(
      invoke(DiscordIncidentCreationModule, "SubmitNewIncident", undefined, {
        ...selections,
        [key]: [monitorId.toString(), monitorId.toString()],
      }),
    ).rejects.toThrow();
    expect(IncidentService.create).not.toHaveBeenCalled();
  },
);
test("foreign or hidden severity is rejected before create", async (): Promise<void> => {
  jest.mocked(IncidentSeverityService.findOneBy).mockResolvedValue(null);
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident"),
  ).rejects.toThrow(NotAuthorizedException);
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test("foreign or hidden monitor is rejected before create", async (): Promise<void> => {
  jest.mocked(MonitorService.findOneBy).mockResolvedValue(null);
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident"),
  ).rejects.toThrow(NotAuthorizedException);
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test("revoked membership cannot finish creation", async (): Promise<void> => {
  jest
    .mocked(WorkspaceActionAuthorization.getProjectMemberProps)
    .mockRejectedValue(new NotAuthorizedException("Removed"));
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident"),
  ).rejects.toThrow("Removed");
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test("post-create monitor failure identifies the partial outcome", async (): Promise<void> => {
  jest
    .mocked(MonitorService.updateOneBy)
    .mockRejectedValue(new Error("Storage offline"));
  const result: DiscordActionResult = await invoke(
    DiscordIncidentCreationModule,
    "SubmitNewIncident",
  );
  expect(result).toMatchObject({
    kind: "message",
    content: expect.stringContaining(createdId.toString()),
  });
  expect(result).toMatchObject({
    content: expect.stringContaining("created, but"),
  });
  expect(IncidentService.create).toHaveBeenCalledTimes(1);
});
test("monitor update permission is checked before creating the incident", async (): Promise<void> => {
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockRejectedValue(new NotAuthorizedException("Monitor update refused"));
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident"),
  ).rejects.toThrow("Monitor update refused");
  expect(IncidentService.create).not.toHaveBeenCalled();
  expect(MonitorService.updateOneBy).not.toHaveBeenCalled();
});
test("selected policies do not imply successful paging or execute twice", async (): Promise<void> => {
  const execute: jest.SpyInstance = jest
    .spyOn(OnCallDutyPolicyService, "executePolicy")
    .mockResolvedValue();
  const result: DiscordActionResult = await invoke(
    DiscordIncidentCreationModule,
    "SubmitNewIncident",
  );
  expect(result).toMatchObject({
    kind: "message",
    content: expect.stringContaining("On-call processing is not confirmed"),
  });
  expect(execute).not.toHaveBeenCalled();
});
test("failed create never changes a monitor", async (): Promise<void> => {
  jest
    .mocked(IncidentService.create)
    .mockRejectedValue(new Error("Storage offline"));
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident"),
  ).rejects.toThrow("Storage offline");
  expect(MonitorService.updateOneBy).not.toHaveBeenCalled();
});
test("dashboard link failure preserves the created outcome without retry", async (): Promise<void> => {
  jest
    .mocked(IncidentService.getIncidentLinkInDashboard)
    .mockRejectedValue(new Error("Link unavailable"));
  const result: DiscordActionResult = await invoke(
    DiscordIncidentCreationModule,
    "SubmitNewIncident",
  );
  expect(result).toMatchObject({
    kind: "message",
    content: expect.stringContaining(`Incident created: ${createdId}`),
  });
  expect(result).toMatchObject({
    content: expect.stringContaining("Do not create another"),
  });
  expect(IncidentService.create).toHaveBeenCalledTimes(1);
});
test("missing returned resource ID is a terminal uncertain outcome", async (): Promise<void> => {
  jest.mocked(IncidentService.create).mockResolvedValue(new Incident());
  const result: DiscordActionResult = await invoke(
    DiscordIncidentCreationModule,
    "SubmitNewIncident",
  );
  expect(result).toMatchObject({
    kind: "message",
    content: expect.stringContaining("Creation outcome is uncertain"),
  });
  expect(result).toMatchObject({
    content: expect.stringContaining("Do not create another"),
  });
  expect(MonitorService.updateOneBy).not.toHaveBeenCalled();
});
test("maintenance dates retain explicit timezone and actor", async (): Promise<void> => {
  await invoke(
    DiscordMaintenanceCreationModule,
    "SubmitNewScheduledMaintenance",
    {
      title: "Window",
      description: "Work",
      startsAt: "2099-01-01T10:00:00+02:00",
      endsAt: "2099-01-01T11:00:00+02:00",
    },
    { monitors: [], labels: [], monitorStatus: [] },
  );
  expect(ScheduledMaintenanceService.create).toHaveBeenCalledWith({
    props,
    data: expect.objectContaining({
      createdByUserId: userId,
      projectId,
      startsAt: new Date("2099-01-01T08:00:00Z"),
      endsAt: new Date("2099-01-01T09:00:00Z"),
    }),
  });
});
test.each([
  ["2099-01-01T10:00:00", "2099-01-01T11:00:00Z"],
  ["2099-02-30T10:00:00Z", "2099-03-01T11:00:00Z"],
  ["2099-01-01T10:00:00Z", "2099-01-01T10:00:00Z"],
  ["2000-01-01T10:00:00Z", "2000-01-01T11:00:00Z"],
])(
  "invalid maintenance window is rejected",
  async (startsAt: string, endsAt: string): Promise<void> => {
    await expect(
      invoke(
        DiscordMaintenanceCreationModule,
        "SubmitNewScheduledMaintenance",
        { title: "Window", description: "Work", startsAt, endsAt },
        {},
      ),
    ).rejects.toThrow();
    expect(ScheduledMaintenanceService.create).not.toHaveBeenCalled();
  },
);
test("unknown selection keys cannot reach creation", async (): Promise<void> => {
  await expect(
    invoke(DiscordIncidentCreationModule, "SubmitNewIncident", undefined, {
      ...selections,
      tenant: [projectId.toString()],
    }),
  ).rejects.toThrow();
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test("scalar IDs cannot bypass native selections", async (): Promise<void> => {
  await expect(
    invoke(
      DiscordIncidentCreationModule,
      "SubmitNewIncident",
      {
        title: "Title",
        description: "Details",
        severity: severityId.toString(),
      },
      {},
    ),
  ).rejects.toThrow();
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test("opening creation uses a draft rather than mutating", async (): Promise<void> => {
  const result: DiscordActionResult = await invoke(
    DiscordIncidentCreationModule,
    "NewIncident",
    {},
    {},
  );
  expect(result).toMatchObject({
    kind: "draft",
    draft: {
      submitAction: "SubmitNewIncident",
      fields: expect.arrayContaining([
        expect.objectContaining({
          customId: "monitors",
          kind: "choice",
          multiple: true,
        }),
        expect.objectContaining({ customId: "severity", required: true }),
      ]),
    },
  });
  expect(IncidentService.create).not.toHaveBeenCalled();
});
test("creation choices preserve every page and actor scope", async (): Promise<void> => {
  const rows: Array<Monitor> = Array.from(
    { length: 26 },
    (_: unknown, index: number): Monitor => {
      const row: Monitor = new Monitor();
      row.id = ObjectID.generate();
      row.name = `Monitor ${index}`;
      return row;
    },
  );
  jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(rows.slice(25));
  const provider: DiscordChoiceProviderRegistration =
    DiscordIncidentCreationModule.choiceProviders!.find(
      (item: DiscordChoiceProviderRegistration): boolean => {
        return item.name === "create-incident-monitors";
      },
    )!;
  const first: DiscordChoicePage = await provider.getPage({
    provider: provider.name,
    context,
    limit: 25,
  });
  expect(first.options).toHaveLength(25);
  expect(first.nextCursor).toBe("25");
  const second: DiscordChoicePage = await provider.getPage({
    provider: provider.name,
    context,
    limit: 25,
    cursor: first.nextCursor,
  });
  expect(second.options).toHaveLength(1);
  expect(MonitorService.findBy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: { projectId },
      props,
      skip: 25,
      limit: 26,
    }),
  );
});

test.each([
  ["incident", DiscordIncidentCreationModule, "SubmitNewIncident"],
  [
    "maintenance",
    DiscordMaintenanceCreationModule,
    "SubmitNewScheduledMaintenance",
  ],
] as const)(
  "%s rejects forged provenance before authorization or mutation",
  async (
    _family: string,
    module: DiscordActionModuleRegistration,
    action: string,
  ): Promise<void> => {
    for (const provenance of [
      undefined,
      {},
      { ...validatedProvenance },
      JSON.parse(JSON.stringify(validatedProvenance)),
    ]) {
      await expect(
        module.draftSubmissions![0]!.handle({
          action,
          values: {
            title: "Window",
            description: "Work",
            startsAt: "2099-01-01T10:00:00Z",
            endsAt: "2099-01-01T11:00:00Z",
          },
          selections: {},
          context,
          provenance: provenance as DiscordDraftProvenance,
        }),
      ).rejects.toThrow();
    }
    expect(
      WorkspaceActionAuthorization.getProjectMemberProps,
    ).not.toHaveBeenCalled();
    expect(IncidentService.create).not.toHaveBeenCalled();
    expect(ScheduledMaintenanceService.create).not.toHaveBeenCalled();
  },
);

test.each([
  "success",
  "link failure",
  "monitor failure",
  "monitor disappeared",
  "missing ID",
])(
  "incident returns a durable safe outcome for %s",
  async (scenario: string): Promise<void> => {
    if (scenario === "link failure") {
      jest
        .mocked(IncidentService.getIncidentLinkInDashboard)
        .mockRejectedValue(new Error("private link error"));
    } else if (scenario === "monitor failure") {
      jest
        .mocked(MonitorService.updateOneBy)
        .mockRejectedValue(new Error("private monitor error"));
    } else if (scenario === "monitor disappeared") {
      jest.mocked(MonitorService.updateOneBy).mockResolvedValue(0);
    } else if (scenario === "missing ID") {
      jest.mocked(IncidentService.create).mockResolvedValue(new Incident());
    }
    const result: DiscordDraftSubmissionResult = await submit(
      DiscordIncidentCreationModule,
      "SubmitNewIncident",
      { title: "Private title", description: "Private description" },
      selections,
    );
    expect(result.outcome).toEqual(
      scenario === "missing ID"
        ? { kind: "ambiguous" }
        : {
            kind: "created",
            resourceType: "Incident",
            resourceId: createdId.toString(),
          },
    );
    expect(JSON.stringify(result.outcome)).not.toContain("Private");
    expect(result.response).toMatchObject({ kind: "message", ephemeral: true });
    expect(result.response.content).not.toContain("private");
    if (scenario === "monitor failure" || scenario === "monitor disappeared") {
      expect(result.response.content).toContain("created, but");
    }
    if (scenario !== "success") {
      expect(result.response.content.toLowerCase()).toContain(
        "do not create another",
      );
    }
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
  },
);

test.each(["success", "link failure", "monitor failure", "missing ID"])(
  "maintenance returns a durable safe outcome for %s",
  async (scenario: string): Promise<void> => {
    if (scenario === "link failure") {
      jest
        .mocked(
          ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
        )
        .mockRejectedValue(new Error("private link error"));
    } else if (scenario === "monitor failure") {
      jest
        .mocked(MonitorService.updateOneBy)
        .mockRejectedValue(new Error("private monitor error"));
    } else if (scenario === "missing ID") {
      jest
        .mocked(ScheduledMaintenanceService.create)
        .mockResolvedValue(new ScheduledMaintenance());
    }
    const result: DiscordDraftSubmissionResult = await submit(
      DiscordMaintenanceCreationModule,
      "SubmitNewScheduledMaintenance",
      {
        title: "Window",
        description: "Work",
        startsAt: "2099-01-01T10:00:00Z",
        endsAt: "2099-01-01T11:00:00Z",
      },
      {
        monitors: [monitorId.toString()],
        labels: [],
        monitorStatus: [statusId.toString()],
      },
    );
    expect(result.outcome).toEqual(
      scenario === "missing ID"
        ? { kind: "ambiguous" }
        : {
            kind: "created",
            resourceType: "ScheduledMaintenance",
            resourceId: createdId.toString(),
          },
    );
    expect(result.response).toMatchObject({ kind: "message", ephemeral: true });
    expect(result.response.content).not.toContain("private");
    expect(ScheduledMaintenanceService.create).toHaveBeenCalledTimes(1);
  },
);
