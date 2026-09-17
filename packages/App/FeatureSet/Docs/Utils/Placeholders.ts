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
import { IpWhitelist } from "Common/Server/EnvironmentConfig";

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
