import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import AlertEpisodeInternalNoteService from "../../../../Server/Services/AlertEpisodeInternalNoteService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceResourceUpdateAuthorization from "../../../../Server/Utils/Workspace/WorkspaceResourceUpdateAuthorization";
import DiscordResponderAction from "../../../../Server/Utils/Workspace/Discord/Actions/ResponderAction";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { DiscordActionRequest } from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";

// Failure cases are specified in E2E/Discord/RESPONDER_FAILURES.md before code.
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const resourceId: ObjectID = ObjectID.generate();
const targetId: ObjectID = ObjectID.generate();

function props(permission: Permission): DatabaseCommonInteractionProps {
  return {
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
            permission,
            isBlockPermission: false,
            labelIds: [],
          },
        ],
      },
    },
  };
}

function request(
  action: string,
  values: JSONObject = {},
): DiscordActionRequest {
  return {
    action,
    resourceId,
    values: values as Readonly<Record<string, string>>,
    context: {
      projectId,
      userId,
      props: props(Permission.ProjectOwner),
      guildId: "123456789012345678",
      discordUserId: "123456789012345679",
    },
  };
}

export interface DiscordResponderTestFamily {
  name: string;
  actions: DiscordResponderAction;
  model: DatabaseBaseModelType;
  service:
    | typeof IncidentService
    | typeof AlertService
    | typeof IncidentEpisodeService
    | typeof AlertEpisodeService;
  noteService:
    | typeof IncidentInternalNoteService
    | typeof AlertInternalNoteService
    | typeof IncidentEpisodeInternalNoteService
    | typeof AlertEpisodeInternalNoteService;
  publicNoteService?:
    | typeof IncidentPublicNoteService
    | typeof IncidentEpisodePublicNoteService
    | undefined;
  stateService: typeof IncidentStateService | typeof AlertStateService;
  stateModel: typeof IncidentState | typeof AlertState;
  trigger: string;
  event: UserNotificationEventType;
  noteId: string;
  stateValue: string;
}

afterEach((): void => {
  jest.restoreAllMocks();
});

export function testResponderActions(family: DiscordResponderTestFamily): void {
  describe(`Discord ${family.name} actions`, (): void => {
    beforeEach((): void => {
      jest
        .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
        .mockResolvedValue(props(Permission.ProjectOwner));
      jest
        .spyOn(family.service, "findOneBy")
        .mockResolvedValue(new family.model() as never);
    });

    test("revalidates membership and refuses removed users before notes", async (): Promise<void> => {
      jest
        .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
        .mockRejectedValue(new NotAuthorizedException("Membership removed"));
      const write: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      await expect(
        family.actions.execute(
          request(`Submit${family.name}Note`, {
            noteType: "private",
            note: "hello",
          }),
        ),
      ).rejects.toThrow("Membership removed");
      expect(write).not.toHaveBeenCalled();
    });

    test("rejects a reader's note before calling a root-writing service", async (): Promise<void> => {
      jest
        .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
        .mockResolvedValue(props(Permission.Viewer));
      const write: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      await expect(
        family.actions.execute(
          request(`Submit${family.name}Note`, {
            noteType: "private",
            note: "hello",
          }),
        ),
      ).rejects.toThrow("permission");
      expect(write).not.toHaveBeenCalled();
    });

    test("rejects an inaccessible resource without writing a note", async (): Promise<void> => {
      jest.spyOn(family.service, "findOneBy").mockResolvedValue(null);
      const write: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      await expect(
        family.actions.execute(
          request(`Submit${family.name}Note`, {
            noteType: "private",
            note: "hello",
          }),
        ),
      ).rejects.toThrow("permission");
      expect(write).not.toHaveBeenCalled();
    });

    test("preserves note text, actor and resource in the private destination", async (): Promise<void> => {
      const write: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      const text: string =
        "  **Investigating** @everyone <@12345678901234567>\nSecond line.  ";
      await family.actions.execute(
        request(`Submit${family.name}Note`, {
          noteType: "private",
          note: text,
        }),
      );
      expect(write).toHaveBeenCalledWith({
        projectId,
        userId,
        [family.noteId]: resourceId,
        note: text,
      });
    });

    for (const note of [" ", "x".repeat(4001), { text: "wrong type" }]) {
      test(`rejects invalid note ${typeof note === "string" ? note.length : "object"}`, async (): Promise<void> => {
        const write: jest.SpyInstance = jest
          .spyOn(family.noteService, "addNote")
          .mockResolvedValue(undefined as never);
        await expect(
          family.actions.execute(
            request(`Submit${family.name}Note`, { noteType: "private", note }),
          ),
        ).rejects.toThrow();
        expect(write).not.toHaveBeenCalled();
      });
    }

    test("rejects an unknown note type", async (): Promise<void> => {
      const write: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      await expect(
        family.actions.execute(
          request(`Submit${family.name}Note`, {
            noteType: "broadcast",
            note: "hello",
          }),
        ),
      ).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
    });

    test("supports public notes only for incident families", async (): Promise<void> => {
      const privateWrite: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      if (family.publicNoteService) {
        const publicWrite: jest.SpyInstance = jest
          .spyOn(family.publicNoteService, "addNote")
          .mockResolvedValue(undefined as never);
        await family.actions.execute(
          request(`Submit${family.name}Note`, {
            noteType: "public",
            note: "Recovered",
          }),
        );
        expect(publicWrite).toHaveBeenCalledWith({
          projectId,
          userId,
          [family.noteId]: resourceId,
          note: "Recovered",
        });
      } else {
        await expect(
          family.actions.execute(
            request(`Submit${family.name}Note`, {
              noteType: "public",
              note: "Recovered",
            }),
          ),
        ).rejects.toThrow();
      }
      expect(privateWrite).not.toHaveBeenCalled();
    });

    test("refuses a missing or foreign state before state mutation", async (): Promise<void> => {
      jest.spyOn(family.stateService, "findOneBy").mockResolvedValue(null);
      const change: jest.SpyInstance = jest
        .spyOn(family.actions.definition, "changeState")
        .mockResolvedValue();
      await expect(
        family.actions.execute(
          request(`SubmitChange${family.name}State`, {
            stateId: targetId.toString(),
          }),
        ),
      ).rejects.toThrow("permission");
      expect(change).not.toHaveBeenCalled();
    });

    test("uses the selected state and current user props", async (): Promise<void> => {
      jest
        .spyOn(family.stateService, "findOneBy")
        .mockResolvedValue(new family.stateModel() as never);
      jest
        .spyOn(WorkspaceResourceUpdateAuthorization, "assertCanUpdateIncident")
        .mockResolvedValue();
      jest
        .spyOn(WorkspaceResourceUpdateAuthorization, "assertCanUpdateAlert")
        .mockResolvedValue();
      const incident: jest.SpyInstance = jest
        .spyOn(IncidentService, "changeIncidentState")
        .mockResolvedValue();
      const alert: jest.SpyInstance = jest
        .spyOn(AlertService, "changeAlertState")
        .mockResolvedValue();
      const incidentEpisode: jest.SpyInstance = jest
        .spyOn(IncidentEpisodeService, "changeEpisodeState")
        .mockResolvedValue();
      const alertEpisode: jest.SpyInstance = jest
        .spyOn(AlertEpisodeService, "changeEpisodeState")
        .mockResolvedValue();
      await family.actions.execute(
        request(`SubmitChange${family.name}State`, {
          stateId: targetId.toString(),
        }),
      );
      if (family.name === "IncidentEpisode" || family.name === "AlertEpisode") {
        const change: jest.SpyInstance =
          family.name === "IncidentEpisode" ? incidentEpisode : alertEpisode;
        expect(change).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId,
            episodeId: resourceId,
            [family.stateValue]: targetId,
            notifyOwners: true,
            props: expect.objectContaining({ userId, tenantId: projectId }),
          }),
        );
      } else {
        const change: jest.SpyInstance =
          family.name === "Incident" ? incident : alert;
        expect(change).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId,
            [family.noteId]: resourceId,
            [family.stateValue]: targetId,
            notifyOwners: true,
            props: expect.objectContaining({ userId, tenantId: projectId }),
          }),
        );
      }
    });

    for (const action of ["Acknowledge", "Resolve"]) {
      test(`${action} delegates to the existing family service with the actor`, async (): Promise<void> => {
        jest
          .spyOn(
            WorkspaceResourceUpdateAuthorization,
            "assertCanUpdateIncident",
          )
          .mockResolvedValue();
        jest
          .spyOn(WorkspaceResourceUpdateAuthorization, "assertCanUpdateAlert")
          .mockResolvedValue();
        const incidentAck: jest.SpyInstance = jest
          .spyOn(IncidentService, "acknowledgeIncident")
          .mockResolvedValue(undefined as never);
        const incidentResolve: jest.SpyInstance = jest
          .spyOn(IncidentService, "resolveIncident")
          .mockResolvedValue(undefined as never);
        const alertAck: jest.SpyInstance = jest
          .spyOn(AlertService, "acknowledgeAlert")
          .mockResolvedValue();
        const alertResolve: jest.SpyInstance = jest
          .spyOn(AlertService, "resolveAlert")
          .mockResolvedValue(undefined as never);
        const incidentEpisodeAck: jest.SpyInstance = jest
          .spyOn(IncidentEpisodeService, "acknowledgeEpisode")
          .mockResolvedValue();
        const incidentEpisodeResolve: jest.SpyInstance = jest
          .spyOn(IncidentEpisodeService, "resolveEpisode")
          .mockResolvedValue();
        const alertEpisodeAck: jest.SpyInstance = jest
          .spyOn(AlertEpisodeService, "acknowledgeEpisode")
          .mockResolvedValue();
        const alertEpisodeResolve: jest.SpyInstance = jest
          .spyOn(AlertEpisodeService, "resolveEpisode")
          .mockResolvedValue();
        const calls: Record<
          string,
          Record<"Acknowledge" | "Resolve", jest.SpyInstance>
        > = {
          Incident: { Acknowledge: incidentAck, Resolve: incidentResolve },
          Alert: { Acknowledge: alertAck, Resolve: alertResolve },
          IncidentEpisode: {
            Acknowledge: incidentEpisodeAck,
            Resolve: incidentEpisodeResolve,
          },
          AlertEpisode: {
            Acknowledge: alertEpisodeAck,
            Resolve: alertEpisodeResolve,
          },
        };
        await family.actions.execute(request(`${action}${family.name}`));
        expect(
          calls[family.name]![action as "Acknowledge" | "Resolve"],
        ).toHaveBeenCalledWith(resourceId, userId);
      });
    }

    test("refuses an unreadable on-call policy", async (): Promise<void> => {
      jest.spyOn(OnCallDutyPolicyService, "findOneBy").mockResolvedValue(null);
      const execute: jest.SpyInstance = jest
        .spyOn(OnCallDutyPolicyService, "executePolicy")
        .mockResolvedValue();
      await expect(
        family.actions.execute(
          request(`SubmitExecute${family.name}OnCallPolicy`, {
            onCallPolicyId: targetId.toString(),
          }),
        ),
      ).rejects.toThrow("permission");
      expect(execute).not.toHaveBeenCalled();
    });

    test("executes the selected policy for the correct resource family", async (): Promise<void> => {
      jest
        .spyOn(OnCallDutyPolicyService, "findOneBy")
        .mockResolvedValue(new OnCallDutyPolicy());
      const execute: jest.SpyInstance = jest
        .spyOn(OnCallDutyPolicyService, "executePolicy")
        .mockResolvedValue();
      await family.actions.execute(
        request(`SubmitExecute${family.name}OnCallPolicy`, {
          onCallPolicyId: targetId.toString(),
        }),
      );
      expect(execute).toHaveBeenCalledWith(targetId, {
        [family.trigger]: resourceId,
        userNotificationEventType: family.event,
      });
    });

    test("does not report a policy failure as success", async (): Promise<void> => {
      jest
        .spyOn(OnCallDutyPolicyService, "findOneBy")
        .mockResolvedValue(new OnCallDutyPolicy());
      jest
        .spyOn(OnCallDutyPolicyService, "executePolicy")
        .mockRejectedValue(new Error("Execution failed"));
      await expect(
        family.actions.execute(
          request(`SubmitExecute${family.name}OnCallPolicy`, {
            onCallPolicyId: targetId.toString(),
          }),
        ),
      ).rejects.toThrow("Execution failed");
    });

    test("rejects malformed IDs before querying a resource", async (): Promise<void> => {
      const lookup: jest.SpyInstance = jest.spyOn(family.service, "findOneBy");
      await expect(
        family.actions.execute({
          ...request(`Submit${family.name}Note`, {
            note: "hello",
            noteType: "private",
          }),
          resourceId: new ObjectID("not-a-uuid"),
        }),
      ).rejects.toThrow();
      expect(lookup).not.toHaveBeenCalled();
    });

    test("rejects unknown actions without a note or on-call side effect", async (): Promise<void> => {
      const note: jest.SpyInstance = jest
        .spyOn(family.noteService, "addNote")
        .mockResolvedValue(undefined as never);
      const execute: jest.SpyInstance = jest
        .spyOn(OnCallDutyPolicyService, "executePolicy")
        .mockResolvedValue();
      await expect(
        family.actions.execute(request("Unsupported")),
      ).rejects.toThrow();
      expect(note).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });
  });
}
