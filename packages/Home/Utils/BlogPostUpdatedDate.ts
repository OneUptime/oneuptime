/*
 * When each blog post's text last changed, read from the blog's git history.
 *
 * A post's date is in its folder name, and its page said the post was last
 * modified then too, whatever changed after. The blog's validator edits a
 * post's README.md only to fix what it found wrong, and commits each post on
 * its own (src/scripts/validate-posts.ts in OneUptime/blog), so a later
 * commit to a README is a real change to the post. The commit that added a
 * README is not: a post committed a few days after its date would read as
 * updated.
 *
 * A post whose README only one commit has touched - or that the history does
 * not reach, as in a shallow clone - has no updated date, and its publish
 * date stands.
 */

// A commit of the blog, as CodeRepositoryUtil.getCommitAuthorsWithFiles lists it.
export interface BlogCommit {
  committedAt: string;
  files: Array<string>;
}

// A post's README.md: posts/<post>/README.md, and nothing deeper.
const POST_README: RegExp = /^posts\/([^/]+)\/README\.md$/;

// The UTC day (YYYY-MM-DD) of an ISO 8601 time, or null when it is not one.
export function getUtcDay(isoTime: string): string | null {
  if (!isoTime) {
    return null;
  }

  const time: number = Date.parse(isoTime);

  if (isNaN(time)) {
    return null;
  }

  return new Date(time).toISOString().slice(0, 10);
}

/*
 * Each post's updated date (YYYY-MM-DD, UTC), by post folder, from commits
 * listed newest first as git log lists them: the day of the newest commit
 * that changed the post's README.md, for a post whose README more than one
 * commit changed.
 */
export function getUpdatedDatesOfPosts(
  commits: ReadonlyArray<BlogCommit>,
): Map<string, string> {
  const readmes: Map<string, { commits: number; newestDay: string | null }> =
    new Map();

  for (const commit of commits) {
    const day: string | null = getUtcDay(commit.committedAt);

    for (const file of commit.files) {
      const post: string | undefined = POST_README.exec(file)?.[1];

      if (!post) {
        continue;
      }

      const readme: { commits: number; newestDay: string | null } | undefined =
        readmes.get(post);

      if (!readme) {
        readmes.set(post, { commits: 1, newestDay: day });
        continue;
      }

      readme.commits++;
      // Newest first: the first commit that has a day is the newest.
      readme.newestDay = readme.newestDay || day;
    }
  }

  const updatedDates: Map<string, string> = new Map();

  for (const [post, readme] of readmes) {
    if (readme.commits > 1 && readme.newestDay) {
      updatedDates.set(post, readme.newestDay);
    }
  }

  return updatedDates;
}

/*
 * The date a post's pages give as its last update: its updated date, when that
 * is after the day it was published; otherwise none.
 */
export function getUpdatedDateAfterPublishing(
  updatedDate: string | null | undefined,
  postDate: string,
): string | null {
  return updatedDate && updatedDate > postDate ? updatedDate : null;
}
