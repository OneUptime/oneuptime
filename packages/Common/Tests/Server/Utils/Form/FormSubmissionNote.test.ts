import Markdown, {
  MarkdownContentType,
} from "../../../../Server/Types/Markdown";
import {
  FormNoteAnswerFormat,
  getFormSubmissionNote,
  getFormSubmitterEmailText,
} from "../../../../Server/Utils/Form/FormSubmissionNote";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { neutralizeUntrustedMarkdown } from "../../../../Utils/Markdown/UntrustedMarkdown";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../../Utils/Markdown/DashboardMarkdownRenderer";
import { describe, expect, test } from "@jest/globals";

/*
 * The private note a submission leaves on what it created: which form, who
 * sent it as far as they said, and their answers to the form's own
 * questions. It is posted as it is - to the record's feed, its Slack and
 * Microsoft Teams channels and the owners' email - so everything a stranger
 * wrote is made inert where it is placed, and the submitter's address links
 * to exactly that address in every renderer.
 */

describe("getFormSubmissionNote: who sent it", () => {
  test.each([
    [
      "a name and an email",
      { submitterName: "Jane", submitterEmail: "jane@example.com" },
      "Submitted through the form **Report a Problem** by Jane (<jane@example.com>).",
    ],
    [
      "only a name",
      { submitterName: "Jane" },
      "Submitted through the form **Report a Problem** by Jane.",
    ],
    [
      "only an email",
      { submitterEmail: "jane@example.com" },
      "Submitted through the form **Report a Problem** by <jane@example.com>.",
    ],
    [
      "neither",
      {},
      "Submitted anonymously through the form **Report a Problem**.",
    ],
    [
      "blank details",
      { submitterName: "  ", submitterEmail: null },
      "Submitted anonymously through the form **Report a Problem**.",
    ],
  ])(
    "with %s",
    (
      _label: string,
      submitter: {
        submitterName?: string | null;
        submitterEmail?: string | null;
      },
      note: string,
    ) => {
      expect(
        getFormSubmissionNote({ formName: "Report a Problem", ...submitter }),
      ).toBe(note);
    },
  );

  test("escapes the form's name too, which sits inside the note's own bold", () => {
    expect(getFormSubmissionNote({ formName: "IT ** Help_desk [EU]" })).toBe(
      "Submitted anonymously through the form **IT \\*\\* Help\\_desk \\[EU\\]**.",
    );
  });

  test("reads well without a form name", () => {
    expect(getFormSubmissionNote({ submitterName: "Jane" })).toBe(
      "Submitted through a form by Jane.",
    );
  });

  test("a name's mentions notify nobody, and its Markdown reads as typed", () => {
    const note: string = getFormSubmissionNote({
      formName: "Form",
      submitterName: "<!channel> [click](javascript:alert(1))",
    });

    expect(note).not.toContain("<!channel>");
    expect(note).not.toContain("[click](");
  });

  test("escapes a value that is not one whole address, rather than linking it", () => {
    expect(
      getFormSubmissionNote({
        formName: "Form",
        submitterEmail: "Jane <jane@example.com>",
      }),
    ).toBe(
      "Submitted through the form **Form** by Jane \\<jane@example.com\\>.",
    );
  });

  test("getFormSubmitterEmailText: an autolink, an explicit link, an escape or nothing", () => {
    expect(getFormSubmitterEmailText({ email: "jane@example.com" })).toBe(
      "<jane@example.com>",
    );
    expect(getFormSubmitterEmailText({ email: "a#b@example.com" })).toBe(
      "[a\\#b@example.com](mailto:a%23b@example.com)",
    );
    expect(getFormSubmitterEmailText({ email: "  " })).toBe("");
    expect(getFormSubmitterEmailText({})).toBe("");
  });
});

describe("getFormSubmissionNote: the answers", () => {
  test("each under its question, in order, after the sentence", () => {
    expect(
      getFormSubmissionNote({
        formName: "Report a Problem",
        submitterName: "Jane",
        answers: [
          {
            label: "Which office?",
            displayValue: "Berlin",
            format: FormNoteAnswerFormat.SingleLine,
          },
          {
            label: "Checked the status page",
            displayValue: "Yes",
            format: FormNoteAnswerFormat.SingleLine,
          },
        ],
      }),
    ).toBe(
      "Submitted through the form **Report a Problem** by Jane.\n\n**Which office?**  \nBerlin\n\n**Checked the status page**  \nYes",
    );
  });

  test("a multi-line answer keeps its lines, each escaped", () => {
    expect(
      getFormSubmissionNote({
        formName: "F",
        answers: [
          {
            label: "Steps",
            displayValue: "1. Add to cart\n2. Pay *now*",
            format: FormNoteAnswerFormat.MultiLine,
          },
        ],
      }),
    ).toBe(
      "Submitted anonymously through the form **F**.\n\n**Steps**  \n1. Add to cart  \n2. Pay \\*now\\*",
    );
  });

  test("a Markdown answer gets a paragraph of its own, neutralized as a description is", () => {
    const markdown: string =
      "- one\n- two\n\n![x](https://evil.example/x.png) <!here>";

    const note: string = getFormSubmissionNote({
      formName: "F",
      answers: [
        {
          label: "Details",
          displayValue: markdown,
          format: FormNoteAnswerFormat.Markdown,
        },
      ],
    });

    expect(note).toBe(
      `Submitted anonymously through the form **F**.\n\n**Details**\n\n${neutralizeUntrustedMarkdown(markdown).trim()}`,
    );
  });

  test("a label and a one-line answer are escaped and mention nobody", () => {
    const note: string = getFormSubmissionNote({
      formName: "F",
      answers: [
        {
          label: "**Bold** <!here>",
          displayValue: "[link](https://evil.example) <@U123>",
          format: FormNoteAnswerFormat.SingleLine,
        },
      ],
    });

    expect(note).toContain("\\*\\*Bold\\*\\*");
    expect(note).not.toContain("<!here>");
    expect(note).not.toContain("<@U123>");
    expect(note).not.toContain("[link](");
  });

  test("an empty answer is left out, and a question with no label reads Question", () => {
    expect(
      getFormSubmissionNote({
        formName: "F",
        answers: [
          {
            label: "Empty",
            displayValue: "  ",
            format: FormNoteAnswerFormat.SingleLine,
          },
          {
            label: "",
            displayValue: "42",
            format: FormNoteAnswerFormat.SingleLine,
          },
        ],
      }),
    ).toBe(
      "Submitted anonymously through the form **F**.\n\n**Question**  \n42",
    );
  });
});

/*
 * The note reaches the owners by email (rendered with marked) and the
 * record's Slack channels (slackify-markdown). Every link must be the whole
 * address the submitter gave - hyphen, underscore, plus, apostrophe or
 * hyphenated domain - and an address an autolink would not carry whole is
 * linked explicitly, percent-encoded.
 */
describe("getFormSubmissionNote: links the submitter's whole address", () => {
  const ADDRESSES: Array<string> = [
    "mary-jane.watson@corp.example",
    "first_last@company.com",
    "ops+alerts@company.com",
    "jane@my-company.com",
    "o'brien@company.com",
    "a_b+c@example.com",
  ];

  function hrefs(html: string): Array<string> {
    return Array.from(html.matchAll(/href="([^"]*)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
  }

  // Where a mail client sends a mailto: link: its path, nothing after it.
  function mailtoAddress(href: string): string {
    const link: URL = new URL(href);

    expect(link.protocol).toBe("mailto:");
    expect(link.search).toBe("");
    expect(link.hash).toBe("");

    return decodeURIComponent(link.pathname);
  }

  const SLACK_MAILTO_LINK: RegExp = /<mailto:([^|>]+)\|([^>]+)>/;

  function withoutEntities(text: string): string {
    return text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  test.each(ADDRESSES)(
    "in the owners' email and in Slack: %s",
    async (address: string) => {
      const note: string = getFormSubmissionNote({
        formName: "Report a Problem",
        submitterName: "Jane Doe",
        submitterEmail: address,
      });

      const html: string = await Markdown.convertToHTML(
        note,
        MarkdownContentType.Email,
      );

      expect(hrefs(html)).toEqual([`mailto:${address.replace(/'/g, "&#39;")}`]);

      const sections: string = JSON.stringify(
        SlackUtil.getMarkdownBlocks({
          payloadMarkdownBlock: {
            _type: "WorkspacePayloadMarkdown",
            text: note,
          },
        }),
      );

      expect(sections).toContain(
        JSON.stringify(`<mailto:${address}|${address}>`).slice(1, -1),
      );
    },
  );

  test.each([
    ["!bang@example.com"],
    ["#ops@corp.example"],
    ["a#b@example.com"],
    ["a?b@example.com"],
    ["a%41@example.com"],
    ["jane^doe@corp.example"],
    ["first.last!ops@corp.example"],
    ["a/b@example.com"],
    ["a=b@example.com"],
    ["a{b}@example.com"],
    ["a|b@example.com"],
    ["a`b@example.com"],
  ])(
    "links %s to itself, not to what a mail client would make of it",
    async (address: string) => {
      const note: string = getFormSubmissionNote({
        formName: "Report a Problem",
        submitterName: "Jane Doe",
        submitterEmail: address,
      });

      expect(note).not.toContain(`<${address}>`);

      const html: string = await Markdown.convertToHTML(
        note,
        MarkdownContentType.Email,
      );
      const links: Array<string> = hrefs(html);

      expect(links).toHaveLength(1);
      expect(mailtoAddress(links[0]!)).toBe(address);

      const slack: RegExpExecArray | null = SLACK_MAILTO_LINK.exec(
        JSON.stringify(
          SlackUtil.getMarkdownBlocks({
            payloadMarkdownBlock: {
              _type: "WorkspacePayloadMarkdown",
              text: note,
            },
          }),
        ),
      );

      expect(slack).not.toBeNull();
      expect(mailtoAddress(`mailto:${slack![1]!}`)).toBe(address);
    },
  );

  test("links an address holding any character an address may to exactly that address, in the dashboard and the email", async () => {
    const addresses: Array<string> = [];

    for (const character of "!#$%&'*+/=?^_`{|}~-") {
      addresses.push(
        `${character}jane@corp.example`,
        `ja${character}ne@corp.example`,
        `jane${character}@corp.example`,
      );
    }

    const notes: Array<string> = addresses.map((address: string): string => {
      return getFormSubmissionNote({
        formName: "Report a Problem",
        submitterName: "Jane Doe",
        submitterEmail: address,
      });
    });

    const dashboard: Array<string> = renderAsDashboard(notes);

    for (const [index, address] of addresses.entries()) {
      const email: Array<string> = hrefsOf(
        await Markdown.convertToHTML(notes[index]!, MarkdownContentType.Email),
      );

      expect({ address, email: email.map(mailtoAddress) }).toEqual({
        address,
        email: [address],
      });
      expect({
        address,
        dashboard: hrefsOf(dashboard[index]!).map(mailtoAddress),
      }).toEqual({ address, dashboard: [address] });

      const slack: RegExpExecArray | null = SLACK_MAILTO_LINK.exec(
        JSON.parse(
          JSON.stringify(
            SlackUtil.getMarkdownBlocks({
              payloadMarkdownBlock: {
                _type: "WorkspacePayloadMarkdown",
                text: notes[index]!,
              },
            }),
          ),
        )[0].text.text as string,
      );

      expect({
        address,
        slack: slack
          ? [
              mailtoAddress(`mailto:${withoutEntities(slack[1]!)}`),
              withoutEntities(slack[2]!),
            ]
          : null,
      }).toEqual({ address, slack: [address, address] });
    }
  });
});
