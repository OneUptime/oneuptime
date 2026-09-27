import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import MonitorService from "../../../../Services/MonitorService";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import {
  DiscordActionModuleRegistration,
  DiscordActionRequest,
  DiscordActionResult,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
} from "./Types";

async function setMonitoring(
  request: DiscordActionRequest,
): Promise<DiscordActionResult> {
  if (
    request.action !== "EnableMonitor" &&
    request.action !== "DisableMonitor"
  ) {
    throw new BadDataException("This Discord monitor action is not supported.");
  }
  if (
    !request.resourceId ||
    !ObjectID.isValidUUID(request.resourceId.toString())
  ) {
    throw new BadDataException("Choose a valid monitor.");
  }
  const props: DatabaseCommonInteractionProps =
    await WorkspaceActionAuthorization.getProjectMemberProps(request.context);
  // Ordinary scoped updates enforce the dashboard's role, label and owner rules.
  const count: number = await MonitorService.updateOneBy({
    query: {
      _id: request.resourceId.toString(),
      projectId: request.context.projectId,
    },
    data: { disableActiveMonitoring: request.action === "DisableMonitor" },
    props,
  });
  if (!count) {
    throw new NotAuthorizedException(
      "The monitor was not found in this project, or you do not have permission to update it.",
    );
  }
  return {
    kind: "message",
    content:
      request.action === "EnableMonitor"
        ? "Monitor enabled."
        : "Monitor disabled.",
    ephemeral: true,
  };
}

export const DiscordMonitorActionModule: DiscordActionModuleRegistration = {
  handlers: [
    {
      actions: ["EnableMonitor", "DisableMonitor"],
      interactionKinds: [DiscordInteractionKind.MessageComponent],
      responseMode: DiscordHandlerResponseMode.Deferred,
      handle: setMonitoring,
    },
  ],
};
