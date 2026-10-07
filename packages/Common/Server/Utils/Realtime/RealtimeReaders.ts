import { RealtimeReader } from "./RealtimeReadAccess";
import type { AccessTokenService as AccessTokenServiceType } from "../../Services/AccessTokenService";
import type { TeamMemberService as TeamMemberServiceType } from "../../Services/TeamMemberService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * THE PEOPLE BEHIND THE SOCKETS, as their reads see them.
 *
 * A socket says who it is once, when it joins a room (Realtime stores the
 * person from its access token). Whether that person may read a record is
 * asked every time a record changes, with the props a request of theirs
 * would carry in the record's project: their permission rows there, their
 * teams (for the Owned scope) and their global permissions. Building those
 * props reads the permission cache and the person's teams, so they are kept
 * per person and project for a short while rather than built for every
 * event:
 *
 *   - for at most ENTRY_TTL_IN_MS, so a change made on another server
 *     reaches the live updates of this one within that time;
 *   - until the person's permissions are refreshed on this server (a team
 *     joined or left, a permission added, changed or removed:
 *     AccessTokenService calls forgetUser), which applies the change at once.
 *
 * A person who is no longer a member of the project reads nothing there.
 * The values worked out from the props - whether they read every record of
 * a model, the telemetry they may read - live and go with the entry
 * (RealtimeReader.remember).
 */

// Who a socket is, as Realtime stored it when the socket joined a room.
export interface RealtimeReaderIdentity {
  userId: string;
  isMasterAdmin: boolean;
}

interface ReaderEntry {
  userId: string;
  projectId: string;
  expiresAtMs: number;
  reader: Promise<RealtimeReader | null>;
}

export default class RealtimeReaders {
  public static readonly ENTRY_TTL_IN_MS: number = 30 * 1000;

  /*
   * People held at once; past this the oldest entry goes first (an expired
   * one, as a rule), so memory stays bounded however many come and go.
   */
  public static readonly MAX_ENTRIES: number = 10_000;

  private static entries: Map<string, ReaderEntry> = new Map<
    string,
    ReaderEntry
  >();

  // The person in the project, as entries and audiences are keyed.
  public static getKey(
    identity: RealtimeReaderIdentity,
    projectId: ObjectID | string,
  ): string {
    return [
      identity.userId.toString().toLowerCase(),
      projectId.toString().toLowerCase(),
      identity.isMasterAdmin ? "master-admin" : "user",
    ].join("|");
  }

  /*
   * The person as a reader of the project, or null when they read nothing
   * there (no longer a member). Throws when their permissions cannot be
   * read right now; the caller counts that as reading nothing, and the next
   * event asks again.
   */
  public static async getReader(
    identity: RealtimeReaderIdentity,
    projectId: ObjectID | string,
  ): Promise<RealtimeReader | null> {
    const key: string = RealtimeReaders.getKey(identity, projectId);
    const now: number = Date.now();
    const cached: ReaderEntry | undefined = RealtimeReaders.entries.get(key);

    if (cached && cached.expiresAtMs > now) {
      return await cached.reader;
    }

    if (cached) {
      RealtimeReaders.entries.delete(key);
    }

    const pending: Promise<RealtimeReader | null> =
      (async (): Promise<RealtimeReader | null> => {
        const props: DatabaseCommonInteractionProps | null =
          await RealtimeReaders.buildProps(identity, projectId.toString());

        if (!props) {
          return null;
        }

        return RealtimeReaders.createReader(key, props);
      })();

    if (RealtimeReaders.entries.size >= RealtimeReaders.MAX_ENTRIES) {
      const oldestKey: string | undefined = RealtimeReaders.entries
        .keys()
        .next().value;

      if (oldestKey !== undefined) {
        RealtimeReaders.entries.delete(oldestKey);
      }
    }

    const entry: ReaderEntry = {
      userId: identity.userId.toString().toLowerCase(),
      projectId: projectId.toString().toLowerCase(),
      expiresAtMs: now + RealtimeReaders.ENTRY_TTL_IN_MS,
      reader: pending,
    };

    RealtimeReaders.entries.set(key, entry);

    // A failed lookup is not kept: the next event asks again.
    pending.catch((): void => {
      if (RealtimeReaders.entries.get(key) === entry) {
        RealtimeReaders.entries.delete(key);
      }
    });

    return await pending;
  }

  /*
   * Forgets what is held for the person - in one project, or in all of
   * them - so the next event reads their permissions again. Called when
   * their permissions are refreshed on this server.
   */
  public static forgetUser(
    userId: ObjectID | string,
    projectId?: ObjectID | string | undefined,
  ): void {
    const user: string = userId.toString().toLowerCase();
    const project: string | undefined = projectId
      ? projectId.toString().toLowerCase()
      : undefined;

    for (const [key, entry] of Array.from(RealtimeReaders.entries.entries())) {
      if (entry.userId !== user) {
        continue;
      }

      if (project && entry.projectId !== project) {
        continue;
      }

      RealtimeReaders.entries.delete(key);
    }
  }

  // Forgets everyone. For tests.
  public static clear(): void {
    RealtimeReaders.entries.clear();
  }

  // People held right now. For tests.
  public static size(): number {
    return RealtimeReaders.entries.size;
  }

  /*
   * The props a request of the person's would carry in the project, or
   * null when they are not a member of it. A server admin reads every
   * project, as their requests do.
   */
  public static async buildProps(
    identity: RealtimeReaderIdentity,
    projectId: string,
  ): Promise<DatabaseCommonInteractionProps | null> {
    const userId: ObjectID = new ObjectID(identity.userId.toString());
    const tenantId: ObjectID = new ObjectID(projectId);

    if (identity.isMasterAdmin) {
      return {
        userId: userId,
        userType: UserType.MasterAdmin,
        isMasterAdmin: true,
        tenantId: tenantId,
      };
    }

    const accessTokenService: AccessTokenServiceType =
      RealtimeReaders.getAccessTokenService();
    const teamMemberService: TeamMemberServiceType =
      RealtimeReaders.getTeamMemberService();

    const globalPermission: Promise<UserGlobalAccessPermission | null> =
      accessTokenService.getUserGlobalAccessPermission(userId);

    const [userGlobalAccessPermission, userTenantAccessPermission, teamIds]: [
      UserGlobalAccessPermission | null,
      UserTenantAccessPermission | null,
      Array<ObjectID>,
    ] = await Promise.all([
      globalPermission,
      accessTokenService.getUserTenantAccessPermission(userId, tenantId, {
        userGlobalAccessPermission: globalPermission,
      }),
      teamMemberService.getTeamIdsForUser(userId, tenantId),
    ]);

    // Not a member of the project (any more): nothing to read there.
    if (!userTenantAccessPermission) {
      return null;
    }

    return {
      userId: userId,
      userType: UserType.User,
      tenantId: tenantId,
      userGlobalAccessPermission: userGlobalAccessPermission || undefined,
      userTenantAccessPermission: {
        [tenantId.toString()]: userTenantAccessPermission,
      },
      userTeamIds: teamIds,
    };
  }

  private static createReader(
    key: string,
    props: DatabaseCommonInteractionProps,
  ): RealtimeReader {
    const remembered: Map<string, Promise<unknown>> = new Map<
      string,
      Promise<unknown>
    >();

    return {
      key: key,
      props: props,
      remember: <T>(name: string, work: () => Promise<T>): Promise<T> => {
        const known: Promise<unknown> | undefined = remembered.get(name);

        if (known) {
          return known as Promise<T>;
        }

        // A work that throws before its first await still yields a promise.
        const pending: Promise<T> = (async (): Promise<T> => {
          return await work();
        })();

        remembered.set(name, pending);

        pending.catch((): void => {
          if (remembered.get(name) === pending) {
            remembered.delete(name);
          }
        });

        return pending;
      },
    };
  }

  /*
   * Read when first needed rather than imported: the services extend
   * DatabaseService, which reaches Realtime, which reaches this module.
   * Only their types are imported above.
   */
  private static getAccessTokenService(): AccessTokenServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/AccessTokenService").default;
  }

  private static getTeamMemberService(): TeamMemberServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/TeamMemberService").default;
  }
}
