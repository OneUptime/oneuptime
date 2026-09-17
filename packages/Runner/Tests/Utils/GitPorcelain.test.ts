/*
 * ---------------------------------------------------------------------------
 * Unit tests for GitPorcelain — the parser that turns `git status` output into
 * the pathspec the code-fix pipeline stages.
 *
 * Why this parser is worth a test file of its own: every path it returns is
 * handed to `git add -- <path>`, and `git add` exits 128 on a pathspec it
 * cannot resolve. A mis-parsed path is therefore not a cosmetic problem — it
 * aborts the whole repository, after the clone, the agent run and the
 * verification loop, with the fix written and no pull request to show for it.
 *
 * The shapes below are not hypothetical. Each one was produced by running the
 * real `git status --porcelain -uall -z` against a repository in that state,
 * and each one defeats the `line.substring(3)` parsing this replaced:
 *
 *   - a RENAME is two NUL-terminated fields, and the second carries no status
 *     prefix, so slicing three characters off it yields `/old.ts` from
 *     `src/old.ts` — "outside repository" as far as git is concerned;
 *   - a path with a SPACE OR QUOTE is C-quoted in the non-`-z` format, and
 *     the quotes are output, not filename;
 *   - a NEW DIRECTORY collapses to `dir/` without `-uall`, so staging it
 *     sweeps in whatever else landed there.
 *
 * A companion test in RepositoryManagerGit.test.ts drives the same shapes
 * through real git end to end; these pin the parsing itself.
 * ---------------------------------------------------------------------------
 */

import GitPorcelain, {
  GIT_STATUS_PORCELAIN_ARGS,
  GitStatusEntry,
} from "../../Utils/GitPorcelain";

// Build a NUL-delimited stream the way git writes one: every record NUL-ended.
function nulStream(...records: Array<string>): string {
  return records
    .map((record: string) => {
      return `${record}\0`;
    })
    .join("");
}

describe("GIT_STATUS_PORCELAIN_ARGS", () => {
  /*
   * The flags and the parser are one unit: `-z` is what makes records
   * NUL-delimited (so a path may contain anything but NUL), and `-uall` is
   * what expands a new directory into its files. Parsing `-z` output that was
   * not requested with `-z` silently produces C-quoted paths.
   */
  test("asks git for the exact format this parser understands", () => {
    expect(GIT_STATUS_PORCELAIN_ARGS).toEqual([
      "status",
      "--porcelain",
      "-uall",
      "-z",
    ]);
  });
});

describe("parse", () => {
  test("an empty status yields no entries", () => {
    expect(GitPorcelain.parse("")).toEqual([]);
    expect(GitPorcelain.dirtyPaths("")).toEqual([]);
  });

  test("reads the two status letters and the path off a simple record", () => {
    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream(" M src/checkout.ts"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      indexStatus: " ",
      workTreeStatus: "M",
      path: "src/checkout.ts",
    });
  });

  test("distinguishes staged from unstaged status letters", () => {
    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream("A  added.ts", " D deleted.ts", "?? untracked.ts"),
    );

    expect(
      entries.map((entry: GitStatusEntry) => {
        return `${entry.indexStatus}${entry.workTreeStatus}:${entry.path}`;
      }),
    ).toEqual(["A :added.ts", " D:deleted.ts", "??:untracked.ts"]);
  });

  /*
   * THE rename case. `R  src/new.ts\0src/old.ts\0` is ONE change described by
   * TWO records. A parser that maps over records independently turns the
   * second into `/old.ts` — the exact string that makes `git add` fail with
   * "outside repository" and takes the pull request down with it.
   */
  test("a rename is one entry carrying both paths, not two mangled ones", () => {
    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream("R  src/new.ts", "src/old.ts"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      indexStatus: "R",
      workTreeStatus: " ",
      path: "src/new.ts",
      originalPath: "src/old.ts",
    });
  });

  test("a copy consumes its source record the same way a rename does", () => {
    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream("C  src/copy.ts", "src/source.ts"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.originalPath).toBe("src/source.ts");
  });

  /*
   * The source record must be consumed no matter which column carries the R,
   * and a rename in the middle of a stream must not desynchronise everything
   * after it — the classic way this bug shows up is "the file AFTER a rename
   * is the one git rejects".
   */
  test("a rename mid-stream does not desynchronise the records after it", () => {
    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream(
        " M first.ts",
        "R  src/new.ts",
        "src/old.ts",
        "?? last.ts",
        " M after.ts",
      ),
    );

    expect(
      entries.map((entry: GitStatusEntry) => {
        return entry.path;
      }),
    ).toEqual(["first.ts", "src/new.ts", "last.ts", "after.ts"]);
    expect(entries[1]?.originalPath).toBe("src/old.ts");
  });

  /*
   * A three-character path is the boundary of the "is this a record or a
   * bare path" question: `R  a\0b\0` has a source path shorter than the
   * status prefix it would be sliced with.
   */
  test("a rename whose source path is shorter than the status prefix still parses", () => {
    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream("R  ab", "cd"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("ab");
    expect(entries[0]?.originalPath).toBe("cd");
  });

  /*
   * In `-z` output the path is verbatim: no C-quoting, no escaping. Spaces,
   * quotes, backslashes, `->` and non-ASCII bytes are all just bytes, and
   * every one of them must survive to `git add` unchanged.
   */
  test("paths keep spaces, quotes, backslashes and non-ASCII verbatim", () => {
    const awkward: Array<string> = [
      "sp ace/file.ts",
      'quote"inside.ts',
      "back\\slash.ts",
      "arrow -> not-a-rename.ts",
      "café/日本語.ts",
      "-dash-leading.ts",
    ];

    const entries: Array<GitStatusEntry> = GitPorcelain.parse(
      nulStream(
        ...awkward.map((path: string) => {
          return `?? ${path}`;
        }),
      ),
    );

    expect(
      entries.map((entry: GitStatusEntry) => {
        return entry.path;
      }),
    ).toEqual(awkward);
  });

  test("trailing NUL and stray short records are ignored, not turned into paths", () => {
    // "XY" with no path, and the empty tail after the final NUL.
    expect(GitPorcelain.parse(nulStream(" M ok.ts", "??", ""))).toEqual([
      { indexStatus: " ", workTreeStatus: "M", path: "ok.ts" },
    ]);
  });
});

describe("dirtyPaths", () => {
  test("returns the plain paths in order", () => {
    expect(
      GitPorcelain.dirtyPaths(nulStream(" M a.ts", "?? b.ts", "A  c.ts")),
    ).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  /*
   * A rename contributes BOTH sides. Staging only the destination leaves the
   * source file's deletion unstaged, so the branch would carry the new file
   * while still carrying the old one — a pull request that duplicates a file
   * rather than moving it.
   */
  test("a rename contributes both the new and the old path", () => {
    expect(
      GitPorcelain.dirtyPaths(nulStream("R  src/new.ts", "src/old.ts")),
    ).toEqual(["src/new.ts", "src/old.ts"]);
  });

  test("never emits the mangled path the old substring parser produced", () => {
    const paths: Array<string> = GitPorcelain.dirtyPaths(
      nulStream("R  src/new.ts", "src/old.ts"),
    );

    // `"src/old.ts".substring(3)` — an absolute path git reads as outside the repo.
    expect(paths).not.toContain("/old.ts");
    expect(
      paths.every((path: string) => {
        return !path.startsWith("/");
      }),
    ).toBe(true);
  });

  test("deduplicates a path that appears in more than one record", () => {
    /*
     * A file can be both staged-modified and worktree-modified, and a rename
     * destination can equal another record's path. Staging the same pathspec
     * twice is harmless to git but makes the recorded change set misleading.
     */
    expect(
      GitPorcelain.dirtyPaths(
        nulStream("R  shared.ts", "old.ts", " M shared.ts"),
      ),
    ).toEqual(["shared.ts", "old.ts"]);
  });

  test("every path is relative, so none can escape the repository", () => {
    const paths: Array<string> = GitPorcelain.dirtyPaths(
      nulStream(" M a/b/c.ts", "?? d.ts", "R  e.ts", "f.ts"),
    );

    for (const path of paths) {
      expect(path.startsWith("/")).toBe(false);
      expect(path.length).toBeGreaterThan(0);
    }
  });
});
