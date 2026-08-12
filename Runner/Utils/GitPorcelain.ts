/*
 * The one parser for `git status --porcelain` output in the code-fix
 * pipeline.
 *
 * Every path this returns is fed straight to `git add -- <path>`, so a
 * mis-parsed path is not a cosmetic problem: `git add` exits 128 on a
 * pathspec it cannot resolve, which aborts the whole repository and the
 * pull request never opens. Three shapes of porcelain output break naive
 * `line.substring(3)` parsing, and all three occur in real fix runs:
 *
 *   - RENAMES. In `-z` mode a rename is TWO NUL-terminated fields:
 *     `R  <newPath>\0<oldPath>\0`. The second field carries no XY prefix,
 *     so slicing three characters off it yields a mangled path
 *     (`src/old.ts` -> `/old.ts`) that `git add` rejects as "outside
 *     repository". Without `-z` the same record is
 *     `R  <old> -> <new>`, whose arrow is likewise not a path.
 *   - QUOTED PATHS. Without `-z`, git C-quotes any path containing a
 *     space, a quote or a non-ASCII byte (`"sp ace/q\"uote.ts"`). The
 *     quotes are part of the output, not of the filename.
 *   - COLLAPSED UNTRACKED DIRECTORIES. Without `-uall`, a new directory is
 *     reported once as `?? newdir/` rather than as its files, so staging it
 *     sweeps in whatever else landed there — including build output.
 *
 * The fix for all three is the same: always ask git for `-uall -z` and
 * parse the NUL stream as records rather than as lines. This class is pure
 * so the record-shape handling is directly unit-testable without a
 * repository.
 */

// The status letters git uses for a rename and a copy record.
const RENAME_STATUS: string = "R";
const COPY_STATUS: string = "C";

/*
 * `git status --porcelain -uall -z` arguments, in one place so every call
 * site asks for the format this parser actually understands.
 */
export const GIT_STATUS_PORCELAIN_ARGS: Array<string> = [
  "status",
  "--porcelain",
  "-uall",
  "-z",
];

export interface GitStatusEntry {
  // The index (staged) status letter, or " " when clean.
  indexStatus: string;
  // The working-tree status letter, or " " when clean.
  workTreeStatus: string;
  /*
   * The path as it exists NOW — the destination for a rename or copy. This
   * is the path to stage.
   */
  path: string;
  // The source path of a rename or copy. Absent otherwise.
  originalPath?: string | undefined;
}

export default class GitPorcelain {
  /*
   * Parse the NUL-delimited output of `git status --porcelain -uall -z`.
   *
   * Records are consumed in order because a rename or copy owns the record
   * that follows it — which is exactly what a `split` + `map` cannot
   * express, and why that shape mangles renames.
   */
  public static parse(output: string): Array<GitStatusEntry> {
    const records: Array<string> = output.split("\0");
    const entries: Array<GitStatusEntry> = [];

    for (let index: number = 0; index < records.length; index++) {
      const record: string = records[index] as string;

      /*
       * A well-formed record is "XY " plus at least one path character.
       * The trailing empty string after the final NUL lands here too.
       */
      if (record.length < 4) {
        continue;
      }

      const indexStatus: string = record.charAt(0);
      const workTreeStatus: string = record.charAt(1);
      const path: string = record.substring(3);

      const entry: GitStatusEntry = {
        indexStatus,
        workTreeStatus,
        path,
      };

      /*
       * A rename or copy is followed by its source path as a bare record.
       * Consume it here so the loop cannot mistake it for a status record
       * and slice three characters off a filename.
       */
      if (
        indexStatus === RENAME_STATUS ||
        indexStatus === COPY_STATUS ||
        workTreeStatus === RENAME_STATUS ||
        workTreeStatus === COPY_STATUS
      ) {
        const originalPath: string | undefined = records[index + 1];

        if (originalPath !== undefined && originalPath.length > 0) {
          entry.originalPath = originalPath;
          index++;
        }
      }

      entries.push(entry);
    }

    return entries;
  }

  /*
   * Every dirty path, ready to hand to `git add --`.
   *
   * A rename contributes BOTH sides: staging only the destination would
   * leave the source file's deletion out of the commit, so the branch would
   * carry the new file while still carrying the old one. Deletions are
   * included for the same reason — `git add -- <deleted path>` is how a
   * deletion is staged.
   */
  public static dirtyPaths(output: string): Array<string> {
    const paths: Array<string> = [];

    for (const entry of this.parse(output)) {
      paths.push(entry.path);

      if (entry.originalPath) {
        paths.push(entry.originalPath);
      }
    }

    // Preserve first-seen order; a path can legitimately appear twice.
    return Array.from(new Set(paths));
  }
}
