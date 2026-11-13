import { PRODUCT_FEEDBACK_GITHUB_LABEL } from "./ProductFeedback";

/*
 * A NEW GITHUB ISSUE, FILLED IN FOR A PERSON TO READ BEFORE THEY SEND IT.
 *
 * Where nothing leaves the server (a self-hosted OneUptime, an air-gapped
 * one), feedback stays with the server's admins, and the form offers to
 * tell OneUptime too: this opens GitHub's new-issue page with the title,
 * the words and the labels filled in. GitHub shows them before anything is
 * sent, and the person may change them, send them or close the tab.
 *
 * Used by "Was this page helpful?" on the docs (#6822,
 * Docs/Utils/DocsFeedback) and by Give feedback and the end of a guided
 * setup in the Dashboard (#6832, getProductFeedbackGitHubIssueUrl below).
 */

export const GITHUB_NEW_ISSUE_URL: string =
  "https://github.com/OneUptime/oneuptime/issues/new";

/*
 * GitHub reads the whole address, and refuses one much longer than this:
 * the body is cut, at a line, to keep the address under it.
 */
export const GITHUB_NEW_ISSUE_MAX_URL_LENGTH: number = 6000;

export const getNewGitHubIssueUrl: (data: {
  title: string;
  body: string;
  labels?: ReadonlyArray<string> | undefined;
}) => string = (data: {
  title: string;
  body: string;
  labels?: ReadonlyArray<string> | undefined;
}): string => {
  const labels: string =
    data.labels && data.labels.length > 0
      ? `labels=${encodeURIComponent(data.labels.join(","))}&`
      : "";
  const start: string = `${GITHUB_NEW_ISSUE_URL}?${labels}title=${encodeURIComponent(data.title)}&body=`;

  let body: string = data.body;

  while (
    start.length + encodeURIComponent(body).length >
      GITHUB_NEW_ISSUE_MAX_URL_LENGTH &&
    body.length > 0
  ) {
    const lastLine: number = body.lastIndexOf("\n");

    body =
      lastLine > 0
        ? body.slice(0, lastLine)
        : body.slice(0, Math.floor(body.length / 2));
  }

  return `${start}${encodeURIComponent(body)}`;
};

/*
 * The issue Give feedback and the end of a guided setup fill in, on a
 * self-hosted server (#6832): the first line of the person's words as the
 * title, their words, the page and the version. The issue goes to GitHub,
 * not onto a page, so it is worded here, in English, as the maintainers
 * read the issues; the words are the person's own.
 */
export const getProductFeedbackGitHubIssueUrl: (data: {
  details: string;
  page: string;
  version: string;
}) => string = (data: {
  details: string;
  page: string;
  version: string;
}): string => {
  const firstLine: string = (data.details.split("\n")[0] || "").trim();
  const title: string =
    firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;

  return getNewGitHubIssueUrl({
    title: `Feedback: ${title || "OneUptime"}`,
    body: [
      data.details.trim(),
      "",
      `Page: ${data.page}`,
      `Version: ${data.version || "unknown"}`,
      "",
    ].join("\n"),
    labels: [PRODUCT_FEEDBACK_GITHUB_LABEL],
  });
};
