import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainCopy,
  STATUS_PAGE_CUSTOM_DOMAIN_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "Common/Types/CustomDomain/DnsRecordCheck";
import {
  DNS_RECORD_STATUS,
  DnsRecordCheckDescription,
  describeDnsRecordCheck,
} from "Common/Types/CustomDomain/DnsRecordCheckWords";
import { CustomDomainReadinessWords } from "Common/Types/CustomDomain/CustomDomainServerReadiness";
import { fillTemplate } from "Common/Types/Translator";
import Permission, { PermissionHelper } from "Common/Types/Permission";

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

  it("names Project Settings → Advanced → Domains by its menu names, as where the domain is added for you", () => {
    expect(CUSTOM_DOMAINS).toContain(
      "**Project Settings → Advanced → Domains**",
    );
    expect(PAGE).not.toContain("More → Project Settings → Custom Domains");
    // No longer a detour: there is no link out of the page to follow.
    expect(CUSTOM_DOMAINS).not.toContain("**Add a domain**");
    expect(CUSTOM_DOMAINS).not.toContain("opens that page in a new tab");
  });

  /*
   * Add Custom Domain asks for the address people will open, and verifies
   * the project's domain right there when it is not yet (#6835): it used
   * to ask for a subdomain and a verified domain, with a link out to
   * Project Settings to add and verify one.
   */
  it("describes Add Custom Domain: one field, the certificate under More fields, both records when the domain is new", () => {
    const adding: string = section("### Adding the domain", "## DNS Setup");

    expect(adding).toContain(`**${CustomDomainCopy.addTitle}**`);
    expect(adding).toContain("The dialog asks for one thing");
    expect(adding).toContain(`**${CustomDomainCopy.addAddressTitle}**`);
    expect(adding).toContain(
      `placeholder \`${STATUS_PAGE_CUSTOM_DOMAIN_COPY.addressPlaceholder}\``,
    );
    expect(adding).not.toMatch(/two steps|\*\*Basic\*\*|\*\*More\*\*/);
    expect(adding).not.toContain("**Subdomain**");
    expect(adding).toContain("**More fields**");
    expect(adding).toContain(CustomDomainCopy.advancedSummaryFreeCertificate);
    expect(adding).toContain("**Upload Custom Certificate**");
    expect(adding).toContain(`**${CustomDomainCopy.addSubmit}**`);
    expect(adding).toContain("**DNS Setup** opens with both records");
    expect(adding).toContain("without leaving the page");
    // The permissions' own titles, as Project Settings → Roles shows them.
    expect(adding).toContain(
      `**${PermissionHelper.getTitle(Permission.CreateProjectDomain)}**`,
    );
    expect(adding).toContain(
      `**${PermissionHelper.getTitle(Permission.EditProjectDomain)}**`,
    );
    expect(PAGE).not.toContain("Create Status Page Domain");
  });

  it("says, before you start, what a self-hosted server is checked for", () => {
    const before: string = section("### Before you start", "### Adding");

    expect(before).toContain(CustomDomainReadinessWords.notReadyTitle);
    expect(before).toContain("ports 80 and 443");
    expect(before).toContain("from the server itself");
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
    expect(dnsSetup).toContain("`TXT`");
    expect(dnsSetup).toContain("copy button");
    expect(dnsSetup).toContain("**Check now**");
    expect(dnsSetup).toContain(CustomDomainCopy.dnsSetupVerified);
    expect(dnsSetup).toContain("ALIAS, ANAME or CNAME flattening");
    expect(dnsSetup).toContain("follows the whole CNAME chain");
  });

  /*
   * "I don't understand how OneUptime reads CNAME records" (#1664): the
   * page quotes what Check now says, word for word, so a reader can match
   * the dialog to the page.
   */
  it("quotes each record's status and what Check now looked up, exactly as the dialog says them", () => {
    const dnsSetup: string = section(
      "## DNS Setup and verification",
      "## SSL certificates",
    );

    for (const outcome of [
      DnsRecordCheckOutcome.Found,
      DnsRecordCheckOutcome.WrongValue,
      DnsRecordCheckOutcome.NotFound,
      DnsRecordCheckOutcome.LookupFailed,
    ]) {
      const status: string = `**${DNS_RECORD_STATUS[outcome]}**`;
      expect([status, dnsSetup.includes(status)]).toEqual([status, true]);
    }

    const example: (extra: Partial<DnsRecordCheck>) => string = (
      extra: Partial<DnsRecordCheck>,
    ): string => {
      const description: DnsRecordCheckDescription = describeDnsRecordCheck({
        type: DnsRecordType.CNAME,
        name: "status.yourcompany.com",
        expectedValue: "oneuptime.yourcompany.com",
        foundValues: [],
        outcome: DnsRecordCheckOutcome.NotFound,
        ...extra,
      });

      return fillTemplate(
        description.lookedUp.template,
        description.lookedUp.values,
      );
    };

    for (const sentence of [
      example({}),
      example({
        outcome: DnsRecordCheckOutcome.WrongValue,
        foundValues: ["other.example.net"],
      }),
      example({ addresses: ["203.0.113.10"] }),
    ]) {
      expect([sentence, dnsSetup.includes(`"${sentence}"`)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  it("says the free certificate needs no button", () => {
    const certificates: string = section(
      "## SSL certificates",
      "## Reissuing a certificate",
    );

    expect(certificates).toContain("There is nothing to click");
    expect(certificates).toContain("Let's Encrypt");
  });

  /*
   * A domain whose order keeps failing is no longer retried every 15
   * minutes, a failure shows in the Status column, every order shares one
   * budget with renewals first, and a DNS blip during a renewal keeps the
   * certificate (custom-domain-ssl-hardening).
   */
  it("says how a failed order is shown and retried, and that renewals come first", () => {
    const certificates: string = section(
      "## SSL certificates",
      "## Reissuing a certificate",
    );

    expect(certificates).not.toContain("tries again every 15 minutes");
    expect(certificates).toContain("keeps trying on its own");
    expect(certificates).toContain("Status column says so");
    expect(certificates).toContain("renewals always come first");
    expect(certificates).toContain("the certificate keeps serving");
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

  /*
   * Dashboards -> a dashboard -> Custom Domains is under the dashboard's
   * Branding section, and works the same way: the reissue paragraph says
   * where, and sends readers to the dashboard guide.
   */
  it("sends readers to dashboard custom domains by their menu path", () => {
    const reissue: string = section(
      "## Reissuing a certificate",
      "## Reading the domain Status column",
    );

    expect(reissue).toContain(
      "**Dashboards → your dashboard → Branding → Custom Domains**",
    );
    expect(reissue).toContain("(/docs/dashboards/sharing#custom-domains)");
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

    expect(rows.sort()).toEqual(Object.values(CUSTOM_DOMAIN_STATUS).sort());
    expect(table).not.toContain("Action Required");
  });
});
