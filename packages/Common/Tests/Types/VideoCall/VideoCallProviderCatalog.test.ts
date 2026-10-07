import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  ConnectableVideoCallProviders,
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
