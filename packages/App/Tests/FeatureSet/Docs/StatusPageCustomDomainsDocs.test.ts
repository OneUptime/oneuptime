import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  STATUS_PAGE_CUSTOM_DOMAIN_STATUS,
  StatusPageCustomDomainCopy,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/CustomDomain/StatusPageCustomDomainCopy";

/*
 * The English docs for status page custom domains, held to the flow they
 * describe: add the domain on one page, add the record from DNS Setup, and
 * the free certificate is issued without a button.
 *
 * They walked readers through two form steps, an Add CNAME dialog that said
 * verification "should take 24 hours", and an Order Free SSL button - and
 * called out that the timings disagreed (three hours, one hour, thirty
 * minutes). Markdown is not compiled, so nothing else notices a page that
 * still sends readers to a button that is gone. The Status column table is
 * read against the page's own copy, so the two cannot drift apart.
 *
 * English only, as earlier changes to this page did.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE: string = fs.readFileSync(
  path.join(CONTENT_DIR, "en/status-pages/branding-and-domains.md"),
  "utf8",
);

function section(from: string, to: string): string {
  const start: number = PAGE.indexOf(from);
  const end: number = PAGE.indexOf(to, start + 1);

  expect([from, start]).not.toEqual([from, -1]);
  expect([to, end]).not.toEqual([to, -1]);

  return PAGE.slice(start, end);
}

// From "## Custom domains" up to the next page section that is not about them.
const CUSTOM_DOMAINS: string = section(
  "## Custom domains",
  "## Powered by OneUptime",
);

describe("Status page custom domains (English docs)", () => {
  it("has no Order Free SSL, no Add CNAME and no Verify CNAME", () => {
    for (const gone of ["Order Free SSL", "Add CNAME", "Verify CNAME"]) {
      expect([gone, PAGE.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("no longer apologises for timings that disagree", () => {
    expect(PAGE).not.toContain("timings disagree");
    expect(PAGE).not.toContain("24 hours to automatically verify");
    expect(CUSTOM_DOMAINS).not.toMatch(/three hours|one hour|thirty minutes/);
  });

  it("gives one timing for verification and certificates: 15 minutes", () => {
    const flow: string = section(
      "## Custom domains",
      "## Reissuing a certificate",
    );

    const timings: Array<string> =
      flow.match(/\d+[ -](?:minutes?|hours?)/g) || [];

    expect(timings.length).toBeGreaterThan(0);
    expect(
      new Set(
        timings.map((timing: string) => {
          return timing.replace("-", " ");
        }),
      ),
    ).toEqual(new Set(["15 minutes", "15 minute"]));
  });

  it("sends readers to Project Settings → Domains, by its menu name", () => {
    expect(CUSTOM_DOMAINS).toContain("**Project Settings → Domains**");
    expect(PAGE).not.toContain("More → Project Settings → Custom Domains");
    expect(CUSTOM_DOMAINS).toContain(
      `**${StatusPageCustomDomainCopy.domainFieldSideLink}**`,
    );
  });

  it("describes adding a domain as one page, with the certificate under Advanced", () => {
    const adding: string = section("### Adding the domain", "## DNS Setup");

    expect(adding).toContain("The dialog is one page");
    expect(adding).not.toMatch(/two steps|\*\*Basic\*\*|\*\*More\*\*/);
    expect(adding).toContain("**Advanced**");
    expect(adding).toContain(
      StatusPageCustomDomainCopy.advancedSummaryFreeCertificate,
    );
    expect(adding).toContain("**Upload Custom Certificate**");
    expect(adding).toContain("**DNS Setup** opens");
  });

  it("walks DNS Setup and Check now", () => {
    const dnsSetup: string = section(
      "## DNS Setup and verification",
      "## SSL certificates",
    );

    for (const field of ["**Type**", "**Name**", "**Value**"]) {
      expect([field, dnsSetup.includes(field)]).toEqual([field, true]);
    }

    expect(dnsSetup).toContain("`CNAME`");
    expect(dnsSetup).toContain("copy button");
    expect(dnsSetup).toContain("**Check now**");
    expect(dnsSetup).toContain(StatusPageCustomDomainCopy.dnsSetupVerified);
    expect(dnsSetup).toContain("ALIAS, ANAME or CNAME flattening");
  });

  it("says the free certificate needs no button", () => {
    const certificates: string = section(
      "## SSL certificates",
      "## Reissuing a certificate",
    );

    expect(certificates).toContain("There is nothing to click");
    expect(certificates).toContain("Let's Encrypt");
  });

  it("keeps Reissue SSL, and says when it appears", () => {
    const reissue: string = section(
      "## Reissuing a certificate",
      "## Reading the domain Status column",
    );

    expect(reissue).toContain("**Reissue SSL**");
    expect(reissue).toContain(
      "which happens on its own once its CNAME record is verified",
    );
  });

  it("reads the Status column exactly as the page writes it", () => {
    const table: string = section(
      "## Reading the domain Status column",
      "## Powered by OneUptime",
    );

    const rows: Array<string> = table
      .split("\n")
      .filter((line: string): boolean => {
        return (
          line.startsWith("| ") &&
          !line.startsWith("| What the") &&
          !line.startsWith("| ---")
        );
      })
      .map((line: string): string => {
        return line.split("|")[1]!.trim();
      });

    expect(rows.sort()).toEqual(
      Object.values(STATUS_PAGE_CUSTOM_DOMAIN_STATUS).sort(),
    );
    expect(table).not.toContain("Action Required");
  });
});
