import { registerCreationDraft } from "./CreationDraftAction";
import { DiscordActionModuleRegistration } from "./Types";

export const DiscordIncidentCreationModule: DiscordActionModuleRegistration =
  registerCreationDraft("incident");
