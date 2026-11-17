import VideoCallConnectionService from "../../../Services/VideoCallConnectionService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import VideoCallConnection from "../../../../Models/DatabaseModels/VideoCallConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import VideoCallAuthMethod from "../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import ZoomTranscriptClient from "../Transcripts/ZoomTranscriptClient";
import { VideoCallOAuthSecrets } from "./VideoCallOAuth";
import VideoCallOAuthApps from "./VideoCallOAuthApps";
import VideoCallOAuthTokenStore from "./VideoCallOAuthTokenStore";

/*
 * THE ZOOM CONNECTIONS TO SIGN IN AGAIN FOR CALL TRANSCRIPTS (#9269).
 *
 * This server's Zoom app is a user-managed General app whose scopes are set
 * on the app in the Zoom App Marketplace: the sign-in asks for none
 * (ZoomOAuthApp). A published app gains a scope only through an update Zoom
 * approves, and once that update is live, a sign-in made before it keeps
 * what it was granted for 90 days. Then Zoom expires its refresh token
 * (https://developers.zoom.us/docs/distribute/published-apps/updating/),
 * the weekly keep-alive fails (VideoCallOAuthTokenStore), and the
 * connection starts no call until someone clicks Reconnect.
 *
 * So a connection signed in before the app could read transcripts is asked
 * to reconnect: it cannot read them, and it will stop starting calls. But
 * Reconnect helps only once the app grants the transcript scopes, and
 * nothing tells the server when that is: before Zoom approves the update, a
 * production sign-in is granted neither, whoever signs in. The server goes
 * by its own sign-ins instead. Its app grants them once a Zoom sign-in on
 * this server, made after the connection's, was granted them. Until one
 * was, nothing is asked.
 *
 * Asked only of a connection made by signing in to this server's Zoom app,
 * while the server has that app, the connection is signed in, and Zoom's
 * list of the scopes it granted was recorded (every token response carries
 * one) and holds neither transcript scope. A Server-to-Server OAuth
 * connection is the project's own app, whose scopes the project adds itself:
 * Get from Zoom names them (ZoomTranscriptClient.getMissingScopeMessage).
 */

// What a Zoom sign-in says about the scopes it holds.
export interface ZoomSignInGrant {
  // The scopes Zoom granted, as it listed them. Unset when it never said.
  grantedScope?: string | undefined;
  // When the account signed in. Unset when that was before OneUptime recorded it.
  signedInAt?: Date | undefined;
}

// What this server's own Zoom sign-ins say about its Zoom app.
export interface ZoomAppTranscriptGrant {
  // Some Zoom sign-in on this server was granted a transcript scope.
  isGranted: boolean;
  // When the newest of those signed in, if any of them recorded it.
  newestSignedInAt?: Date | undefined;
}

// A connection of the project to reconnect, as the Video Calls page names it.
export interface ZoomConnectionToReconnect {
  id: ObjectID;
  name: string;
  connectedAccount?: string | undefined;
}

export default class ZoomTranscriptReconnect {
  // A stored sign-in's grant, or null for a connection that holds no sign-in.
  public static readGrant(
    secrets: VideoCallOAuthSecrets | null,
  ): ZoomSignInGrant | null {
    if (!secrets) {
      return null;
    }

    const signedInAt: number = Date.parse(secrets.signedInAt || "");

    return {
      grantedScope: secrets.scope,
      signedInAt: Number.isFinite(signedInAt)
        ? new Date(signedInAt)
        : undefined,
    };
  }

  // Zoom said what it granted, and it was neither transcript scope.
  public static isMissingTranscriptScopes(grant: ZoomSignInGrant): boolean {
    const grantedScope: string = (grant.grantedScope || "").trim();

    return (
      grantedScope.length > 0 &&
      !ZoomTranscriptClient.grantsTranscripts(grantedScope)
    );
  }

  // What the server's Zoom sign-ins, as stored, say about its Zoom app.
  public static getAppGrant(
    grants: Array<ZoomSignInGrant>,
  ): ZoomAppTranscriptGrant {
    let isGranted: boolean = false;
    let newestSignedInAt: Date | undefined = undefined;

    for (const grant of grants) {
      if (
        !grant.grantedScope ||
        !ZoomTranscriptClient.grantsTranscripts(grant.grantedScope)
      ) {
        continue;
      }

      isGranted = true;

      if (
        grant.signedInAt &&
        (!newestSignedInAt ||
          grant.signedInAt.getTime() > newestSignedInAt.getTime())
      ) {
        newestSignedInAt = grant.signedInAt;
      }
    }

    return { isGranted, newestSignedInAt };
  }

  /*
   * Whether a sign-in should be made again: it holds neither transcript
   * scope, and the app granted them to a sign-in made after it, so a new
   * sign-in would hold them too.
   */
  public static shouldReconnect(data: {
    grant: ZoomSignInGrant;
    appGrant: ZoomAppTranscriptGrant;
  }): boolean {
    if (
      !ZoomTranscriptReconnect.isMissingTranscriptScopes(data.grant) ||
      !data.appGrant.isGranted
    ) {
      return false;
    }

    /*
     * Signed in before OneUptime recorded when: before every sign-in that
     * recorded it, and, since an app's scopes are only ever added, before
     * the app gained the scopes another sign-in on this server holds.
     */
    if (!data.grant.signedInAt) {
      return true;
    }

    /*
     * Signed in since, and still granted neither: the app's newest grant of
     * them came before this sign-in, so signing in again might not help.
     */
    return (
      data.appGrant.newestSignedInAt !== undefined &&
      data.appGrant.newestSignedInAt.getTime() > data.grant.signedInAt.getTime()
    );
  }

  /*
   * The project's Zoom connections to reconnect for call transcripts.
   * Nothing while this server has no Zoom app of its own (Reconnect is not
   * offered then), and the server's other sign-ins are read only when a
   * connection of the project holds neither transcript scope.
   */
  @CaptureSpan()
  public static async getConnectionsToReconnect(
    projectId: ObjectID,
  ): Promise<Array<ZoomConnectionToReconnect>> {
    if (!VideoCallOAuthApps.isConfigured(VideoCallProvider.Zoom)) {
      return [];
    }

    const connections: Array<VideoCallConnection> =
      await VideoCallConnectionService.findBy({
        query: {
          projectId,
          provider: VideoCallProvider.Zoom,
          authMethod: VideoCallAuthMethod.OAuth,
        },
        select: {
          _id: true,
          name: true,
          connectedAccount: true,
          secrets: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const missing: Array<{
      connection: VideoCallConnection;
      grant: ZoomSignInGrant;
    }> = [];

    for (const connection of connections) {
      const grant: ZoomSignInGrant | null = ZoomTranscriptReconnect.readGrant(
        VideoCallOAuthTokenStore.parseSecrets(connection.secrets),
      );

      if (
        connection.id &&
        grant &&
        ZoomTranscriptReconnect.isMissingTranscriptScopes(grant)
      ) {
        missing.push({ connection, grant });
      }
    }

    if (missing.length === 0) {
      return [];
    }

    const appGrant: ZoomAppTranscriptGrant =
      await ZoomTranscriptReconnect.readServerAppGrant();

    return missing
      .filter((item: { grant: ZoomSignInGrant }): boolean => {
        return ZoomTranscriptReconnect.shouldReconnect({
          grant: item.grant,
          appGrant,
        });
      })
      .map(
        (item: {
          connection: VideoCallConnection;
        }): ZoomConnectionToReconnect => {
          return {
            id: item.connection.id!,
            name: item.connection.name || "",
            connectedAccount: item.connection.connectedAccount || undefined,
          };
        },
      );
  }

  // Every Zoom sign-in on this server, in any project, read for its grant.
  private static async readServerAppGrant(): Promise<ZoomAppTranscriptGrant> {
    const signIns: Array<VideoCallConnection> =
      await VideoCallConnectionService.findAllBy({
        query: {
          provider: VideoCallProvider.Zoom,
          authMethod: VideoCallAuthMethod.OAuth,
        },
        select: { _id: true, secrets: true },
        props: { isRoot: true },
      });

    const grants: Array<ZoomSignInGrant> = [];

    for (const signIn of signIns) {
      const grant: ZoomSignInGrant | null = ZoomTranscriptReconnect.readGrant(
        VideoCallOAuthTokenStore.parseSecrets(signIn.secrets),
      );

      if (grant) {
        grants.push(grant);
      }
    }

    return ZoomTranscriptReconnect.getAppGrant(grants);
  }
}
