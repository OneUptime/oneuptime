import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import PermissionNamespace from "Common/Server/Types/Permission/PermissionNamespace";
import logger from "Common/Server/Utils/Logger";

/*
 * What a restore must not leave behind in Valkey: the permissions OneUptime
 * keeps for every signed-in user (project-permissions-..., global-
 * permissions-...), for up to 30 days, built from the data before the
 * restore. Left there, someone added to a team after the backup would keep
 * access the restored data no longer gives them, and someone removed would
 * stay locked out. They are rebuilt from the restored data on the next
 * request.
 *
 * Only those keys go: the job queues, sessions and locks in Valkey stay.
 */

export const RESTORE_CLEARED_CACHE_PREFIXES: ReadonlyArray<string> = [
  `${PermissionNamespace.GlobalPermission}-`,
  `${PermissionNamespace.ProjectPermission}-`,
];

const SCAN_BATCH_SIZE: number = 500;

// Deletes the cached permissions; answers how many keys went.
export async function clearCachesAfterRestore(
  client: ClientType | null = Redis.getClient(),
): Promise<number> {
  if (!client) {
    logger.warn(
      "Backups: Valkey is not connected, so cached permissions were not cleared after the restore. They expire on their own within 30 days; restart OneUptime to clear them now.",
    );
    return 0;
  }

  let deleted: number = 0;

  for (const prefix of RESTORE_CLEARED_CACHE_PREFIXES) {
    let cursor: string = "0";

    do {
      const [next, keys]: [string, Array<string>] = await client.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        SCAN_BATCH_SIZE,
      );
      cursor = next;

      if (keys.length > 0) {
        deleted += await client.unlink(...keys);
      }
    } while (cursor !== "0");
  }

  return deleted;
}
