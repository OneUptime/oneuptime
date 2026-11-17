import VideoCallConnectionService from "../../../../../Server/Services/VideoCallConnectionService";
import { VideoCallOAuthSecrets } from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuthApps";
import ZoomTranscriptReconnect, {
  ZoomAppTranscriptGrant,
  ZoomConnectionToReconnect,
  ZoomSignInGrant,
} from "../../../../../Server/Utils/VideoCall/OAuth/ZoomTranscriptReconnect";
import VideoCallConnection from "../../../../../Models/DatabaseModels/VideoCallConnection";
import ObjectID from "../../../../../Types/ObjectID";
import VideoCallAuthMethod from "../../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Which Zoom connections the Video Calls page asks to reconnect for call
 * transcripts (#9269): a sign-in Zoom granted neither transcript scope,
 * once this server's Zoom app grants them - which the server knows only
 * from a sign-in of its own, made after that one, that was granted them.
 * Before Zoom approves the app's update, signing in again grants nothing
 * more, so nothing is asked.
 */

const MEETINGS_ONLY: string = "meeting:write:meeting user:read:user";
const WITH_TRANSCRIPTS: string =
  "meeting:write:meeting user:read:user cloud_recording:read:list_recording_files cloud_recording:read:meeting_transcript";

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OLD_CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NEW_CONNECTION: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_PROJECTS_CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const OCTOBER: Date = new Date("2026-10-01T09:00:00.000Z");
const DECEMBER: Date = new Date("2026-12-01T09:00:00.000Z");

// The app granted them to a sign-in made in December.
const GRANTED_IN_DECEMBER: ZoomAppTranscriptGrant = {
  isGranted: true,
  newestSignedInAt: DECEMBER,
};

const NOT_GRANTED: ZoomAppTranscriptGrant = { isGranted: false };

function shouldReconnect(
  grant: ZoomSignInGrant,
  appGrant: ZoomAppTranscriptGrant,
): boolean {
  return ZoomTranscriptReconnect.shouldReconnect({ grant, appGrant });
}

function signIn(data: {
  scope?: string | undefined;
  signedInAt?: Date | undefined;
}): VideoCallOAuthSecrets {
  const secrets: VideoCallOAuthSecrets = { refreshToken: "refresh" };

  if (data.scope !== undefined) {
    secrets.scope = data.scope;
  }

  if (data.signedInAt) {
    secrets.signedInAt = data.signedInAt.toISOString();
  }

  return secrets;
}

function zoomConnection(data: {
  id: ObjectID;
  name: string;
  secrets: VideoCallOAuthSecrets | Record<string, never>;
  connectedAccount?: string | undefined;
}): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection.id = data.id;
  connection.name = data.name;
  connection.provider = VideoCallProvider.Zoom;
  connection.authMethod = VideoCallAuthMethod.OAuth;
  connection.secrets = JSON.stringify(data.secrets);

  if (data.connectedAccount) {
    connection.connectedAccount = data.connectedAccount;
  }

  return connection;
}

describe("ZoomTranscriptReconnect.shouldReconnect - shown", () => {
  test("a sign-in granted neither transcript scope, made before OneUptime recorded when, once a sign-in on this server was granted them", () => {
    expect(
      shouldReconnect({ grantedScope: MEETINGS_ONLY }, GRANTED_IN_DECEMBER),
    ).toBe(true);
  });

  test("so too when the sign-ins that were granted them predate recorded times as well", () => {
    expect(
      shouldReconnect({ grantedScope: MEETINGS_ONLY }, { isGranted: true }),
    ).toBe(true);
  });

  test("a sign-in made before the newest one that was granted them", () => {
    expect(
      shouldReconnect(
        { grantedScope: MEETINGS_ONLY, signedInAt: OCTOBER },
        GRANTED_IN_DECEMBER,
      ),
    ).toBe(true);
  });

  test("a scope list Zoom separated with commas", () => {
    expect(
      shouldReconnect(
        { grantedScope: "meeting:write:meeting,user:read:user" },
        GRANTED_IN_DECEMBER,
      ),
    ).toBe(true);
  });
});

describe("ZoomTranscriptReconnect.shouldReconnect - not shown", () => {
  test("before any sign-in on this server was granted them: Zoom has not approved the update, so signing in again would not help", () => {
    expect(shouldReconnect({ grantedScope: MEETINGS_ONLY }, NOT_GRANTED)).toBe(
      false,
    );
    expect(
      shouldReconnect(
        { grantedScope: MEETINGS_ONLY, signedInAt: OCTOBER },
        NOT_GRANTED,
      ),
    ).toBe(false);
  });

  test.each([
    ["the recording files scope", "cloud_recording:read:list_recording_files"],
    ["the meeting transcript scope", "cloud_recording:read:meeting_transcript"],
    [
      "both",
      "cloud_recording:read:list_recording_files cloud_recording:read:meeting_transcript",
    ],
    ["the classic recording scope", "recording:read"],
  ])("a sign-in granted %s", (_name: string, transcriptScope: string) => {
    expect(
      shouldReconnect(
        { grantedScope: `${MEETINGS_ONLY} ${transcriptScope}` },
        GRANTED_IN_DECEMBER,
      ),
    ).toBe(false);
  });

  test.each([
    ["never recorded", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])(
    "a sign-in whose granted scope was %s",
    (_name: string, grantedScope: string | undefined) => {
      expect(shouldReconnect({ grantedScope }, GRANTED_IN_DECEMBER)).toBe(
        false,
      );
    },
  );

  test("a sign-in made after the newest one that was granted them, which signing in again might not change", () => {
    expect(
      shouldReconnect(
        {
          grantedScope: MEETINGS_ONLY,
          signedInAt: new Date("2026-12-02T09:00:00.000Z"),
        },
        GRANTED_IN_DECEMBER,
      ),
    ).toBe(false);
    expect(
      shouldReconnect(
        { grantedScope: MEETINGS_ONLY, signedInAt: DECEMBER },
        GRANTED_IN_DECEMBER,
      ),
    ).toBe(false);
  });

  test("a sign-in made since OneUptime recorded when, while every sign-in granted them predates that", () => {
    expect(
      shouldReconnect(
        { grantedScope: MEETINGS_ONLY, signedInAt: OCTOBER },
        { isGranted: true },
      ),
    ).toBe(false);
  });
});

describe("ZoomTranscriptReconnect.getAppGrant", () => {
  test("the app grants them once any sign-in was granted either scope, as of the newest of those", () => {
    expect(
      ZoomTranscriptReconnect.getAppGrant([
        { grantedScope: MEETINGS_ONLY, signedInAt: new Date("2027-01-05") },
        { grantedScope: WITH_TRANSCRIPTS, signedInAt: OCTOBER },
        {
          grantedScope: `${MEETINGS_ONLY} cloud_recording:read:meeting_transcript`,
          signedInAt: DECEMBER,
        },
        { grantedScope: WITH_TRANSCRIPTS },
      ]),
    ).toEqual({ isGranted: true, newestSignedInAt: DECEMBER });
  });

  test("a sign-in granted them before OneUptime recorded when still counts, with no time", () => {
    expect(
      ZoomTranscriptReconnect.getAppGrant([{ grantedScope: WITH_TRANSCRIPTS }]),
    ).toEqual({ isGranted: true, newestSignedInAt: undefined });
  });

  test("no sign-in granted them, or none said what it was granted: not granted", () => {
    expect(
      ZoomTranscriptReconnect.getAppGrant([
        { grantedScope: MEETINGS_ONLY, signedInAt: DECEMBER },
        { signedInAt: DECEMBER },
        { grantedScope: "" },
      ]),
    ).toEqual({ isGranted: false, newestSignedInAt: undefined });
    expect(ZoomTranscriptReconnect.getAppGrant([])).toEqual({
      isGranted: false,
      newestSignedInAt: undefined,
    });
  });
});

describe("ZoomTranscriptReconnect.readGrant", () => {
  test("reads the granted scope and when the account signed in", () => {
    expect(
      ZoomTranscriptReconnect.readGrant(
        signIn({ scope: MEETINGS_ONLY, signedInAt: OCTOBER }),
      ),
    ).toEqual({ grantedScope: MEETINGS_ONLY, signedInAt: OCTOBER });
  });

  test("a time it cannot read is no time, and a connection with no sign-in has no grant", () => {
    expect(
      ZoomTranscriptReconnect.readGrant({
        refreshToken: "refresh",
        scope: MEETINGS_ONLY,
        signedInAt: "yesterday",
      }),
    ).toEqual({ grantedScope: MEETINGS_ONLY, signedInAt: undefined });
    expect(ZoomTranscriptReconnect.readGrant(null)).toBeNull();
  });
});

describe("ZoomTranscriptReconnect.getConnectionsToReconnect", () => {
  let projectConnections: Array<VideoCallConnection>;
  let serverSignIns: Array<VideoCallConnection>;

  beforeEach(() => {
    projectConnections = [];
    serverSignIns = [];

    jest.spyOn(VideoCallOAuthApps, "isConfigured").mockReturnValue(true);
    jest
      .spyOn(VideoCallConnectionService, "findBy")
      .mockImplementation(async () => {
        return projectConnections;
      });
    jest
      .spyOn(VideoCallConnectionService, "findAllBy")
      .mockImplementation(async () => {
        return serverSignIns;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const oldSignIn: () => VideoCallConnection = (): VideoCallConnection => {
    return zoomConnection({
      id: OLD_CONNECTION,
      name: "Zoom",
      connectedAccount: "incidents@acme.com",
      secrets: signIn({ scope: MEETINGS_ONLY }),
    });
  };

  const grantedSignIn: () => VideoCallConnection = (): VideoCallConnection => {
    return zoomConnection({
      id: OTHER_PROJECTS_CONNECTION,
      name: "Zoom",
      connectedAccount: "oncall@example.com",
      secrets: signIn({ scope: WITH_TRANSCRIPTS, signedInAt: DECEMBER }),
    });
  };

  test("names a connection signed in before the app could read transcripts, once another sign-in on this server was granted them", async () => {
    projectConnections = [oldSignIn()];
    serverSignIns = [oldSignIn(), grantedSignIn()];

    const found: Array<ZoomConnectionToReconnect> =
      await ZoomTranscriptReconnect.getConnectionsToReconnect(PROJECT);

    expect(found).toEqual([
      {
        id: OLD_CONNECTION,
        name: "Zoom",
        connectedAccount: "incidents@acme.com",
      },
    ]);
    // Nothing of the sign-in goes out with it.
    expect(JSON.stringify(found)).not.toContain("refresh");
  });

  test("reads only the project's own Zoom connections made by signing in, never a Server-to-Server app's", async () => {
    await ZoomTranscriptReconnect.getConnectionsToReconnect(PROJECT);

    expect(VideoCallConnectionService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT,
          provider: VideoCallProvider.Zoom,
          authMethod: VideoCallAuthMethod.OAuth,
        },
        props: { isRoot: true },
      }),
    );
  });

  test("names nothing before any sign-in on this server was granted them", async () => {
    projectConnections = [oldSignIn()];
    serverSignIns = [
      oldSignIn(),
      zoomConnection({
        id: OTHER_PROJECTS_CONNECTION,
        name: "Zoom",
        secrets: signIn({ scope: MEETINGS_ONLY, signedInAt: DECEMBER }),
      }),
    ];

    expect(
      await ZoomTranscriptReconnect.getConnectionsToReconnect(PROJECT),
    ).toEqual([]);
    expect(VideoCallConnectionService.findAllBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          provider: VideoCallProvider.Zoom,
          authMethod: VideoCallAuthMethod.OAuth,
        },
      }),
    );
  });

  test("names nothing, and reads no other sign-in, for connections that were granted them, are signed out, or never said what they were granted", async () => {
    projectConnections = [
      zoomConnection({
        id: NEW_CONNECTION,
        name: "Zoom",
        secrets: signIn({ scope: WITH_TRANSCRIPTS, signedInAt: DECEMBER }),
      }),
      // Signed out: the account removed OneUptime from Zoom.
      zoomConnection({ id: OLD_CONNECTION, name: "Zoom 2", secrets: {} }),
      zoomConnection({
        id: OTHER_PROJECTS_CONNECTION,
        name: "Zoom 3",
        secrets: signIn({}),
      }),
    ];
    serverSignIns = [grantedSignIn()];

    expect(
      await ZoomTranscriptReconnect.getConnectionsToReconnect(PROJECT),
    ).toEqual([]);
    expect(VideoCallConnectionService.findAllBy).not.toHaveBeenCalled();
  });

  test("names nothing, and reads nothing, on a server without its own Zoom app, where Reconnect is not offered", async () => {
    jest.spyOn(VideoCallOAuthApps, "isConfigured").mockReturnValue(false);
    projectConnections = [oldSignIn()];
    serverSignIns = [oldSignIn(), grantedSignIn()];

    expect(
      await ZoomTranscriptReconnect.getConnectionsToReconnect(PROJECT),
    ).toEqual([]);
    expect(VideoCallOAuthApps.isConfigured).toHaveBeenCalledWith(
      VideoCallProvider.Zoom,
    );
    expect(VideoCallConnectionService.findBy).not.toHaveBeenCalled();
  });

  test("a connection signed in again after the newest granted sign-in, and still granted neither, is not named again", async () => {
    const signedInAgain: VideoCallConnection = zoomConnection({
      id: OLD_CONNECTION,
      name: "Zoom",
      secrets: signIn({
        scope: MEETINGS_ONLY,
        signedInAt: new Date("2026-12-05T09:00:00.000Z"),
      }),
    });

    projectConnections = [signedInAgain];
    serverSignIns = [signedInAgain, grantedSignIn()];

    expect(
      await ZoomTranscriptReconnect.getConnectionsToReconnect(PROJECT),
    ).toEqual([]);
  });
});
