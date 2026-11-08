import {
  CodeFileUnseen,
  CodeFileUnseenFinding,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";

type ReviewerNoteFunction = (data: {
  // The branch the pull request starts from.
  baseBranchName: string;
  // What its card said the change writes over unseen (CodeFilesSeen).
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}) => string | null;

/*
 * WHAT A PULL REQUEST APPROVED ANYWAY TELLS WHOEVER REVIEWS IT (issue #6313).
 *
 * The card of an Ask AI pull request said it writes over what Ask AI never
 * read - a file changed on the base branch after Ask AI read it, read on
 * another branch only, never read, or not checked - and the person approved
 * it anyway. Whoever reviews it on GitHub, GitLab, Forgejo or Gitea may
 * never have seen the card, so the pull request's description says it too,
 * as Markdown: each file in a code span, so its name reads as written
 * (src/__init__.py, pages/[slug].tsx). Null when the card said nothing.
 */
export const describeCodeFilesUnseenForReviewer: ReviewerNoteFunction = (data: {
  baseBranchName: string;
  findings: ReadonlyArray<CodeFileUnseenFinding>;
}): string | null => {
  if (data.findings.length === 0) {
    return null;
  }

  const base: MarkdownText = FeedMarkdown.code(data.baseBranchName);

  const items: Array<MarkdownText> = data.findings.map(
    (finding: CodeFileUnseenFinding): MarkdownText => {
      const file: MarkdownText = FeedMarkdown.code(finding.filePath);

      switch (finding.unseen) {
        case CodeFileUnseen.ChangedSinceRead:
          return mdText`${file}: changed on ${base} after AI read it.`;
        case CodeFileUnseen.ReadOnAnotherBranch:
          return finding.readOnBranch
            ? mdText`${file}: AI read it on ${FeedMarkdown.code(finding.readOnBranch)}, and it is different on ${base}.`
            : mdText`${file}: AI read it on another branch, and it is different on ${base}.`;
        case CodeFileUnseen.NotRead:
          return mdText`${file}: AI did not read it before writing it.`;
        case CodeFileUnseen.NotChecked:
        default:
          return mdText`${file}: OneUptime could not check it against what AI read.`;
      }
    },
  );

  return mdText`**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace changes it did not read:
${FeedMarkdown.bulletList(items)}`.toString();
};
