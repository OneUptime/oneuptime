/*
 * botbuilder, the Bot Framework SDK, the one way OneUptime imports it.
 *
 * botbuilder runs on zod 4 with two zod 3 names put back (BotbuilderOnZod4),
 * and they have to be back before botbuilder is loaded: its Teams activity
 * handler calls one of them as it loads. This module adds them first and
 * then hands botbuilder on unchanged, so `import { TurnContext } from
 * "./Botbuilder"` is `import { TurnContext } from "botbuilder"` with the order
 * taken care of. BotbuilderImportsGuard fails on any other file that imports
 * botbuilder, botbuilder-core, botframework-connector or botframework-schema.
 *
 * botframework-connector's serializer models come through here as well, as
 * BotConnectorMappers: the very module botbuilder serializes with, for
 * MicrosoftTeamsAiAnswer, which lets its Entity model keep the AI label.
 *
 * So do the parts of botframework-connector the bot's outbound route is
 * built from (BotFrameworkRouting, issue #10763): its credentials and
 * clients, which botbuilder does not export itself, and JwtTokenExtractor,
 * whose cache of OpenID metadata every check of an incoming token reads
 * its signing keys from (BotFrameworkOpenIdMetadata).
 */
import "./BotbuilderOnZod4";

export * from "botbuilder";

export * as BotConnectorMappers from "botframework-connector/lib/connectorApi/models/mappers";

export {
  AppCredentials,
  AuthenticationConstants,
  AuthenticationError,
  ConnectorClient,
  GovernmentConstants,
  MicrosoftAppCredentials,
  MsalAppCredentials,
  TeamsConnectorClient,
  type ConnectorClientOptions,
  type ServiceClientCredentials,
  type ServiceClientCredentialsFactory,
} from "botframework-connector";

export { JwtTokenExtractor } from "botframework-connector/lib/auth/jwtTokenExtractor";
