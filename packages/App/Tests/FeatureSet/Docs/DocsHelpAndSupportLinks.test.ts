import { LocalizedNavGroup } from "../../../FeatureSet/Docs/Utils/Nav";
import DocsFeedback, {
  DocsFeedbackMode,
  DocsPageFeedback,
} from "../../../FeatureSet/Docs/Utils/DocsFeedback";
import {
  SUPPORTED_DOCS_LANGUAGES,
  getDocsLanguageDirection,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsSiteLinks,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
  getDocsSiteLinks,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import path from "path";

/*
 * THE DOCS FOLLOW THIS SERVER'S HELP AND SUPPORT SETTINGS (#10940).
 *
 * Every docs page links to OneUptime's GitHub three ways: the header's
 * GitHub, "Edit on GitHub" under the article, and the issue a no to "Was
 * this page helpful?" offers. Where a server's admins hid Report a Bug or
 * Request a Feature (Admin Dashboard > Settings > Help and Support), none
 * is drawn, and the question is not asked where its answer would go nowhere.
 * A page rendered without the server's links - on OneUptime Cloud, and on
 * every server that never changed the page - links to what it always did.
 */

const VIEWS_ROOT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Views",
);

const HEADER_GITHUB: string = 'href="https://github.com/oneuptime/oneuptime"';
const EDIT_ON_GITHUB: string =
  "https://github.com/OneUptime/oneuptime/tree/main/packages/App/FeatureSet/Docs/Content/";
const FEEDBACK_GITHUB: string = "data-feedback-github";
// The question's own element: the page's script names its data attribute too.
const FEEDBACK_BOX: string = '<section class="docs-feedback"';

const GITHUB_HIDDEN: DocsSiteLinks = getDocsSiteLinks(
  {
    ...getDefaultHelpAndSupportSettings(),
    [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
  },
  { isSignedIn: false },
);

const DEFAULTS: DocsSiteLinks = getDocsSiteLinks(
  getDefaultHelpAndSupportSettings(),
  { isSignedIn: false },
);

const feedbackFor: (
  mode: DocsFeedbackMode,
  isGitHubShown: boolean,
) => DocsPageFeedback | null = (
  mode: DocsFeedbackMode,
  isGitHubShown: boolean,
): DocsPageFeedback | null => {
  return DocsFeedback.getPageFeedback({
    page: "self-hosted/help-and-support",
    title: "Help and Support",
    lang: "en",
    mode: mode,
    isGitHubShown: isGitHubShown,
  });
};

// A docs view, with the locals its route passes it.
const render: (
  template: string,
  locals: Record<string, unknown>,
  lang?: string,
) => Promise<string> = async (
  template: string,
  locals: Record<string, unknown>,
  lang: string = "en",
): Promise<string> => {
  const nav: Array<LocalizedNavGroup> = getLocalizedNav(lang);
  const category: LocalizedNavGroup = nav.find(
    (group: LocalizedNavGroup): boolean => {
      return group.key === "Self Hosted";
    },
  )!;

  return (await ejs.renderFile(path.join(VIEWS_ROOT, template), {
    t: makeT(lang),
    lang: lang,
    dir: getDocsLanguageDirection(lang),
    supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
    enableGoogleTagManager: false,
    nav: nav,
    category: category,
    link: template === "Index.ejs" ? category.links[0] : null,
    content: "<h2 id='one'>One</h2>",
    githubPath: "self-hosted/help-and-support",
    currentPath: category.links[0]!.url,
    prevLink: null,
    nextLink: null,
    ...locals,
  })) as string;
};

describe("a docs page on a server that never changed Help and Support", () => {
  test.each([
    ["rendered without the server's links", {}],
    ["rendered with them on their defaults", { helpLinks: DEFAULTS }],
    ["rendered with no answer from the server", { helpLinks: null }],
  ])(
    "%s: the header's GitHub, Edit on GitHub and a no's GitHub issue",
    async (_name: string, locals: Record<string, unknown>) => {
      const html: string = await render("Index.ejs", {
        ...locals,
        feedback: feedbackFor(DocsFeedbackMode.Local, true),
      });

      expect(html).toContain(HEADER_GITHUB);
      expect(html).toContain(EDIT_ON_GITHUB);
      expect(html).toContain(FEEDBACK_GITHUB);
    },
  );

  test("the 404 page keeps the header's GitHub too", async () => {
    expect(await render("NotFound.ejs", {})).toContain(HEADER_GITHUB);
    expect(await render("NotFound.ejs", { helpLinks: DEFAULTS })).toContain(
      HEADER_GITHUB,
    );
  });
});

describe("a docs page on a server whose admins hid OneUptime's GitHub", () => {
  test("has no GitHub in its header, and no Edit on GitHub", async () => {
    const html: string = await render("Index.ejs", {
      helpLinks: GITHUB_HIDDEN,
      feedback: feedbackFor(DocsFeedbackMode.Keep, false),
    });

    expect(html).not.toContain(HEADER_GITHUB);
    expect(html).not.toContain(EDIT_ON_GITHUB);
    expect(html).not.toContain("github.com");
  });

  test("still asks Was this page helpful? where the answer is kept, with no GitHub issue after a no", async () => {
    const html: string = await render("Index.ejs", {
      helpLinks: GITHUB_HIDDEN,
      feedback: feedbackFor(DocsFeedbackMode.Keep, false),
    });

    expect(html).toContain(FEEDBACK_BOX);
    expect(html).toContain('data-feedback-reason="unclear"');
    expect(html).not.toContain(FEEDBACK_GITHUB);
  });

  test("still asks where the answer is sent to product analytics, with no GitHub issue", async () => {
    const html: string = await render("Index.ejs", {
      helpLinks: GITHUB_HIDDEN,
      feedback: feedbackFor(DocsFeedbackMode.Send, false),
    });

    expect(html).toContain(FEEDBACK_BOX);
    expect(html).not.toContain(FEEDBACK_GITHUB);
  });

  test("asks nothing where nothing would be posted and there is no GitHub to tell", async () => {
    expect(feedbackFor(DocsFeedbackMode.Local, false)).toBeNull();

    const html: string = await render("Index.ejs", {
      helpLinks: GITHUB_HIDDEN,
      feedback: feedbackFor(DocsFeedbackMode.Local, false),
    });

    expect(html).not.toContain(FEEDBACK_BOX);
  });

  test("its 404 page has no GitHub in its header", async () => {
    expect(
      await render("NotFound.ejs", { helpLinks: GITHUB_HIDDEN }),
    ).not.toContain(HEADER_GITHUB);
  });

  test.each(
    SUPPORTED_DOCS_LANGUAGES.map((language: { code: string }): string => {
      return language.code;
    }),
  )("in %s, none of the three GitHub links is drawn", async (lang: string) => {
    const html: string = await render(
      "Index.ejs",
      {
        helpLinks: GITHUB_HIDDEN,
        feedback: feedbackFor(DocsFeedbackMode.Keep, false),
      },
      lang,
    );

    expect(html).not.toContain(HEADER_GITHUB);
    expect(html).not.toContain(EDIT_ON_GITHUB);
    expect(html).not.toContain(FEEDBACK_GITHUB);
  });
});

describe("what Was this page helpful? offers (DocsFeedback.getPageFeedback)", () => {
  test("GitHub shown: the issue, written for the page, in every mode", () => {
    for (const mode of [
      DocsFeedbackMode.Local,
      DocsFeedbackMode.Keep,
      DocsFeedbackMode.Send,
    ]) {
      const feedback: DocsPageFeedback | null = feedbackFor(mode, true);

      expect(feedback).toEqual({
        page: "self-hosted/help-and-support",
        mode: mode,
        githubIssueUrl: DocsFeedback.getGitHubIssueUrl({
          page: "self-hosted/help-and-support",
          title: "Help and Support",
          lang: "en",
        }),
      });
    }
  });

  test("GitHub hidden: no issue, and no question where nothing would hear the answer", () => {
    expect(feedbackFor(DocsFeedbackMode.Local, false)).toBeNull();
    expect(feedbackFor(DocsFeedbackMode.Keep, false)).toEqual({
      page: "self-hosted/help-and-support",
      mode: DocsFeedbackMode.Keep,
      githubIssueUrl: null,
    });
    expect(feedbackFor(DocsFeedbackMode.Send, false)).toEqual({
      page: "self-hosted/help-and-support",
      mode: DocsFeedbackMode.Send,
      githubIssueUrl: null,
    });
  });
});
