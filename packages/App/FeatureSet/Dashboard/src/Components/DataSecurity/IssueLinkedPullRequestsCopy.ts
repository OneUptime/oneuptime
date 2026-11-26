import { translationKey } from "Common/Types/Translator";

/*
 * THE WORDS OF A PERSON'S OWN FIX OF AN ISSUE (#10831): Link Pull Request on
 * the issue's How to Fix card, its dialog, and the pull requests linked to
 * the issue. The words a security case's links share (#10604) are the same
 * keys, translated once: the button, the field, a pull request's state.
 */

export const LINK_PULL_REQUEST: string = translationKey("Link Pull Request");
export const LINK_ISSUE_PULL_REQUEST_DESCRIPTION: string = translationKey(
  "Your own fix for this issue. OneUptime follows it to production, as it follows OneUptime AI's fixes, and the issue counts as fixed once production shows it.",
);
export const LINK_PULL_REQUEST_FIELD_TITLE: string =
  translationKey("Pull Request URL");
export const LINK_PULL_REQUEST_FIELD_DESCRIPTION: string = translationKey(
  "Its page on a repository connected under Code: GitHub, GitLab, Forgejo or Gitea.",
);
export const LINKED_ISSUE_PULL_REQUEST_TOAST: string = translationKey(
  "Linked {{pullRequest}}. OneUptime follows it to production.",
);
export const UNLINKED_ISSUE_PULL_REQUEST_TOAST: string = translationKey(
  "Took {{pullRequest}} off this issue.",
);
export const UNLINK_ISSUE_PULL_REQUEST_LABEL: string = translationKey(
  "Take {{pullRequest}} off this issue",
);
// The linked pull requests' heading, on the How to Fix card.
export const LINKED_PULL_REQUESTS_TITLE: string = translationKey(
  "Linked pull requests",
);
export const PULL_REQUEST_LINKED_BY: string = translationKey(
  "Linked by {{name}}.",
);

// Where a linked pull request stands on its host, beside its name.
export const PULL_REQUEST_OPEN: string = translationKey("Not Merged Yet");
export const PULL_REQUEST_MERGED: string = translationKey("Merged");
export const PULL_REQUEST_CLOSED: string = translationKey("Closed");

export const ISSUE_LINKED_PULL_REQUESTS_TEST_ID: string =
  "data-security-issue-linked-pull-requests";
