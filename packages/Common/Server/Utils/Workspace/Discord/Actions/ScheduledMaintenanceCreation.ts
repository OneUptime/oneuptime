import { registerCreationDraft } from "./CreationDraftAction";
import { DiscordActionModuleRegistration } from "./Types";

export const DiscordMaintenanceCreationModule: DiscordActionModuleRegistration =
  registerCreationDraft("maintenance");
