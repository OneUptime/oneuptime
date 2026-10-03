import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainCopy,
  DASHBOARD_CUSTOM_DOMAIN_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";

/*
 * The English dashboards guide's custom domains section, held to the flow it
 * describes - the same one as a status page's: add the domain on one page,
 * add the record from DNS Setup, and Check now orders the free certificate.
 *
 * It sent readers to "the Add CNAME action on the domain's row", to "Verify
 * CNAME in the Add CNAME dialog" and to "Order Free SSL", all of which are
 * gone. Markdown is not compiled, so nothing else notices a guide that still
 * sends readers to buttons that are gone. The Status column table is read
 * against the page's own copy, so the two cannot drift apart.
 *
 * English only, as earlier changes to this page did.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE: string = fs.readFileSync(
  path.join(CONTENT_DIR, "en/dashboards/sharing.md"),
  "utf8",
);

function section(from: string, to: string): string {
  const start: number = PAGE.indexOf(from);
  const end: number = PAGE.indexOf(to, start + 1);

  expect([from, start]).not.toEqual([from, -1]);
  expect([to, end]).not.toEqual([to, -1]);

  return PAGE.slice(start, end);
}

// From "## Custom domains" up to the next section of the page.
const CUSTOM_DOMAINS: string = section("## Custom domains", "## Branding");

describe("Dashboard custom domains (English docs)", () => {
  it("has no Order Free SSL, no Add CNAME and no Verify CNAME", () => {
    for (const gone of ["Order Free SSL", "Add CNAME", "Verify CNAME"]) {
      expect([gone, PAGE.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("finds the page where the dashboard's side menu has it", () => {
    expect(CUSTOM_DOMAINS).toContain("**Branding → Custom Domains**");
    expect(CUSTOM_DOMAINS).toContain(
      "It works exactly like a status page's **Custom Domains** page.",
    );
  });

  it("gives one timing for verification and certificates: 15 minutes", () => {
    const flow: string = section(
      "## Custom domains",
      "### Your own certificate, and reissuing",
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

  it("describes adding a domain as one page, from verified domains, with the certificate under Advanced", () => {
    const adding: string = section(
      "### Adding the domain",
      "### DNS Setup and Check now",
    );

    expect(adding).toContain("Click **Create Dashboard Domain**.");
    expect(adding).toContain("The dialog is one page");
    expect(adding).not.toMatch(/two steps|\*\*Basic\*\*|\*\*More\*\*/);
    expect(adding).toContain(
      `placeholder \`${DASHBOARD_CUSTOM_DOMAIN_COPY.subdomainPlaceholder}\``,
    );
    expect(adding).toContain("**Project Settings → Domains**");
    expect(adding).toContain(`**${CustomDomainCopy.domainFieldSideLink}**`);
    expect(adding).toContain("**Advanced**");
    expect(adding).toContain(CustomDomainCopy.advancedSummaryFreeCertificate);
    expect(adding).toContain("**DNS Setup** opens");
  });

  it("walks DNS Setup and Check now, which orders the certificate", () => {
    const dnsSetup: string = section(
      "### DNS Setup and Check now",
      "### Reading the Status column",
    );

    for (const field of ["**Type**", "**Name**", "**Value**"]) {
      expect([field, dnsSetup.includes(field)]).toEqual([field, true]);
    }

    expect(dnsSetup).toContain("`CNAME`");
    expect(dnsSetup).toContain("copy button");
    expect(dnsSetup).toContain("**Check now**");
    expect(dnsSetup).toContain(CustomDomainCopy.dnsSetupVerified);
    expect(dnsSetup).toContain(
      "The free certificate is ordered at that moment",
    );
    expect(dnsSetup).toContain("ALIAS, ANAME or CNAME flattening");
    expect(dnsSetup).toContain("orders at most once per domain every 15 minutes");
  });

  it("says the free certificate needs no button", () => {
    expect(CUSTOM_DOMAINS).toContain("There is no button to press.");
    expect(CUSTOM_DOMAINS).toContain(
      "it orders the domain's free Let's Encrypt certificate in the same check",
    );
  });

  it("reads the Status column exactly as the page writes it", () => {
    const table: string = section(
      "### Reading the Status column",
      "### Your own certificate, and reissuing",
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

    expect(rows.sort()).toEqual(Object.values(CUSTOM_DOMAIN_STATUS).sort());
    expect(table).not.toContain("Action Required");
  });

  it("keeps Reissue SSL and the uploaded certificate, and says how custom domains are switched on", () => {
    const rest: string = section(
      "### Your own certificate, and reissuing",
      "## Branding",
    );

    expect(rest).toContain("**Upload Custom Certificate**");
    expect(rest).toContain("**Reissue SSL**");
    expect(rest).toContain("once every 24 hours");
    expect(rest).toContain("`DASHBOARD_CNAME_RECORD`");
    expect(rest).toContain("`dashboard.cnameRecord`");
    expect(rest).toContain(
      "Custom Domains not enabled for this OneUptime installation",
    );
  });
});
