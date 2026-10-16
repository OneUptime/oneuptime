import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { decodeHtmlEntities } from "Common/Tests/Helpers/HtmlText";
/*
 * The production initializer: registers concat, ifCond, ifNotCond, the
 * brand helpers and the detail card helpers on the global Handlebars.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  EmailElement,
  EmailMarkupTree,
  findElements,
  hasClass,
  readEmailMarkup,
  textOf,
} from "./Fixtures/EmailMarkupTree";
import {
  DetailCard,
  DetailCardRow,
  detailCards,
  dividersOnlyBetweenRows,
} from "./Fixtures/EmailDividers";

/*
 * ResellerInquiry.hbs - THE EMAIL THE RESELLERS PAGE'S FORM SENDS.
 *
 * The marketing site's form (Home/API/ResellerInquiryAPI.ts) sends one of
 * these to the one inbox inquiries go to. Everything in it but its own words
 * is what a visitor typed, so the template puts each value on a plainText
 * row - escaped by Handlebars - and the message through blockText, which the
 * site escapes line by line before it adds a <br/> between them
 * (Home/Utils/ResellerInquiry.ts, getMessageHtml).
 *
 * The variables below are the ones the site sends, in the shape it sends
 * them (Home's ResellerInquiry.test.ts pins that side, and
 * Home's ResellerInquiryEmailContract.test.ts holds the two to each other).
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const templateSource: () => string = (): string => {
  return fs.readFileSync(
    Path.join(TEMPLATES_DIR, EmailTemplateType.ResellerInquiry),
    "utf8",
  );
};

// What the site sends for an inquiry with every field filled in.
const SENT: Record<string, string> = {
  companyName: "Acme Korea",
  companyWebsite: "acme.co.kr",
  regions: "South Korea, Japan",
  contactName: "Jane Kim",
  contactEmail: "jane@acme.co.kr",
  messageHtml: "We resell DevOps tools.<br/>We would like to add OneUptime.",
  replyUrl: "mailto:jane@acme.co.kr?subject=Your%20reseller%20inquiry",
};

const render: (variables?: Record<string, unknown>) => string = (
  variables: Record<string, unknown> = SENT,
): string => {
  return Handlebars.compile(templateSource())({ year: "2026", ...variables });
};

const markupOf: (html: string) => EmailMarkupTree = (
  html: string,
): EmailMarkupTree => {
  return readEmailMarkup(html);
};

// A row's value as a reader sees it, by the row's label.
const rowValues: (html: string) => Record<string, string> = (
  html: string,
): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const row of findElements(
    markupOf(html).root,
    (element: EmailElement): boolean => {
      return hasClass(element, "st-DetailCard-field");
    },
  )) {
    const label: EmailElement | undefined = findElements(
      row,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-label");
      },
    )[0];
    const value: EmailElement | undefined = findElements(
      row,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-value");
      },
    )[0];

    if (label && value) {
      values[decodeHtmlEntities(textOf(label)).trim()] = decodeHtmlEntities(
        textOf(value),
      ).trim();
    }
  }

  return values;
};

beforeAll(() => {
  // The production initializer's own partial reads are asynchronous.
  for (const file of fs.readdirSync(PARTIALS_DIR)) {
    if (file.endsWith(".hbs")) {
      Handlebars.registerPartial(
        file.slice(0, -4),
        fs.readFileSync(Path.join(PARTIALS_DIR, file), "utf8"),
      );
    }
  }
});

describe("the reseller inquiry email", () => {
  test("is the template the site names", () => {
    expect(EmailTemplateType.ResellerInquiry).toBe("ResellerInquiry.hbs");
    expect(
      fs.existsSync(
        Path.join(TEMPLATES_DIR, EmailTemplateType.ResellerInquiry),
      ),
    ).toBe(true);
  });

  test("says what it is in its one heading", () => {
    const headings: Array<EmailElement> = findElements(
      markupOf(render()).root,
      (element: EmailElement): boolean => {
        return element.name === "h1";
      },
    );

    expect(headings).toHaveLength(1);
    expect(decodeHtmlEntities(textOf(headings[0]!)).trim()).toBe(
      "New reseller inquiry",
    );
  });

  test("says where it came from, and how to answer", () => {
    expect(decodeHtmlEntities(render())).toContain(
      "A company asked to become a reseller using the form on the Resellers page of your website. Reply to them at the email address below.",
    );
  });

  test("shows every answer on its own row, in the form's order", () => {
    expect(rowValues(render())).toEqual({
      Company: "Acme Korea",
      Website: "acme.co.kr",
      "Countries or regions they sell in": "South Korea, Japan",
      Name: "Jane Kim",
      Email: "jane@acme.co.kr",
      Message: "We resell DevOps tools.We would like to add OneUptime.",
    });

    const card: DetailCard = detailCards(markupOf(render()))[0]!;

    expect(
      card.rows.map((row: DetailCardRow): string => {
        return row.label;
      }),
    ).toEqual([
      "Company",
      "Website",
      "Countries or regions they sell in",
      "Name",
      "Email",
      "Message",
    ]);
    expect(card.strayElements).toEqual([]);
    expect(dividersOnlyBetweenRows(card)).toBe(true);
  });

  test("keeps the message's line breaks", () => {
    const message: EmailElement | undefined = findElements(
      markupOf(render()).root,
      (element: EmailElement): boolean => {
        return (
          hasClass(element, "st-DetailCard-value") &&
          hasClass(element, "st-Rich")
        );
      },
    )[0];

    expect(message).toBeDefined();
    expect(
      findElements(message!, (element: EmailElement): boolean => {
        return element.name === "br";
      }),
    ).toHaveLength(1);
  });

  test("leaves out the website and message rows when they were left empty", () => {
    const html: string = render({
      ...SENT,
      companyWebsite: "",
      messageHtml: "",
    });
    const card: DetailCard = detailCards(markupOf(html))[0]!;

    expect(
      card.rows.map((row: DetailCardRow): string => {
        return row.label;
      }),
    ).toEqual([
      "Company",
      "Countries or regions they sell in",
      "Name",
      "Email",
    ]);
    expect(
      card.rows.every((row: DetailCardRow): boolean => {
        return row.showsValue;
      }),
    ).toBe(true);
    expect(dividersOnlyBetweenRows(card)).toBe(true);
  });

  test("starts a reply with its one button", () => {
    const buttons: Array<EmailElement> = findElements(
      markupOf(render()).root,
      (element: EmailElement): boolean => {
        return element.name === "a" && hasClass(element, "st-Button-link");
      },
    );

    expect(buttons).toHaveLength(1);
    expect(decodeHtmlEntities(buttons[0]!.attributes["href"] || "")).toBe(
      SENT["replyUrl"],
    );
    expect(decodeHtmlEntities(textOf(buttons[0]!)).trim()).toBe(
      "Reply by email",
    );
  });

  test("writes every answer as text, whatever a visitor typed", () => {
    const hostile: string =
      '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="https://evil.example">Reset your password</a> & {{companyName}}';
    const html: string = render({
      companyName: hostile,
      companyWebsite: hostile,
      regions: hostile,
      contactName: hostile,
      contactEmail: hostile,
      messageHtml: "",
      replyUrl: SENT["replyUrl"],
    });
    /*
     * Every link, image and script of the email, as a signature: the same
     * as an inquiry with ordinary answers draws, so nothing a visitor typed
     * became one.
     */
    const activeElements: (markup: string) => Array<string> = (
      markup: string,
    ): Array<string> => {
      return findElements(
        markupOf(markup).root,
        (element: EmailElement): boolean => {
          return ["a", "img", "script", "iframe", "form"].includes(
            element.name,
          );
        },
      ).map((element: EmailElement): string => {
        return `${element.name} ${element.attributes["href"] || element.attributes["src"] || ""}`;
      });
    };

    expect(activeElements(html)).toEqual(
      activeElements(render({ ...SENT, messageHtml: "" })),
    );

    const values: Record<string, string> = rowValues(html);

    for (const label of [
      "Company",
      "Website",
      "Countries or regions they sell in",
      "Name",
      "Email",
    ]) {
      expect(values[label]).toBe(hostile);
    }
  });

  test("places a value's {{ }} as written, never as part of the template", () => {
    expect(
      rowValues(render({ ...SENT, companyName: "{{contactEmail}} Ltd" }))[
        "Company"
      ],
    ).toBe("{{contactEmail}} Ltd");
  });

  test("names no product in its own words, so a renamed installation's inbox reads true", () => {
    const words: string = templateSource()
      .split("{{!--")
      .map((part: string, index: number): string => {
        return index === 0 ? part : part.slice(part.indexOf("--}}") + 4);
      })
      .join("");

    expect(words).not.toContain("OneUptime");
  });
});
