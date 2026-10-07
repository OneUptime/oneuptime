import ObjectID from "Common/Types/ObjectID";
import Realtime from "Common/UI/Utils/Realtime";

/*
 * Live updates ask what the API asks: a project that requires an SSO
 * sign-in gives none to a session without one, and the server says so for
 * the project the refused subscription was for. When that is the project
 * open in the Dashboard, the person is sent to sign in with SSO there, the
 * way a refused API request sends them (MasterPage). A refusal for another
 * project - a subscription left over from the one before a switch - changes
 * nothing about the page in front of them.
 *
 * Returns the function that stops listening.
 */
export const listenForRealtimeSsoSignIn: (data: {
  getCurrentProjectId: () => ObjectID | null;
  onSsoSignInRequired: () => void;
}) => () => void = (data: {
  getCurrentProjectId: () => ObjectID | null;
  onSsoSignInRequired: () => void;
}): (() => void) => {
  return Realtime.listenForSsoAuthorizationRequired(
    (tenantId: ObjectID): void => {
      const currentProjectId: ObjectID | null = data.getCurrentProjectId();

      if (!currentProjectId || !currentProjectId.equals(tenantId)) {
        return;
      }

      data.onSsoSignInRequired();
    },
  );
};
