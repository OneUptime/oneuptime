import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CustomDomainCopy,
  FORM_CUSTOM_DOMAIN_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  getPublicAddresses,
  PublicAddressKind,
} from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddressCopy";
import {
  FORM_DOMAIN_PAGE_HEADERS,
  FORM_DOMAIN_PAGE_PATH,
  FormDomainPageAnswer,
  getFormDomainPageAnswer,
  getFormDomainPageLocation,
} from "../../../FeatureSet/Frontend/FormDomainPage";
import FormDomain from "Common/Models/DatabaseModels/FormDomain";
import CustomDomainConflicts, {
  CustomDomainKind,
  getCustomDomainInUseMessage,
} from "Common/Server/Utils/CustomDomain/CustomDomainConflicts";
import {
  FORM_CUSTOM_DOMAIN_API_PATH,
  FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH,
} from "Common/Types/Form/FormCustomDomain";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import CertificateReissueUtil from "Common/Utils/CertificateReissue";

/*
 * The English Sharing & Security page's custom domains section, and the
 * Forms Overview's rows for it, held to what a form's custom domains do
 * (FormDomain, FormDomainService, FormCerts, Frontend/FormDomainPage).
 *
 * Markdown is not compiled, so nothing else notices a page that names a
 * button that is gone, a variable that is not read or a rule the product
 * no longer follows. The other languages are held to the English page,
 * line for line, by WorkspaceAndFormsDocsTranslations and
 * RulesSmtpFormsDocsTranslations.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function readContent(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, "en", `${page}.md`), "utf8");
}

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const SHARING: string = readContent("forms/sharing-and-security");
const OVERVIEW: string = readContent("forms/index");

// A heading's section: from the heading up to the next one of its level or above.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = heading.indexOf(" ");
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

const CUSTOM_DOMAINS: string = section(SHARING, "## Custom domains");

describe("Forms on custom domains (English docs)", () => {
  it("finds the page where the form's side menu has it, right after Share", () => {
    const menu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Forms/View/SideMenu.tsx",
    );
    const titles: Array<string> = Array.from(
      menu.matchAll(/title: "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(titles.indexOf("Custom Domains")).toBe(titles.indexOf("Share") + 1);
    expect(CUSTOM_DOMAINS).toContain(
      "open the form's **Custom Domains** page, right after **Share** in its side menu.",
    );
  });

  it("names the table's create button after its model, and the dialog's fields as it draws them", () => {
    const adding: string = section(SHARING, "### Adding the domain");

    expect(new FormDomain().singularName).toBe("Form Domain");
    expect(adding).toContain(
      `Click **Create ${new FormDomain().singularName}**.`,
    );
    expect(adding).toContain(
      `placeholder \`${FORM_CUSTOM_DOMAIN_COPY.subdomainPlaceholder}\``,
    );
    expect(adding).toContain(
      "**Project Settings** > **Advanced** > **Domains**",
    );
    expect(adding).toContain(`**${CustomDomainCopy.domainFieldSideLink}**`);
    expect(adding).toContain("**More fields**");
    expect(adding).toContain("**Upload Custom Certificate**");
  });

  it("says a domain's name and its form are fixed, as the model's columns are", () => {
    const model: FormDomain = new FormDomain();

    for (const column of ["formId", "subdomain", "domainId"]) {
      expect({
        column,
        update: model.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, update: [] });
    }

    expect(CUSTOM_DOMAINS).toContain(
      "A domain's name and its form are fixed once it is added, so **Edit** changes only its certificate",
    );
  });

  it("quotes the refusal of a name another custom domain has", () => {
    expect(CUSTOM_DOMAINS).toContain(
      `"${getCustomDomainInUseMessage("report.acme.com")}"`,
    );
  });

  it("tells the status page and dashboard guides which other kinds refuse their names, as the check does", () => {
    // A form's name is refused by every kind, other forms included.
    expect(
      CustomDomainConflicts.getKindsToCheck(CustomDomainKind.Form),
    ).toEqual([
      CustomDomainKind.StatusPage,
      CustomDomainKind.Dashboard,
      CustomDomainKind.Form,
    ]);
    expect(
      CustomDomainConflicts.getKindsToCheck(CustomDomainKind.Dashboard),
    ).toEqual([CustomDomainKind.StatusPage, CustomDomainKind.Form]);
    expect(readContent("dashboards/sharing")).toContain(
      "A name a status page or a form already uses, in any project, is refused: one domain shows one status page, dashboard or form.",
    );
    expect(
      CustomDomainConflicts.getKindsToCheck(CustomDomainKind.StatusPage),
    ).toEqual([CustomDomainKind.Dashboard, CustomDomainKind.Form]);
    expect(readContent("status-pages/branding-and-domains")).toContain(
      "A name a dashboard or a form already uses, in any project, is refused: one domain shows one status page, dashboard or form.",
    );
  });

  it("gives one timing for checks and certificates, the jobs' own: 15 minutes", () => {
    const jobs: string = readSource(
      "App/FeatureSet/Workers/Jobs/FormCerts/FormCerts.ts",
    );

    expect((jobs.match(/schedule: EVERY_FIFTEEN_MINUTE/g) || []).length).toBe(
      5,
    );
    expect(jobs).not.toMatch(/schedule: (?!EVERY_FIFTEEN_MINUTE)/);

    const dnsSetup: string = section(SHARING, "### DNS Setup and Check now");
    const timings: Array<string> =
      dnsSetup.match(/\d+[ -](?:minutes?|hours?)/g) || [];

    expect(new Set(timings)).toEqual(new Set(["15 minutes", "24 hours"]));
    expect(dnsSetup).toContain("**Check now**");
    expect(dnsSetup).toContain("**Reissue SSL**");
    expect(dnsSetup).toContain(
      `once every ${CertificateReissueUtil.COOLDOWN_IN_HOURS} hours per domain`,
    );
    expect(dnsSetup).toContain(
      "/docs/status-pages/branding-and-domains#reading-the-domain-status-column",
    );
    expect(
      readContent("status-pages/branding-and-domains").split("\n"),
    ).toContain("### Reading the domain Status column");
  });

  it("describes what the domain shows as the App serves it", () => {
    const shows: string = section(SHARING, "### What the domain shows");

    // The form at the root; any other page address sent there, query kept.
    expect(FORM_DOMAIN_PAGE_PATH).toBe("/");
    expect(getFormDomainPageAnswer("/")).toBe(FormDomainPageAnswer.Page);
    expect(getFormDomainPageAnswer("/accounts/login")).toBe(
      FormDomainPageAnswer.RedirectToPage,
    );
    expect(getFormDomainPageLocation("/anything?template=t-1")).toBe(
      "/?template=t-1",
    );
    expect(shows).toContain(
      "Every other address on the domain opens the form at its root, keeping its query",
    );
    expect(shows).toContain("no sign-in page, and no other form");

    // Never framed by another site, as the link's page is not.
    expect(FORM_DOMAIN_PAGE_HEADERS["X-Frame-Options"]).toBe("DENY");

    // Reset Link, turning the form off, and deleting or duplicating it.
    expect(shows).toContain(
      "**Reset Link** changes only the form's link on OneUptime",
    );
    expect(shows).toContain("**Accepting Submissions** off closes the form");
    expect(shows).toContain("**Duplicate Form** copies none of them");
  });

  it("lists the domains before the form's link, as the Share Link card does", () => {
    const addresses: Array<{ kind: PublicAddressKind }> = getPublicAddresses({
      domains: [
        {
          fullDomain: "report.acme.com",
          isCnameVerified: true,
          isCustomCertificate: true,
        },
      ],
      oneUptimeUrl: "https://oneuptime.com/accounts/form/key",
    });

    expect(
      addresses.map((address: { kind: PublicAddressKind }) => {
        return address.kind;
      }),
    ).toEqual([PublicAddressKind.CustomDomain, PublicAddressKind.OneUptime]);
    expect(CUSTOM_DOMAINS).toContain(
      "the **Share Link** card lists it above the form's link",
    );
  });

  it("names the variables a self-hosted installation reads, as it reads them", () => {
    const selfHosted: string = section(
      SHARING,
      "### On a self-hosted installation",
    );
    const environment: string = readSource(
      "Common/Server/EnvironmentConfig.ts",
    );

    expect(environment).toContain(
      'process.env["FORM_CNAME_RECORD"] || StatusPageCNameRecord',
    );
    expect(
      fs.readFileSync(path.join(REPO_DIR, "docker-compose.base.yml"), "utf8"),
    ).toContain("FORM_CNAME_RECORD: ${FORM_CNAME_RECORD:-}");
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds.ts",
      ),
    ).toMatch(
      /FORM_CUSTOM_DOMAINS: CustomDomainKind = \{[^}]*getCnameRecord: \(\): string => \{\s*return FormCNameRecord;\s*\},\s*cnameRecordVariable: "STATUS_PAGE_CNAME_RECORD",/,
    );

    for (const name of [
      "`STATUS_PAGE_CNAME_RECORD`",
      "`statusPage.cnameRecord`",
      "`FORM_CNAME_RECORD`",
      "`extraEnv`",
      "`LETS_ENCRYPT_ACCOUNT_KEY`",
      "`letsEncrypt.accountKey`",
    ]) {
      expect({ name, named: selfHosted.includes(name) }).toEqual({
        name,
        named: true,
      });
    }
  });

  it("names who may manage a form's domains as the model lets them, and the API's routes", () => {
    const who: string = section(SHARING, "### Who can manage domains");
    const model: FormDomain = new FormDomain();

    for (const permissions of [
      model.getCreatePermissions(),
      model.getUpdatePermissions(),
      model.getDeletePermissions(),
    ]) {
      expect(permissions).toContain(Permission.EditForm);
    }

    expect(model.getUpdatePermissions()).toContain(Permission.EditFormDomain);
    expect(who).toContain(
      `anyone with **${PermissionHelper.getTitle(Permission.EditForm)}**`,
    );
    expect(who).toContain(
      `**${PermissionHelper.getTitle(Permission.EditFormDomain)}**`,
    );
    expect(model.getCrudApiPath()?.toString()).toBe("/form-domain");
    expect(who).toContain("on `/form-domain`");

    for (const route of ["`verify-cname`", "`order-ssl`", "`reissue-ssl`"]) {
      expect(who).toContain(route);
    }
  });

  it("gives the Forms Overview the page, the permissions and the public page's routes on a domain", () => {
    expect(OVERVIEW).toContain(
      "| **Custom Domains** | The form's own domains, such as `report.acme.com`",
    );
    expect(OVERVIEW).toContain(
      "A form's custom domains are at `/api/form-domain`.",
    );
    expect(FORM_CUSTOM_DOMAIN_API_PATH).toBe("/api/form/custom-domain");
    expect(FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH).toBe(
      "/api/form/custom-domain/submit",
    );
    expect(OVERVIEW).toContain(
      `\`GET ${FORM_CUSTOM_DOMAIN_API_PATH}\` and \`POST ${FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH}\``,
    );
  });
});
