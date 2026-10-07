import { generateKeyPairSync } from "crypto";
import VideoCallConnectionSettingsUtil, {
  MAX_MEETING_LINK_LENGTH,
  VideoCallConnectionSettings,
} from "../../../../Server/Utils/VideoCall/VideoCallConnectionSettings";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
} from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * Save-time validation of a video call connection. A connection that saves
 * must be one a call can be started with, so the checks here are the ones
 * that would otherwise only fail in the middle of an incident.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: "meet@acme.iam.gserviceaccount.com",
  client_id: "1234567890",
  private_key: privateKey,
});

const GUID: string = "11111111-2222-3333-4444-555555555555";

const VALID: Record<string, { config: JSONObject; secrets: JSONObject }> = {
  [VideoCallProvider.Zoom]: {
    config: {
      accountId: "acct",
      clientId: "client",
      hostEmail: "incidents@acme.com",
    },
    secrets: { clientSecret: "secret" },
  },
  [VideoCallProvider.GoogleMeet]: {
    config: { impersonatedUserEmail: "incidents@acme.com", accessType: "OPEN" },
    secrets: { serviceAccountJson: SERVICE_ACCOUNT_JSON },
  },
  [VideoCallProvider.MicrosoftTeams]: {
    config: {
      tenantId: GUID,
      clientId: GUID,
      organizerUserId: GUID,
      lobbyBypass: "organization",
    },
    secrets: { clientSecret: "secret" },
  },
  [VideoCallProvider.CustomLink]: {
    config: { joinUrl: "https://acme.zoom.us/j/123" },
    secrets: {},
  },
};

function validate(
  provider: string,
  config: JSONObject,
  secrets: JSONObject,
): VideoCallConnectionSettings {
  return VideoCallConnectionSettingsUtil.validate({
    provider,
    config,
    secrets,
    requireRequiredSecrets: true,
  });
}

describe("VideoCallConnectionSettingsUtil.validate", () => {
  test.each(Object.keys(VALID))(
    "accepts complete %s settings",
    (provider: string) => {
      const settings: VideoCallConnectionSettings = validate(
        provider,
        VALID[provider]!.config,
        VALID[provider]!.secrets,
      );

      expect(settings.provider).toBe(provider);
    },
  );

  test("refuses a provider that cannot be connected", () => {
    expect(() => {
      return validate(VideoCallProvider.SlackHuddle, {}, {});
    }).toThrow("Provider must be one of");
    expect(() => {
      return validate("Webex", {}, {});
    }).toThrow("Provider must be one of");
  });

  test("names the first missing required setting", () => {
    expect(() => {
      return validate(
        VideoCallProvider.Zoom,
        { accountId: "acct", clientId: "client" },
        { clientSecret: "x" },
      );
    }).toThrow("Meeting host is required for Zoom.");
  });

  test("names a missing required secret", () => {
    expect(() => {
      return validate(VideoCallProvider.Zoom, VALID["Zoom"]!.config, {});
    }).toThrow("Client secret is required for Zoom.");
  });

  test("lets an update leave a stored secret out", () => {
    expect(
      VideoCallConnectionSettingsUtil.validate({
        provider: VideoCallProvider.Zoom,
        config: VALID["Zoom"]!.config,
        secrets: {},
        requireRequiredSecrets: false,
      }).provider,
    ).toBe(VideoCallProvider.Zoom);
  });

  test("refuses a setting the provider does not have", () => {
    expect(() => {
      return validate(
        VideoCallProvider.Zoom,
        { ...VALID["Zoom"]!.config, hostemail: "typo@acme.com" },
        VALID["Zoom"]!.secrets,
      );
    }).toThrow(
      'Configuration contains an unknown setting "hostemail" for Zoom.',
    );
  });

  test("refuses a setting that is not text", () => {
    expect(() => {
      return validate(
        VideoCallProvider.Zoom,
        { ...VALID["Zoom"]!.config, accountId: 42 },
        VALID["Zoom"]!.secrets,
      );
    }).toThrow("Account ID must be text.");
  });

  test("fills a dropdown left unset with its default", () => {
    const settings: VideoCallConnectionSettings = validate(
      VideoCallProvider.GoogleMeet,
      { impersonatedUserEmail: "incidents@acme.com" },
      VALID["GoogleMeet"]!.secrets,
    );

    expect(settings.config["accessType"]).toBe("TRUSTED");
  });

  test("refuses a dropdown value that is not an option", () => {
    expect(() => {
      return validate(
        VideoCallProvider.GoogleMeet,
        {
          impersonatedUserEmail: "incidents@acme.com",
          accessType: "RESTRICTED",
        },
        VALID["GoogleMeet"]!.secrets,
      );
    }).toThrow("Who can join must be one of: TRUSTED, OPEN.");
  });

  describe("provider rules", () => {
    test("Zoom: the host is an email or a Zoom user id", () => {
      expect(() => {
        return validate(
          VideoCallProvider.Zoom,
          { ...VALID["Zoom"]!.config, hostEmail: "not an email" },
          VALID["Zoom"]!.secrets,
        );
      }).toThrow("Meeting host must be the email address of a Zoom user");

      expect(
        validate(
          VideoCallProvider.Zoom,
          { ...VALID["Zoom"]!.config, hostEmail: "KdYKjnimT4KPd8FFgQt9FQ" },
          VALID["Zoom"]!.secrets,
        ).provider,
      ).toBe(VideoCallProvider.Zoom);
    });

    test("Google Meet: the user is an email", () => {
      expect(() => {
        return validate(
          VideoCallProvider.GoogleMeet,
          { impersonatedUserEmail: "incidents" },
          VALID["GoogleMeet"]!.secrets,
        );
      }).toThrow("Create meetings as must be the email address");
    });

    test("Google Meet: the key must be a service account key", () => {
      expect(() => {
        return validate(
          VideoCallProvider.GoogleMeet,
          VALID["GoogleMeet"]!.config,
          { serviceAccountJson: '{"client_email":"x"}' },
        );
      }).toThrow("must contain client_email and private_key");

      expect(() => {
        return validate(
          VideoCallProvider.GoogleMeet,
          VALID["GoogleMeet"]!.config,
          { serviceAccountJson: "[1]" },
        );
      }).toThrow("Service account JSON key must be a JSON object.");
    });

    test("Microsoft Teams: the tenant is a GUID or a domain", () => {
      expect(
        validate(
          VideoCallProvider.MicrosoftTeams,
          {
            ...VALID["MicrosoftTeams"]!.config,
            tenantId: "acme.onmicrosoft.com",
          },
          VALID["MicrosoftTeams"]!.secrets,
        ).provider,
      ).toBe(VideoCallProvider.MicrosoftTeams);

      expect(() => {
        return validate(
          VideoCallProvider.MicrosoftTeams,
          { ...VALID["MicrosoftTeams"]!.config, tenantId: "not a tenant" },
          VALID["MicrosoftTeams"]!.secrets,
        );
      }).toThrow("Directory (tenant) ID must be a GUID");
    });

    test("Microsoft Teams: the client id is a GUID", () => {
      expect(() => {
        return validate(
          VideoCallProvider.MicrosoftTeams,
          { ...VALID["MicrosoftTeams"]!.config, clientId: "oneuptime" },
          VALID["MicrosoftTeams"]!.secrets,
        );
      }).toThrow("Application (client) ID must be a GUID");
    });

    test("Microsoft Teams: the organizer is an object id, not an email", () => {
      expect(() => {
        return validate(
          VideoCallProvider.MicrosoftTeams,
          {
            ...VALID["MicrosoftTeams"]!.config,
            organizerUserId: "incidents@acme.com",
          },
          VALID["MicrosoftTeams"]!.secrets,
        );
      }).toThrow("not an email address");
    });

    test.each([
      ["an http link", "http://acme.zoom.us/j/1", "must be an https link"],
      [
        "a link without a scheme",
        "acme.zoom.us/j/1",
        "must be a full https link",
      ],
      ["a javascript: link", "javascript:alert(1)", "must be an https link"],
      [
        "a link with credentials",
        "https://user:pass@acme.zoom.us/j/1",
        "must not contain a user name or password",
      ],
      [
        "an overlong link",
        `https://acme.zoom.us/${"x".repeat(MAX_MEETING_LINK_LENGTH)}`,
        "at most",
      ],
    ])(
      "Meeting link: refuses %s",
      (_label: string, joinUrl: string, expected: string) => {
        expect(() => {
          return validate(VideoCallProvider.CustomLink, { joinUrl }, {});
        }).toThrow(expected);
      },
    );
  });
});

describe("VideoCallConnectionSettingsUtil.mergeSecrets", () => {
  const definition: VideoCallProviderDefinition =
    getVideoCallProviderDefinition(VideoCallProvider.Zoom)!;

  test("a new value replaces the stored one", () => {
    expect(
      VideoCallConnectionSettingsUtil.mergeSecrets({
        definition,
        stored: { clientSecret: "old" },
        provided: { clientSecret: "new" },
      }),
    ).toEqual({ clientSecret: "new" });
  });

  test("an empty or absent value keeps the stored one", () => {
    expect(
      VideoCallConnectionSettingsUtil.mergeSecrets({
        definition,
        stored: { clientSecret: "old" },
        provided: { clientSecret: "" },
      }),
    ).toEqual({ clientSecret: "old" });

    expect(
      VideoCallConnectionSettingsUtil.mergeSecrets({
        definition,
        stored: { clientSecret: "old" },
        provided: {},
      }),
    ).toEqual({ clientSecret: "old" });
  });

  test("null removes the stored key", () => {
    expect(
      VideoCallConnectionSettingsUtil.mergeSecrets({
        definition,
        stored: { clientSecret: "old" },
        provided: { clientSecret: null },
      }),
    ).toEqual({});
  });

  test("null for a key that is neither known nor stored is refused", () => {
    expect(() => {
      return VideoCallConnectionSettingsUtil.mergeSecrets({
        definition,
        stored: {},
        provided: { clientSecert: null },
      });
    }).toThrow(BadDataException);
  });
});

describe("VideoCallConnectionSettingsUtil.parseJsonObject", () => {
  test("takes an object or JSON text", () => {
    expect(
      VideoCallConnectionSettingsUtil.parseJsonObject(
        { a: "1" },
        "Configuration",
      ),
    ).toEqual({ a: "1" });
    expect(
      VideoCallConnectionSettingsUtil.parseJsonObject(
        '{"a":"1"}',
        "Configuration",
      ),
    ).toEqual({ a: "1" });
  });

  test("reads nothing as empty", () => {
    expect(
      VideoCallConnectionSettingsUtil.parseJsonObject(
        undefined,
        "Configuration",
      ),
    ).toEqual({});
    expect(
      VideoCallConnectionSettingsUtil.parseJsonObject("", "Configuration"),
    ).toEqual({});
  });

  test.each([["[]"], ["not json"], [["a"]], [42]])(
    "refuses %s",
    (value: unknown) => {
      expect(() => {
        return VideoCallConnectionSettingsUtil.parseJsonObject(
          value,
          "Configuration",
        );
      }).toThrow("Configuration must be a JSON object.");
    },
  );
});
