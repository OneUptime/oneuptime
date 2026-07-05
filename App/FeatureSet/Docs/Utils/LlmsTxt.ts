import { ContentPath } from "./Config";
import DocsNav from "./Nav";
import { DEFAULT_DOCS_LANGUAGE } from "./I18n";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import LocalFile from "Common/Server/Utils/LocalFile";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";

/*
 * Cache TTL: 10 minutes. Docs content is static on disk per deploy, so a
 * short TTL simply guards against unbounded staleness if content is remounted.
 */
const TTL_MS: number = 10 * 60 * 1000;

interface CachedData<T> {
  data: T;
  generatedAt: number;
}

let llmsTxtCache: CachedData<string> | null = null;
let llmsFullTxtCache: CachedData<string> | null = null;

function isCacheValid<T>(cache: CachedData<T> | null): boolean {
  if (!cache) {
    return false;
  }
  const now: number = OneUptimeDate.getCurrentDate().getTime();
  return now - cache.generatedAt < TTL_MS;
}

/*
 * Nav URLs look like /docs/<category>/<page> (no language segment). Returns
 * "<category>/<page>" for internal docs links, or null for external links
 * (e.g. the Helm chart on ArtifactHub).
 */
function getDocsPagePath(url: string): string | null {
  if (!url.startsWith("/docs/")) {
    return null;
  }
  return url.slice("/docs/".length);
}

/*
 * Read the English markdown for a docs page. Mirrors the candidate lookup in
 * Index.ts (language folder first, then the legacy flat layout).
 */
async function readEnglishMarkdown(pagePath: string): Promise<string | null> {
  const candidates: Array<string> = [
    `${ContentPath}/${DEFAULT_DOCS_LANGUAGE}/${pagePath}.md`,
    // Legacy layout before translations existed (Content/<path>.md)
    `${ContentPath}/${pagePath}.md`,
  ];

  for (const candidate of candidates) {
    if (await LocalFile.doesFileExist(candidate)) {
      return LocalFile.read(candidate);
    }
  }
  return null;
}

// Base URL of this instance (e.g. https://oneuptime.com), no trailing slash.
async function getBaseUrl(): Promise<string> {
  const baseUrl: URL = await DatabaseConfig.getHomeUrl();
  return baseUrl.toString().replace(/\/$/, "");
}

// This class generates the /docs/llms.txt and /docs/llms-full.txt responses.
export default class LlmsTxtUtil {
  /*
   * llms.txt — an index of all docs pages in the llms.txt convention
   * (https://llmstxt.org). Primary links point to the raw markdown endpoint
   * since this file is meant for LLMs; the HTML page is mentioned alongside.
   */
  public static async getLlmsTxt(): Promise<string> {
    if (isCacheValid(llmsTxtCache)) {
      return llmsTxtCache!.data;
    }

    const baseUrl: string = await getBaseUrl();

    const lines: Array<string> = [];

    lines.push("# OneUptime Documentation");
    lines.push("");
    lines.push(
      "> OneUptime is an open-source observability platform: uptime monitoring, status pages, incident management, on-call, logs, metrics, traces, and dashboards.",
    );
    lines.push("");
    lines.push(
      "Every documentation page is available as raw markdown (linked below — best for LLMs) and as an HTML page. The complete documentation concatenated into a single file is available at " +
        `${baseUrl}/docs/llms-full.txt`,
    );

    for (const group of DocsNav) {
      lines.push("");
      lines.push(`## ${group.title}`);
      lines.push("");

      for (const link of group.links) {
        const pagePath: string | null = getDocsPagePath(link.url);

        if (pagePath === null) {
          // External link — no markdown version exists.
          lines.push(`- [${link.title}](${link.url})`);
          continue;
        }

        const markdownUrl: string = `${baseUrl}/docs/as-markdown/${DEFAULT_DOCS_LANGUAGE}/${pagePath}`;
        const htmlUrl: string = `${baseUrl}/docs/${DEFAULT_DOCS_LANGUAGE}/${pagePath}`;

        lines.push(
          `- [${link.title}](${markdownUrl}): raw markdown (HTML version: ${htmlUrl})`,
        );
      }
    }

    lines.push("");

    const content: string = lines.join("\n");

    llmsTxtCache = {
      data: content,
      generatedAt: OneUptimeDate.getCurrentDate().getTime(),
    };

    return content;
  }

  /*
   * llms-full.txt — the raw markdown of every English docs page concatenated
   * in DocsNav order, each preceded by a separator header. Pages whose
   * markdown file is missing (and external links) are skipped.
   */
  public static async getLlmsFullTxt(): Promise<string> {
    if (isCacheValid(llmsFullTxtCache)) {
      return llmsFullTxtCache!.data;
    }

    const baseUrl: string = await getBaseUrl();

    const parts: Array<string> = [];

    parts.push("# OneUptime Documentation");
    parts.push("");
    parts.push(
      "> Complete OneUptime documentation as a single file. A per-page index is available at " +
        `${baseUrl}/docs/llms.txt`,
    );
    parts.push("");

    for (const group of DocsNav) {
      for (const link of group.links) {
        const pagePath: string | null = getDocsPagePath(link.url);

        if (pagePath === null) {
          // External link — no markdown content to include.
          continue;
        }

        const markdown: string | null = await readEnglishMarkdown(pagePath);

        if (markdown === null) {
          // Missing file — skip this page instead of failing the response.
          continue;
        }

        const htmlUrl: string = `${baseUrl}/docs/${DEFAULT_DOCS_LANGUAGE}/${pagePath}`;

        parts.push("---");
        parts.push(`# ${link.title}`);
        parts.push(`Source: ${htmlUrl}`);
        parts.push("");
        parts.push(markdown.trim());
        parts.push("");
      }
    }

    const content: string = parts.join("\n");

    llmsFullTxtCache = {
      data: content,
      generatedAt: OneUptimeDate.getCurrentDate().getTime(),
    };

    return content;
  }
}
