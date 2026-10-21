import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  ConnectableVideoCallProviders,
  MICROSOFT_TEAMS_CALENDAR_PERMISSION,
  MICROSOFT_TEAMS_MEETING_PERMISSION,
  MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
  OAuthVideoCallProviders,
  VideoCallConnectionField,
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
  ZOOM_CLASSIC_RECORDING_SCOPE,
  ZOOM_MEETING_SCOPE,
  ZOOM_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_RECORDING_FILES_SCOPE,
  ZOOM_RECORDING_FILES_SCOPE,
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

  /*
   * Reading a call's transcript (issue #4875) needs two more Zoom scopes,
   * optional: the Zoom setup guide names them on the Scopes step, granular
   * and classic, and nothing more is asked of Google or Microsoft.
   */
  test("the Zoom guide names the optional transcript scopes on its Scopes step", () => {
    const zoom: VideoCallProviderDefinition = getVideoCallProviderDefinition(
      VideoCallProvider.Zoom,
    )!;
    const scopesStep: string | undefined = zoom.setupSteps.find(
      (step: string): boolean => {
        return step.includes(ZOOM_MEETING_SCOPE);
      },
    );

    expect(scopesStep).toBeDefined();

    for (const scope of [
      ZOOM_RECORDING_FILES_SCOPE,
      ZOOM_MEETING_TRANSCRIPT_SCOPE,
      ZOOM_CLASSIC_RECORDING_SCOPE,
    ]) {
      expect(scopesStep).toContain(`**${scope}**`);
    }

    expect(ZOOM_RECORDING_FILES_SCOPE).toBe(
      "cloud_recording:read:list_recording_files:admin",
    );
    expect(ZOOM_MEETING_TRANSCRIPT_SCOPE).toBe(
      "cloud_recording:read:meeting_transcript:admin",
    );
    expect(ZOOM_OAUTH_RECORDING_FILES_SCOPE).toBe(
      "cloud_recording:read:list_recording_files",
    );
    expect(ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE).toBe(
      "cloud_recording:read:meeting_transcript",
    );

    // Google Meet reads them with the scope it creates meetings with.
    expect(
      getVideoCallProviderDefinition(
        VideoCallProvider.GoogleMeet,
      )!.setupSteps.join("\n"),
    ).not.toMatch(/transcript/i);
  });

  /*
   * Recording and transcribing a Teams call needs two more Graph
   * permissions, optional: the Teams guide names them on the API
   * permissions step, before admin consent is granted, and the setup keeps
   * its five steps.
   */
  test("the Teams guide names the optional recording permissions on its API permissions step", () => {
    const teams: VideoCallProviderDefinition = getVideoCallProviderDefinition(
      VideoCallProvider.MicrosoftTeams,
    )!;
    const permissionsStep: string | undefined = teams.setupSteps.find(
      (step: string): boolean => {
        return step.includes(MICROSOFT_TEAMS_MEETING_PERMISSION);
      },
    );

    expect(permissionsStep).toBeDefined();
    expect(permissionsStep).toContain(
      `**${MICROSOFT_TEAMS_CALENDAR_PERMISSION}**`,
    );
    expect(permissionsStep).toContain(
      `**${MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION}**`,
    );
    expect(
      permissionsStep!.indexOf(MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION),
    ).toBeLessThan(permissionsStep!.indexOf("Grant admin consent"));
    expect(teams.setupSteps).toHaveLength(5);

    expect(MICROSOFT_TEAMS_CALENDAR_PERMISSION).toBe("Calendars.ReadWrite");
    expect(MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION).toBe(
      "OnlineMeetingTranscript.Read.All",
    );
  });
});
