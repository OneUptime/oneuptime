import {
  PermissionPlaceholder,
  getGranularPermissionCount,
  getGranularTablesMarkdown,
  getPermissionGroupCount,
  getRoleTablesMarkdown,
  getRolePermissionCount,
  getScopeExemptRolesMarkdown,
} from "./PermissionsTable";
import { DEFAULT_DOCS_LANGUAGE } from "./I18n";
import { AppVersion, IpWhitelist } from "Common/Server/EnvironmentConfig";
import fs from "fs";
import path from "path";

/*
 * Server-side substitution of `{{TOKEN}}` placeholders in docs markdown.
 *
 * Some docs content cannot be written down: the IP allow-list depends on this
 * instance's configuration, and the permission tables are generated from
 * Common/Types/Permission.ts so they can never drift from the product. Pages
 * embed a placeholder and this module fills it in at render time.
 *
 * Substitution is allow-listed, not a blanket `{{...}}` sweep. Docs pages
 * legitimately contain other double-brace tokens as *content* — the website
 * monitor page documents `{{timestamp}}`, the workflow pages document
 * `{{variable}}` syntax — and those must survive untouched.
 *
 * Every path that serves docs markdown (the HTML page, the raw markdown
 * endpoints, llms-full.txt) runs content through here. When only the HTML page
 * did, the markdown endpoints served a literal `{{IP_WHITELIST}}` to whoever
 * asked for the raw file.
 */

export const IP_WHITELIST_PLACEHOLDER: string = "{{IP_WHITELIST}}";

/*
 * The Terraform provider's version tracks the platform's: provider 14.x is
 * generated from OneUptime 14.x. Written down, the constraint in the
 * Terraform pages went stale - they kept recommending ~> 11.0 three majors
 * later, which installs a provider that old - so it is filled in from the
 * version of the OneUptime that serves the page. A self-hosted instance's
 * docs therefore recommend the provider that matches it.
 */
export const TERRAFORM_PROVIDER_VERSION_PLACEHOLDER: string =
  "{{TERRAFORM_PROVIDER_VERSION}}";
export const TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER: string =
  "{{TERRAFORM_PROVIDER_MAJOR}}";
/*
 * The range for a self-hosted OneUptime: the newest provider that is not
 * newer than the OneUptime serving the page (">= 14.0, <= 14.0.56"), the
 * range the dashboard's Developer > Terraform pages write for it.
 */
export const TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER: string =
  "{{TERRAFORM_PROVIDER_MATCHING}}";

const MAJOR_VERSION_PATTERN: RegExp = new RegExp("^v?(\\d+)\\.\\d+");
// A release's version: "14.0.56", or "v14.0.56" as a tag writes it.
const RELEASE_VERSION_PATTERN: RegExp = new RegExp(
  "^v?(\\d+)\\.(\\d+)\\.(\\d+)$",
);
// The version every development build reports, which names no release.
const DEVELOPMENT_VERSION: string = "1.0.0";

/*
 * The release's version: APP_VERSION in a built image, else the version of
 * this package (kept in step with the repository's VERSION file).
 */
function getPlatformVersion(): string | null {
  if (MAJOR_VERSION_PATTERN.test(AppVersion)) {
    return AppVersion;
  }

  let directory: string = __dirname;

  for (let depth: number = 0; depth < 8; depth++) {
    const candidate: string = path.join(directory, "package.json");

    if (fs.existsSync(candidate)) {
      try {
        const version: unknown = JSON.parse(
          fs.readFileSync(candidate, "utf-8"),
        ).version;

        if (
          typeof version === "string" &&
          MAJOR_VERSION_PATTERN.test(version)
        ) {
          return version;
        }
      } catch {
        // An unreadable package.json is skipped like a missing one.
      }
    }

    const parent: string = path.dirname(directory);

    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  return null;
}

// "14" for 14.0.21; null when there is no version to read.
export function getTerraformProviderMajorVersion(
  version: string | null = getPlatformVersion(),
): string | null {
  const match: RegExpMatchArray | null = version
    ? version.match(MAJOR_VERSION_PATTERN)
    : null;

  return match ? match[1]! : null;
}

/*
 * "~> 14.0". Without a version to read - which a deployed instance always
 * has - the newest provider, rather than a guessed major.
 */
export function getTerraformProviderVersionConstraint(
  version: string | null = getPlatformVersion(),
): string {
  const major: string | null = getTerraformProviderMajorVersion(version);

  return major ? `~> ${major}.0` : ">= 1.0";
}

/*
 * ">= 14.0, <= 14.0.56" for OneUptime 14.0.56: what the dashboard's
 * Terraform pages write for the installation they run on
 * (getTerraformProviderVersionConstraint in
 * Common/Utils/DeveloperDocs/TerraformConfig, which the docs tests hold this
 * to), so a self-hosted instance's docs name the range for that instance.
 * Without a release's version - a development build - the newest provider
 * of the major, as {{TERRAFORM_PROVIDER_VERSION}} gives.
 */
export function getTerraformProviderMatchingConstraint(
  version: string | null = getPlatformVersion(),
): string {
  const release: RegExpMatchArray | null = version
    ? version.trim().match(RELEASE_VERSION_PATTERN)
    : null;

  if (!release) {
    return getTerraformProviderVersionConstraint(version);
  }

  const plain: string = `${release[1]}.${release[2]}.${release[3]}`;

  if (plain === DEVELOPMENT_VERSION) {
    return getTerraformProviderVersionConstraint(version);
  }

  return `>= ${release[1]}.0, <= ${plain}`;
}

function getIpWhitelistMarkdown(): string {
  if (!IpWhitelist) {
    return "- No IP addresses configured.";
  }

  const lines: Array<string> = IpWhitelist.split(",")
    .map((ip: string) => {
      return `- ${ip.trim()}`;
    })
    .filter((line: string) => {
      // "- " alone means the entry was blank (trailing comma, empty segment).
      return line.length > 2;
    });

  if (lines.length === 0) {
    return "- No IP addresses configured.";
  }

  return lines.join("\n");
}

/*
 * Replaces every occurrence, not just the first. A page may reference the
 * same placeholder more than once, and `String.replace` with a string pattern
 * silently substitutes only the first — leaving the rest rendered as literal
 * braces to the reader.
 */
function replaceAll(text: string, token: string, value: string): string {
  return text.split(token).join(value);
}

export default class DocsPlaceholders {
  /*
   * `lang` selects the locale for the generated tables' chrome (column
   * headers, yes/no). Permission titles and descriptions themselves come from
   * Common/Types/Permission.ts and are English in every locale, exactly as
   * they appear in the dashboard UI — a reader comparing the docs to their
   * screen sees the same strings.
   */
  public static render(
    markdown: string,
    lang: string = DEFAULT_DOCS_LANGUAGE,
  ): string {
    if (!markdown) {
      return markdown;
    }

    let content: string = markdown;

    if (content.includes(TERRAFORM_PROVIDER_VERSION_PLACEHOLDER)) {
      content = replaceAll(
        content,
        TERRAFORM_PROVIDER_VERSION_PLACEHOLDER,
        getTerraformProviderVersionConstraint(),
      );
    }

    if (content.includes(TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER)) {
      content = replaceAll(
        content,
        TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER,
        getTerraformProviderMatchingConstraint(),
      );
    }

    if (content.includes(TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER)) {
      content = replaceAll(
        content,
        TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER,
        getTerraformProviderMajorVersion() || "N",
      );
    }

    if (content.includes(IP_WHITELIST_PLACEHOLDER)) {
      content = replaceAll(
        content,
        IP_WHITELIST_PLACEHOLDER,
        getIpWhitelistMarkdown(),
      );
    }

    if (content.includes(PermissionPlaceholder.RoleTables)) {
      content = replaceAll(
        content,
        PermissionPlaceholder.RoleTables,
        getRoleTablesMarkdown(lang),
      );
    }

    if (content.includes(PermissionPlaceholder.GranularTables)) {
      content = replaceAll(
        content,
        PermissionPlaceholder.GranularTables,
        getGranularTablesMarkdown(lang),
      );
    }

    if (content.includes(PermissionPlaceholder.ScopeExemptRoles)) {
      content = replaceAll(
        content,
        PermissionPlaceholder.ScopeExemptRoles,
        getScopeExemptRolesMarkdown(lang),
      );
    }

    if (content.includes(PermissionPlaceholder.RoleCount)) {
      content = replaceAll(
        content,
        PermissionPlaceholder.RoleCount,
        getRolePermissionCount().toString(),
      );
    }

    if (content.includes(PermissionPlaceholder.TotalCount)) {
      content = replaceAll(
        content,
        PermissionPlaceholder.TotalCount,
        getGranularPermissionCount().toString(),
      );
    }

    if (content.includes(PermissionPlaceholder.GroupCount)) {
      content = replaceAll(
        content,
        PermissionPlaceholder.GroupCount,
        getPermissionGroupCount().toString(),
      );
    }

    return content;
  }
}
