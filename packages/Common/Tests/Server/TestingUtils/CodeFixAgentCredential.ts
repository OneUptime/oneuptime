import {
  CodeFixAgentIdentity,
  CodeFixCredentialCheck,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";

/*
 * What CodeFixAgentAuth.checkCredential answers for a pair that proves this
 * identity - or, for null, a pair that proves none and names no agent - for
 * a route suite that stands in for the credential check and tests what the
 * route does after it. CodeFixAgentAuth.authenticate still runs on it: it
 * lets the identity through, or answers the request as the routes do.
 */
export function credentialCheckProving(
  identity: CodeFixAgentIdentity | null,
): CodeFixCredentialCheck {
  return {
    identity: identity,
    agentId: identity ? identity.id : null,
    isKeyRight: identity !== null,
  };
}
