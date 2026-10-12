import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  ConnectableVideoCallProviders,
  OAuthVideoCallProviders,
  VideoCallConnectionField,
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
  isConnectableVideoCallProvider,
} from "../../../Types/VideoCall/VideoCallProviderCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * The catalog drives the connection form, the server's validation and the
 * setup guide, so a mistake here is a form that cannot be filled in or a
 * setting that is never read.
 */
describe("VideoCallProviderCatalog", () => {
  test("lists each connectable provider once, and never the Slack huddle", () => {
    expect(ConnectableVideoCallProviders).toEqual([
      VideoCallProvider.Zoom,
      VideoCallProvider.GoogleMeet,
      VideoCallProvider.MicrosoftTeams,
      VideoCallProvider.CustomLink,
    ]);
    expect(new Set(ConnectableVideoCallProviders).size).toBe(
      ConnectableVideoCallProviders.length,
    );
    expect(isConnectableVideoCallProvider(VideoCallProvider.SlackHuddle)).toBe(
      false,
    );
    expect(getVideoCallProviderDefinition(VideoCallProvider.SlackHuddle)).toBe(
      undefined,
    );
  });

  test.each(
    VideoCallProviderCatalog.map(
      (
        d: VideoCallProviderDefinition,
      ): [string, VideoCallProviderDefinition] => {
        return [d.provider, d];
      },
    ),
  )(
    "%s is a complete definition",
    (_provider: string, definition: VideoCallProviderDefinition) => {
      expect(definition.title).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.docsPath.startsWith("/docs/")).toBe(true);
      expect(definition.setupSteps.length).toBeGreaterThan(0);
      expect(definition.configFields.length).toBeGreaterThan(0);

      const fields: Array<VideoCallConnectionField> = [
        ...definition.configFields,
        ...definition.secretFields,
      ];
      const keys: Array<string> = fields.map(
        (field: VideoCallConnectionField) => {
          return field.key;
        },
      );

      // A key used twice would be read from config and secrets alike.
      expect(new Set(keys).size).toBe(keys.length);

      for (const field of fields) {
        expect(field.key).toMatch(/^[a-z][A-Za-z]+$/);
        expect(field.title).toBeTruthy();
        expect(field.description).toBeTruthy();

        if (field.type === "dropdown") {
          expect(field.options?.length).toBeGreaterThan(1);
          expect(
            field.options!.map((o: { value: string }) => {
              return o.value;
            }),
          ).toContain(field.defaultValue);
        }
      }

      // Secrets are never shown again, so they are never plain text fields.
      for (const field of definition.secretFields) {
        expect(["password", "json"]).toContain(field.type);
      }

      // A secret field is never also a config field.
      for (const field of definition.configFields) {
        expect(["password", "json"]).not.toContain(field.type);
      }
    },
  );

  /*
   * A provider with a one-click Connect is connected by signing in or with
   * the project's own app, and its description is shown for both: on its
   * tile, and above the sign-in and the app's form alike. Either way the
   * meetings are the connected account's, so that is what it names - not a
   * service account, which a sign-in is not.
   */
  test.each(OAuthVideoCallProviders)(
    "%s's description holds for a sign-in and for the project's own app",
    (provider: VideoCallProvider) => {
      const description: string =
        getVideoCallProviderDefinition(provider)!.description;

      expect(description).not.toMatch(/service (account|user)/i);
      expect(description).toContain("account you connect");
      // One line, for the provider picker.
      expect(description).not.toContain("\n");
    },
  );

  test("only the standing link reuses one room for every call", () => {
    for (const definition of VideoCallProviderCatalog) {
      expect(definition.createsMeetingPerCall).toBe(
        definition.provider !== VideoCallProvider.CustomLink,
      );
    }
  });

  test("the setup guides name the exact permission each provider needs", () => {
    const steps: (provider: VideoCallProvider) => string = (
      provider: VideoCallProvider,
    ): string => {
      return getVideoCallProviderDefinition(provider)!.setupSteps.join("\n");
    };

    expect(steps(VideoCallProvider.Zoom)).toContain(
      "meeting:write:meeting:admin",
    );
    expect(steps(VideoCallProvider.GoogleMeet)).toContain(
      "https://www.googleapis.com/auth/meetings.space.created",
    );
    expect(steps(VideoCallProvider.MicrosoftTeams)).toContain(
      "OnlineMeetings.ReadWrite.All",
    );
    expect(steps(VideoCallProvider.MicrosoftTeams)).toContain(
      "Grant-CsApplicationAccessPolicy",
    );
  });
});
