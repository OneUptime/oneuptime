import fs from "fs";

/*
 * A directory of this Runner's own that no other user may enter: made with
 * mode 0700, then checked - a directory, not a symlink or a file in its
 * place, and owned by this process's user - and made 0700 again if its mode
 * lets anyone else in (mkdir's mode is subject to the umask, and an older
 * Runner made these with the default). Anything else is refused, never
 * used: in a shared temporary directory another user could have made the
 * directory first, to read or replace what the Runner writes under it.
 *
 * What the Runner keeps of a code fix lives under such directories (its
 * workspace, the clone of a repository; its Git credentials helper), so a
 * global Runner's JavaScript step - which runs as a user of its own - finds
 * nothing of a fix to read even if its code got out of its sandbox.
 */
export const PRIVATE_DIRECTORY_MODE: number = 0o700;

export class PrivateDirectoryRefusedError extends Error {}

export async function ensurePrivateDirectory(
  directory: string,
  ownerUid: number | undefined = process.getuid?.(),
): Promise<void> {
  try {
    await fs.promises.mkdir(directory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
  } catch (error: unknown) {
    // A file in its place: said below, as such.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  const stat: fs.Stats = await fs.promises.lstat(directory);

  if (!stat.isDirectory()) {
    throw new PrivateDirectoryRefusedError(
      `${directory} exists but is not a directory (a symlink or a file is in its place), so this Runner will not keep a code fix's files under it.`,
    );
  }

  if (ownerUid !== undefined && stat.uid !== ownerUid) {
    throw new PrivateDirectoryRefusedError(
      `${directory} is owned by another user (uid ${stat.uid}), so this Runner will not keep a code fix's files under it.`,
    );
  }

  if ((stat.mode & 0o077) !== 0) {
    await fs.promises.chmod(directory, PRIVATE_DIRECTORY_MODE);
  }
}
