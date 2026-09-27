import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceResourceUpdateAuthorization from "../../../../Server/Utils/Workspace/WorkspaceResourceUpdateAuthorization";
import DiscordIncidentActions from "../../../../Server/Utils/Workspace/Discord/Actions/Incident";
import DiscordResponderForms from "../../../../Server/Utils/Workspace/Discord/Actions/ResponderForms";
import {
  DiscordActionContext,
  DiscordActionModuleRegistration,
  DiscordActionRequest,
  DiscordActionRegistration,
  DiscordActionResult,
  DiscordChoiceProviderRegistration,
  DiscordChoicePage,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

// Written before presentation code: bounded lists must preserve all choices.
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const resourceId: ObjectID = ObjectID.generate();
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
  props,
  guildId: "123456789012345678",
  discordUserId: "123456789012345679",
};

function module(): DiscordActionModuleRegistration {
  return DiscordResponderForms.register(DiscordIncidentActions);
}

async function open(action: string): Promise<DiscordActionResult> {
  const request: DiscordActionRequest = {
    action,
    resourceId,
    values: {},
    context,
  };
  const handler: DiscordActionRegistration | undefined = module().handlers.find(
    (item: DiscordActionRegistration): boolean => {
      return item.actions.includes(action);
    },
  );
  expect(handler).toBeDefined();
  return handler!.handle(request);
}

function provider(kind: string): DiscordChoiceProviderRegistration {
  const choiceProvider: DiscordChoiceProviderRegistration | undefined =
    module().choiceProviders?.find(
      (item: DiscordChoiceProviderRegistration): boolean => {
        return item.name === `incident-${kind}`;
      },
    );
  expect(choiceProvider).toBeDefined();
  return choiceProvider!;
}

beforeEach((): void => {
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(props);
  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(new Incident());
  jest
    .spyOn(WorkspaceResourceUpdateAuthorization, "assertCanUpdateIncident")
    .mockResolvedValue();
});
afterEach((): void => {
  jest.restoreAllMocks();
});

test("opening a note returns a modal with explicit private/public choices", async (): Promise<void> => {
  const result: DiscordActionResult = await open("ViewAddIncidentNote");
  expect(result.kind).toBe("modal");
  if (result.kind !== "modal") {
    throw new Error("Expected a note modal");
  }
  expect(result.modal.customId).toBe(`SubmitIncidentNote:${resourceId}`);
  expect(result.modal.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        customId: "note",
        kind: "text",
        maxLength: 4000,
      }),
      expect.objectContaining({
        customId: "noteType",
        options: expect.arrayContaining([
          { label: "Private", value: "private" },
          { label: "Public", value: "public" },
        ]),
      }),
    ]),
  );
});

test("opening a state selector returns a scoped native picker", async (): Promise<void> => {
  const result: DiscordActionResult = await open("ViewChangeIncidentState");
  expect(result).toEqual({
    kind: "picker",
    picker: expect.objectContaining({
      provider: "incident-states",
      submitAction: "SubmitChangeIncidentState",
      field: "stateId",
      resourceId,
    }),
  });
});

test("opening a policy selector returns the family policy picker", async (): Promise<void> => {
  const result: DiscordActionResult = await open(
    "ViewExecuteIncidentOnCallPolicy",
  );
  expect(result).toEqual({
    kind: "picker",
    picker: expect.objectContaining({
      provider: "incident-policies",
      submitAction: "SubmitExecuteIncidentOnCallPolicy",
      field: "onCallPolicyId",
      resourceId,
    }),
  });
});

test("selectors expose page two instead of truncating after 25 choices", async (): Promise<void> => {
  const states: Array<IncidentState> = Array.from(
    { length: 26 },
    (_: unknown, index: number): IncidentState => {
      const state: IncidentState = new IncidentState();
      state.id = ObjectID.generate();
      state.name = `State ${index}`;
      return state;
    },
  );
  const query: jest.SpyInstance = jest
    .spyOn(IncidentStateService, "findBy")
    .mockResolvedValueOnce(states)
    .mockResolvedValueOnce(states.slice(25));
  const first: DiscordChoicePage = await provider("states").getPage({
    provider: "incident-states",
    resourceId,
    context,
    limit: 25,
  });
  expect(first.options).toHaveLength(25);
  expect(first.nextCursor).toBe("25");
  const second: DiscordChoicePage = await provider("states").getPage({
    provider: "incident-states",
    resourceId,
    context,
    limit: 25,
    cursor: first.nextCursor,
  });
  expect(second.options).toEqual([
    { label: "State 25", value: states[25]!.id!.toString() },
  ]);
  expect(second.previousCursor).toBe("0");
  expect(second.nextCursor).toBeUndefined();
  expect(query.mock.calls[1]![0]).toMatchObject({
    skip: 25,
    limit: 26,
    props,
    query: { projectId },
  });
});

test("policy search stays under current actor permission and project scope", async (): Promise<void> => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = ObjectID.generate();
  policy.name = "Primary";
  const query: jest.SpyInstance = jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockResolvedValue([policy]);
  const result: DiscordChoicePage = await provider("policies").getPage({
    provider: "incident-policies",
    resourceId,
    context,
    limit: 25,
    search: "Primary",
  });
  expect(result.options).toEqual([
    { label: "Primary", value: policy.id!.toString() },
  ]);
  expect(query.mock.calls[0]![0]).toMatchObject({
    props,
    query: { projectId, name: expect.anything() },
  });
});

test("permission revocation between pages prevents further resource discovery", async (): Promise<void> => {
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockRejectedValue(new NotAuthorizedException("Membership removed"));
  const lookup: jest.SpyInstance = jest
    .spyOn(IncidentStateService, "findBy")
    .mockResolvedValue([]);
  await expect(
    provider("states").getPage({
      provider: "incident-states",
      resourceId,
      context,
      limit: 25,
      cursor: "25",
    }),
  ).rejects.toThrow("Membership removed");
  expect(lookup).not.toHaveBeenCalled();
});

test("invalid page cursors cannot cause an unbounded query", async (): Promise<void> => {
  const lookup: jest.SpyInstance = jest
    .spyOn(IncidentStateService, "findBy")
    .mockResolvedValue([]);
  await expect(
    provider("states").getPage({
      provider: "incident-states",
      resourceId,
      context,
      limit: 25,
      cursor: "-1",
    }),
  ).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
});
