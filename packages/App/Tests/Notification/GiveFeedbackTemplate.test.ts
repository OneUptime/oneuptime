import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { decodeHtmlEntities } from "Common/Tests/Helpers/HtmlText";
import { buildGiveFeedbackEmail } from "Common/Server/Utils/GiveFeedbackEmail";
import EmailMessage from "Common/Types/Email/EmailMessage";
import {
  GiveFeedbackCategory,
  ONEUPTIME_SUPPORT_EMAIL,
} from "Common/Types/ProductFeedback/ProductFeedback";
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
 * GiveFeedback.hbs - WHAT A PERSON WROTE IN GIVE FEEDBACK, TO THE TEAM THAT
 * READS IT (issue #8893).
 *
 * The server (Common/Server/Utils/GiveFeedbackEmail.ts) sends one to the
 * OneUptime team on OneUptime Cloud, or to a self-hosted server's admins,
 * with the person copied, so the same email reads right in both inboxes.
 * Everything in it but its own words is the person's or their project's, so
 * the template puts each value on a plainText row - escaped by Handlebars -
 * and what they wrote through blockText, which the server escapes line by
 * line before it adds a <br/> between them.
 *
 * The variables are the ones the server's builder sends
 * (buildGiveFeedbackEmail), so the two cannot drift apart.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const templateSource: () => string = (): string => {
  return fs.readFileSync(
    Path.join(TEMPLATES_DIR, EmailTemplateType.GiveFeedback),
    "utf8",
  );
};

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const emailFor: (overrides?: {
  name?: string;
  details?: string;
  project?: { id: string; name: string } | null;
  version?: string;
}) => EmailMessage = (overrides?: {
  name?: string;
  details?: string;
  project?: { id: string; name: string } | null;
  version?: string;
}): EmailMessage => {
  return buildGiveFeedbackEmail({
    to: ONEUPTIME_SUPPORT_EMAIL,
    email: {
      category: GiveFeedbackCategory.Broken,
      details:
        overrides?.details ??
        "The SLO page shows no budget.\nIt did yesterday.",
      page: "/dashboard/:projectId/slos",
      version: overrides?.version ?? "14.3.0",
      person: {
        name: overrides?.name ?? "Ada Lovelace",
        email: "ada@acme.test",
        isEmailVerified: true,
      },
      project:
        overrides?.project === undefined
          ? { id: PROJECT_ID, name: "Acme Production" }
          : overrides.project,
    },
  });
};

const render: (email?: EmailMessage) => string = (
  email: EmailMessage = emailFor(),
): string => {
  return Handlebars.compile(templateSource())({
    year: "2026",
    ...email.vars,
  });
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

describe("the Give Feedback email", () => {
  test("is the template the server names", () => {
    expect(EmailTemplateType.GiveFeedback).toBe("GiveFeedback.hbs");
    expect(emailFor().templateType).toBe(EmailTemplateType.GiveFeedback);
    expect(
      fs.existsSync(Path.join(TEMPLATES_DIR, EmailTemplateType.GiveFeedback)),
    ).toBe(true);
  });

  test("says whose feedback it is in its one heading", () => {
    const headings: Array<EmailElement> = findElements(
      markupOf(render()).root,
      (element: EmailElement): boolean => {
        return element.name === "h1";
      },
    );

    expect(headings).toHaveLength(1);
    expect(decodeHtmlEntities(textOf(headings[0]!)).trim()).toBe(
      "Feedback from Ada Lovelace",
    );
  });

  test("says where it came from, and that the writer is copied and replied to", () => {
    expect(decodeHtmlEntities(render())).toContain(
      "Sent with Give Feedback. The person who wrote it is copied on this email, and a reply goes to them.",
    );
  });

  test("its own words never name the product: it reads right on an installation that goes by another name", () => {
    const words: string = templateSource().replace(
      /\{\{!--[\s\S]*?--\}\}/g,
      "",
    );

    expect(words).not.toMatch(/OneUptime/);
  });

  test("shows what it is about first, then what they wrote, who, where and on which version", () => {
    expect(rowValues(render())).toEqual({
      "What it is about": "Something's broken",
      "What they wrote": "The SLO page shows no budget.It did yesterday.",
      Name: "Ada Lovelace",
      Email: "ada@acme.test",
      Project: "Acme Production",
      "Project ID": PROJECT_ID,
      Page: "/dashboard/:projectId/slos",
      Version: "14.3.0",
    });

    const card: DetailCard = detailCards(markupOf(render()))[0]!;

    expect(
      card.rows.map((row: DetailCardRow): string => {
        return row.label;
      }),
    ).toEqual([
      "What it is about",
      "What they wrote",
      "Name",
      "Email",
      "Project",
      "Project ID",
      "Page",
      "Version",
    ]);
    expect(card.strayElements).toEqual([]);
    expect(dividersOnlyBetweenRows(card)).toBe(true);
  });

  test("keeps what they wrote on its own lines", () => {
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

  test("leaves out what it does not know: no project, no name, no version", () => {
    const html: string = render(
      emailFor({ project: null, name: "", version: "" }),
    );
    const card: DetailCard = detailCards(markupOf(html))[0]!;

    expect(
      card.rows.map((row: DetailCardRow): string => {
        return row.label;
      }),
    ).toEqual(["What it is about", "What they wrote", "Email", "Page"]);
    expect(dividersOnlyBetweenRows(card)).toBe(true);
    // Named by their address where they have no name.
    expect(decodeHtmlEntities(html)).toContain("Feedback from ada@acme.test");
  });

  test("has no button: the email's own Reply reaches the person", () => {
    expect(
      findElements(
        markupOf(render()).root,
        (element: EmailElement): boolean => {
          return element.name === "a" && hasClass(element, "st-Button-link");
        },
      ),
    ).toEqual([]);
  });

  test("writes everything as text, whatever a person typed", () => {
    const hostile: string =
      '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="https://evil.example">Reset your password</a> & {{personName}}';
    const html: string = render(
      emailFor({
        name: hostile,
        details: hostile,
        project: { id: PROJECT_ID, name: hostile },
      }),
    );
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

    // The same links and images as feedback with ordinary words draws.
    expect(activeElements(html)).toEqual(activeElements(render()));

    const values: Record<string, string> = rowValues(html);

    expect(values["Name"]).toBe(hostile);
    expect(values["Project"]).toBe(hostile);
    expect(values["What they wrote"]).toBe(hostile);
  });

  test("gives the inbox a preview line - what it is about, who and their project - that the email itself hides", () => {
    const lines: Array<EmailElement> = findElements(
      markupOf(render()).root,
      (element: EmailElement): boolean => {
        return (
          element.name === "div" &&
          (element.attributes["style"] || "").includes("display: none")
        );
      },
    );

    expect(lines).toHaveLength(1);
    expect(decodeHtmlEntities(textOf(lines[0]!)).trim()).toBe(
      "Something's broken · Ada Lovelace · Acme Production",
    );
  });
});
