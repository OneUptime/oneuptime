import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * A COMMIT HELD TO THE FILES AS THEY WERE READ, AND REFUSED (issue #6331).
 *
 * Approving an Ask AI code change reads each file it writes again, and the
 * commit is then held to that read on every host that can hold one:
 *
 *   GitLab          each update names the last commit that changed the file
 *                   (last_commit_id), and a create needs the file still not
 *                   there: GitLab refuses the whole commit otherwise;
 *   Forgejo, Gitea  each update names the blob it replaces (sha), and a
 *                   create needs the file still not there;
 *   GitHub          the commit checks the tree it is built on - each file
 *                   as read - and moves the branch only as a fast-forward,
 *                   so a push that lands while it is made refuses it.
 *
 * A push between that read and the commit - a teammate's, CI's, a merge
 * queue's - is then never written over: the host refuses the commit, and
 * the caller says so in the words of the approval's own refusal
 * (CodeWriteTools). Nothing is written.
 */
export default class CodeHostFilesMovedError extends BadDataException {
  /*
   * The files that moved, when the host says which (GitHub's tree); every
   * file the commit was held to when it does not.
   */
  public readonly filePaths: Array<string>;

  public constructor(data: { filePaths: Array<string>; reason: string }) {
    super(
      data.filePaths.length > 0
        ? `${data.reason} Files: ${data.filePaths.join(", ")}.`
        : data.reason,
    );
    this.filePaths = data.filePaths;
  }
}
