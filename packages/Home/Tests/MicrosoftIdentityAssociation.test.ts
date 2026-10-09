import {
  MicrosoftAppPublishedByOneUptime,
  MicrosoftAppsPublishedByOneUptime,
  MicrosoftIdentityAssociationHost,
  MicrosoftIdentityAssociationPath,
  generateMicrosoftIdentityAssociation,
} from "../Utils/MicrosoftIdentityAssociation";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

/*
 * What Microsoft Entra reads at
 * https://oneuptime.com/.well-known/microsoft-identity-association.json
 * before it lets an app registration name oneuptime.com as its publisher
 * domain.
 */

const GUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("Microsoft identity association", () => {
  test("lists every app, by its application ID only, in Microsoft's format", () => {
    expect(
      generateMicrosoftIdentityAssociation({
        host: MicrosoftIdentityAssociationHost,
      }),
    ).toEqual({
      associatedApplications: MicrosoftAppsPublishedByOneUptime.map(
        (app: MicrosoftAppPublishedByOneUptime): JSONObject => {
          return { applicationId: app.applicationId };
        },
      ),
    });
  });

  test("the application IDs are lowercase GUIDs, each listed once", () => {
    const ids: Array<string> = MicrosoftAppsPublishedByOneUptime.map(
      (app: MicrosoftAppPublishedByOneUptime): string => {
        return app.applicationId;
      },
    );

    for (const id of ids) {
      expect(id).toMatch(GUID);
    }

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the one-click Microsoft Teams meetings apps are listed", () => {
    expect(
      MicrosoftAppsPublishedByOneUptime.map(
        (app: MicrosoftAppPublishedByOneUptime): string => {
          return app.name;
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        "OneUptime Meetings",
        "OneUptime Meetings (test)",
      ]),
    );
  });

  test("any other host vouches for no app", () => {
    for (const host of [
      "test.oneuptime.com",
      "status.example.com",
      "oneuptime.com.evil.example",
      "",
    ]) {
      expect(generateMicrosoftIdentityAssociation({ host })).toEqual({
        associatedApplications: [],
      });
    }
  });

  test("Home serves it at the path Microsoft fetches", () => {
    expect(MicrosoftIdentityAssociationPath).toBe(
      "/.well-known/microsoft-identity-association.json",
    );

    const routes: string = fs.readFileSync(
      path.join(__dirname, "..", "Routes.ts"),
      "utf-8",
    );

    expect(routes).toContain("MicrosoftIdentityAssociationPath,");
    expect(routes).toContain(
      "generateMicrosoftIdentityAssociation({ host: Host })",
    );
  });
});
