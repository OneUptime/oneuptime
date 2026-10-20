/*
 * Who may read what people wrote to a company AI tool (Claude Enterprise,
 * Microsoft 365 Copilot) once it is in OneUptime.
 *
 *   - Admins: project owners and admins only. The default: a company's
 *     chats are its people's words, and most roles that read traces have no
 *     business reading them. Everyone else sees neither the conversations
 *     nor the calls they are made of, anywhere in the product (the service
 *     the connection writes to is left out of their telemetry read scope).
 *   - Everyone: everyone who may read the project's AI conversations.
 *
 * Provider account connections (usage and cost) write no conversations, so
 * the setting means nothing for them.
 */
enum LlmConversationReaders {
  Admins = "admins",
  Everyone = "everyone",
}

export default LlmConversationReaders;

export const AllLlmConversationReaders: Array<LlmConversationReaders> = [
  LlmConversationReaders.Admins,
  LlmConversationReaders.Everyone,
];

export function isLlmConversationReaders(
  value: unknown,
): value is LlmConversationReaders {
  return (
    typeof value === "string" &&
    (AllLlmConversationReaders as Array<string>).includes(value)
  );
}
