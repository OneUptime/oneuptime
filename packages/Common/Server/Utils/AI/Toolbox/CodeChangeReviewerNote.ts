import {
  CodeFileUnseen,
  CodeFileUnseenFinding,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import { CodeFilePlaceholderWritten } from "../../../../Types/CodeRepository/CodeFileValuesHidden";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import {
  describeLineCount,
  describeLineRanges,
  describeLinesPronoun,
  getLinesNoLongerInHand,
  isTextNoLongerInHand,
} from "./CodeFilesSeen";
import { AIChatLineRange } from "../../../../Types/AI/AIChatRecordSeen";

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
 * another branch only, never read, read only in an earlier answer (issue
 * #6365), read earlier in the same answer and no longer in hand (issue
 * #6570), read all of and part of it no longer in hand (issue #6984),
 * read only in part (issue #6330), or not checked - and the person
 * approved it anyway. Whoever reviews it on GitHub, GitLab, Forgejo or
 * Gitea may never have seen the card, so the pull request's description
 * says it too, as Markdown: each file in a code span, so its name reads
 * as written (src/__init__.py, pages/[slug].tsx), and for a file read in
 * part, the lines AI never saw, where its diff may drop code, apart from
 * the lines it read earlier and no longer had, which it wrote from memory;
 * and for a file whose version writes placeholders in place of values
 * hidden from AI (issue #6364), each placeholder and its lines, where the
 * real values belong. The heading says "or no longer had" when a file was
 * read and no longer had: never "did not read" alone of what AI read.
 * Null when the card said nothing.
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
      const noLongerInHand: Array<AIChatLineRange> =
        getLinesNoLongerInHand(finding);

      switch (finding.unseen) {
        case CodeFileUnseen.ChangedSinceRead:
          return mdText`${file}: changed on ${base} after AI read it.`;
        case CodeFileUnseen.ReadOnAnotherBranch:
          return finding.readOnBranch
            ? mdText`${file}: AI read it on ${FeedMarkdown.code(finding.readOnBranch)}, and it is different on ${base}.`
            : mdText`${file}: AI read it on another branch, and it is different on ${base}.`;
        case CodeFileUnseen.NotRead:
          return mdText`${file}: AI did not read it before writing it.`;
        case CodeFileUnseen.ReadInEarlierAnswer:
          return mdText`${file}: AI read it in an earlier answer and no longer had its text when it wrote the whole file.`;
        case CodeFileUnseen.ReadEarlierInThisAnswer:
          return mdText`${file}: AI read it earlier in the same answer and no longer had its text when it wrote the whole file.`;
        case CodeFileUnseen.PartNoLongerInHand:
          return finding.lineCount !== undefined && noLongerInHand.length > 0
            ? mdText`${file}: AI read ${describeLineRanges(noLongerInHand)} of its ${describeLineCount(finding.lineCount)} earlier and no longer had ${describeLinesPronoun(noLongerInHand)} when it wrote the whole file.`
            : mdText`${file}: AI read it earlier and no longer had part of its text when it wrote the whole file.`;
        case CodeFileUnseen.ReadInPart:
          return finding.lineCount !== undefined && finding.linesNotRead
            ? noLongerInHand.length > 0
              ? mdText`${file}: AI did not read ${describeLineRanges(finding.linesNotRead)} of its ${describeLineCount(finding.lineCount)} before writing the whole file, and it read ${describeLineRanges(noLongerInHand)} earlier and no longer had ${describeLinesPronoun(noLongerInHand)}.`
              : mdText`${file}: AI did not read ${describeLineRanges(finding.linesNotRead)} of its ${describeLineCount(finding.lineCount)} before writing the whole file.`
            : mdText`${file}: AI read only part of it before writing the whole file.`;
        case CodeFileUnseen.ValuesHidden:
          return finding.placeholdersWritten &&
            finding.placeholdersWritten.length > 0
            ? mdText`${file}: AI's version writes ${FeedMarkdown.join(
                finding.placeholdersWritten.map(
                  (written: CodeFilePlaceholderWritten): MarkdownText => {
                    return mdText`${FeedMarkdown.code(written.placeholder)} on ${describeLineRanges(written.lines)}`;
                  },
                ),
                "; ",
              )}, placeholders for values hidden from AI, where the real values belong.`
            : mdText`${file}: AI's version writes placeholders for values hidden from AI, where the real values belong.`;
        case CodeFileUnseen.NotChecked:
        default:
          return mdText`${file}: OneUptime could not check it against what AI read.`;
      }
    },
  );

  // A file read and no longer had is not one AI did not read (issue #6984).
  return (
    data.findings.some(isTextNoLongerInHand)
      ? mdText`**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read, or no longer had:
${FeedMarkdown.bulletList(items)}`
      : mdText`**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:
${FeedMarkdown.bulletList(items)}`
  ).toString();
};
