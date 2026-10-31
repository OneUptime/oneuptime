import {
  FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT,
  FORM_CUSTOM_DOMAIN_PAGE_META_NAME,
} from "../../../Types/Form/FormCustomDomain";
import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * The sign-in app's index.ejs as the page of a form on its owner's own
 * domain (App/FeatureSet/Frontend/FormDomainPage.ts renders it with
 * isFormDomainPage): the form's page and nothing of OneUptime's.
 *
 *   - it carries the mark the app reads to draw the form alone - a <meta>
 *     only the server writes, and only here;
 *   - it is titled with the form's name (or the domain), escaped;
 *   - no OneUptime description, app manifest or Slack app id;
 *   - the sign-in pages themselves are as they were.
 *
 * Rendered from the real template; analytics and the theme have suites of
 * their own (AnalyticsConsentPartial, ThemeBeforeFirstPaint).
 */

const INDEX: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "views",
  "index.ejs",
);

function render(variables: Record<string, unknown>): string {
  return ejs.render(fs.readFileSync(INDEX, "utf8"), variables, {
    filename: INDEX,
  });
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

function marksOf(doc: Document): Array<string | null> {
  return Array.from(
    doc.querySelectorAll(`meta[name="${FORM_CUSTOM_DOMAIN_PAGE_META_NAME}"]`),
  ).map((meta: Element): string | null => {
    return meta.getAttribute("content");
  });
}

function titlesOf(doc: Document): Array<string> {
  return Array.from(doc.querySelectorAll("title")).map(
    (title: Element): string => {
      return title.textContent || "";
    },
  );
}

const FORM_DOMAIN_PAGE: Record<string, unknown> = {
  isFormDomainPage: true,
  formDomainPageTitle: "Report a Problem",
};

describe("a form on its own domain", () => {
  const doc: Document = documentOf(render(FORM_DOMAIN_PAGE));

  test("carries the mark the app reads, once", () => {
    expect(FORM_CUSTOM_DOMAIN_PAGE_META_NAME).toBe("oneuptime-form-domain");
    expect(marksOf(doc)).toEqual([FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT]);
  });

  test("is titled with the form's name, and only that", () => {
    expect(titlesOf(doc)).toEqual(["Report a Problem"]);
  });

  test("escapes the title it was given", () => {
    const escaped: Document = documentOf(
      render({
        isFormDomainPage: true,
        formDomainPageTitle: "</title><script>alert(1)</script>",
      }),
    );

    expect(titlesOf(escaped)).toEqual(["</title><script>alert(1)</script>"]);
    expect(
      Array.from(escaped.querySelectorAll("script")).some(
        (script: Element): boolean => {
          return (script.textContent || "").includes("alert(1)");
        },
      ),
    ).toBe(false);
  });

  test("names nothing of OneUptime's: no description, no app manifest, no Slack app id", () => {
    expect(doc.querySelector('meta[name="description"]')).toBeNull();
    expect(doc.querySelector('link[rel="manifest"]')).toBeNull();
    expect(doc.querySelector('meta[name="slack-app-id"]')).toBeNull();
  });

  test("still loads the sign-in app, which draws the form", () => {
    expect(
      doc.querySelector('script[type="module"]')?.getAttribute("src"),
    ).toBe("/accounts/dist/Index.js");
    expect(doc.querySelector('script[src="/accounts/env.js"]')).not.toBeNull();
    expect(doc.getElementById("root")).not.toBeNull();
  });

  test("anything but true is not a form's page", () => {
    for (const isFormDomainPage of ["true", 1, false, undefined]) {
      expect(
        marksOf(
          documentOf(
            render({ isFormDomainPage, formDomainPageTitle: "Report" }),
          ),
        ),
      ).toEqual([]);
    }
  });
});

describe("the sign-in pages", () => {
  const doc: Document = documentOf(render({}));

  test("carry no form mark", () => {
    expect(marksOf(doc)).toEqual([]);
  });

  test("keep their titles, description, manifest and Slack app id", () => {
    expect(titlesOf(doc)).toEqual([
      "OneUptime Accounts",
      "OneUptime | Account",
    ]);
    expect(doc.querySelector('meta[name="description"]')).not.toBeNull();
    expect(doc.querySelector('link[rel="manifest"]')).not.toBeNull();
    expect(doc.querySelector('meta[name="slack-app-id"]')).not.toBeNull();
  });
});
