/*
 * Microsoft identity association for the marketing domain, served at
 * /.well-known/microsoft-identity-association.json (Home/Routes.ts).
 *
 * Microsoft Entra lets an app registration name a publisher domain only once
 * the domain proves it: Entra fetches this document from the domain and
 * looks for the app's ID in it. With oneuptime.com as their publisher domain
 * the apps below can carry HackerBay's verified-publisher badge, so people
 * in other organizations may consent to them without an administrator.
 *
 * Every app registered in the HackerBay directory (oneuptimehq) that names
 * oneuptime.com as its publisher domain belongs in the list; an app missing
 * from it cannot be given, or re-verify, the domain. Application IDs are
 * public: they are the client IDs every sign-in sends.
 *
 * This module is pure: no filesystem, database or network access.
 */

import { JSONObject } from "Common/Types/JSON";

export const MicrosoftIdentityAssociationPath: string =
  "/.well-known/microsoft-identity-association.json";

/*
 * Only this host vouches for the apps. Every self-hosted OneUptime install
 * runs the same Home service, and a self-hosted domain answering with
 * OneUptime's apps would claim to publish apps it does not.
 */
export const MicrosoftIdentityAssociationHost: string = "oneuptime.com";

export interface MicrosoftAppPublishedByOneUptime {
  name: string;
  applicationId: string;
}

export const MicrosoftAppsPublishedByOneUptime: Array<MicrosoftAppPublishedByOneUptime> =
  [
    {
      name: "OneUptime",
      applicationId: "0e5480fd-a9c5-4ad3-9c0b-9f6045318daf",
    },
    // One-click Connect of Microsoft Teams meetings on oneuptime.com.
    {
      name: "OneUptime Meetings",
      applicationId: "b7805806-13a4-4ecd-bdfc-8d91944b5a46",
    },
    // The same, for test.oneuptime.com.
    {
      name: "OneUptime Meetings (test)",
      applicationId: "bd563347-5ddd-4581-b0b8-5b67253c1b63",
    },
  ];

export function generateMicrosoftIdentityAssociation(options: {
  host: string;
}): JSONObject {
  if (options.host !== MicrosoftIdentityAssociationHost) {
    return { associatedApplications: [] };
  }

  return {
    associatedApplications: MicrosoftAppsPublishedByOneUptime.map(
      (app: MicrosoftAppPublishedByOneUptime): JSONObject => {
        return { applicationId: app.applicationId };
      },
    ),
  };
}
