import {
  InviteMessageParagraph,
  InviteMessagePart,
  toInviteMessageParagraphs,
} from "../../../Types/HelpAndSupport/InviteMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SIGN-IN SCREEN'S OWN MESSAGE, AS THE SCREEN DRAWS IT (#10865).
 *
 * Plain text in, a small safe subset out: a paragraph a line, and a whole
 * https or http link, or a whole address, as a link - its punctuation left
 * as text. Nothing else becomes a link, and every part is text the view
 * escapes, so a message can never put markup on the page.
 */

const linksOf: (
  paragraphs: Array<InviteMessageParagraph>,
) => Array<{ text: string; href: string }> = (
  paragraphs: Array<InviteMessageParagraph>,
): Array<{ text: string; href: string }> => {
  const links: Array<{ text: string; href: string }> = [];

  for (const paragraph of paragraphs) {
    for (const part of paragraph) {
      if (part.href) {
        links.push({ text: part.text, href: part.href });
      }
    }
  }

  return links;
};

const textOf: (paragraph: InviteMessageParagraph) => string = (
  paragraph: InviteMessageParagraph,
): string => {
  return paragraph
    .map((part: InviteMessagePart): string => {
      return part.text;
    })
    .join("");
};

describe("a message of the server's own", () => {
  test("each line is a paragraph, blank lines dropped, and every word kept", () => {
    const paragraphs: Array<InviteMessageParagraph> = toInviteMessageParagraphs(
      "Ask the IT service desk to invite you.\n\n  Call extension 4357.  \r\nWe answer within a day.",
    );

    expect(paragraphs.map(textOf)).toEqual([
      "Ask the IT service desk to invite you.",
      "Call extension 4357.",
      "We answer within a day.",
    ]);
  });

  test("an address becomes a mailto: link, its full stop left as text", () => {
    const paragraphs: Array<InviteMessageParagraph> = toInviteMessageParagraphs(
      "Write to it-help@example.com.",
    );

    expect(paragraphs).toEqual([
      [
        { text: "Write to " },
        {
          text: "it-help@example.com",
          href: "mailto:it-help@example.com",
          isWebLink: false,
        },
        { text: "." },
      ],
    ]);
  });

  test("an https link becomes a link that opens in a tab of its own", () => {
    expect(
      linksOf(
        toInviteMessageParagraphs(
          "Open https://help.example.com/oneuptime?team=sre to ask.",
        ),
      ),
    ).toEqual([
      {
        text: "https://help.example.com/oneuptime?team=sre",
        href: "https://help.example.com/oneuptime?team=sre",
      },
    ]);

    const link: InviteMessagePart | undefined = toInviteMessageParagraphs(
      "https://help.example.com",
    )[0]?.[0];

    expect(link).toEqual({
      text: "https://help.example.com",
      href: "https://help.example.com",
      isWebLink: true,
    });
  });

  test("brackets and quotes around a link stay text", () => {
    const paragraphs: Array<InviteMessageParagraph> = toInviteMessageParagraphs(
      '(it-help@example.com), "https://help.example.com"!',
    );

    expect(paragraphs[0]).toEqual([
      { text: "(" },
      {
        text: "it-help@example.com",
        href: "mailto:it-help@example.com",
        isWebLink: false,
      },
      { text: '), "' },
      {
        text: "https://help.example.com",
        href: "https://help.example.com",
        isWebLink: true,
      },
      { text: '"!' },
    ]);
  });

  test("several links on several lines, in order", () => {
    expect(
      linksOf(
        toInviteMessageParagraphs(
          "Email it-help@example.com or ops@example.com\nor open https://desk.example.com",
        ),
      ).map((link: { href: string }): string => {
        return link.href;
      }),
    ).toEqual([
      "mailto:it-help@example.com",
      "mailto:ops@example.com",
      "https://desk.example.com",
    ]);
  });

  test("nothing but a whole safe link or a whole address is linked", () => {
    for (const message of [
      "javascript:alert(document.cookie)",
      "data:text/html,hello",
      "ftp://files.example.com",
      "Visit help.example.com",
      "http://",
      "https://user:pass@help.example.com",
      "it-help@",
      "@example.com",
      "mailto:it-help@example.com",
    ]) {
      expect(linksOf(toInviteMessageParagraphs(message))).toEqual([]);
      // Kept as the words it was.
      expect(toInviteMessageParagraphs(message).map(textOf)).toEqual([message]);
    }
  });

  test("a link's address is only ever https, http or mailto", () => {
    const paragraphs: Array<InviteMessageParagraph> = toInviteMessageParagraphs(
      "it-help@example.com https://a.example.com http://b.example.com javascript:x JAVASCRIPT:y",
    );

    for (const link of linksOf(paragraphs)) {
      expect(link.href).toMatch(/^(https:\/\/|http:\/\/|mailto:)/);
    }

    expect(linksOf(paragraphs)).toHaveLength(3);
  });

  test("text next to text is one part", () => {
    expect(toInviteMessageParagraphs("Ask   the   desk")).toEqual([
      [{ text: "Ask   the   desk" }],
    ]);
  });

  test("an empty message, or one that is not text, has no paragraphs", () => {
    expect(toInviteMessageParagraphs("")).toEqual([]);
    expect(toInviteMessageParagraphs("\n \n")).toEqual([]);
    expect(toInviteMessageParagraphs(undefined as unknown as string)).toEqual(
      [],
    );
  });

  test("the default sentence draws as one paragraph of plain text", () => {
    expect(
      toInviteMessageParagraphs(
        "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
      ),
    ).toEqual([
      [
        {
          text: "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
        },
      ],
    ]);
  });
});
