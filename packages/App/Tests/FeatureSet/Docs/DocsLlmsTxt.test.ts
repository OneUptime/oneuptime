import LlmsTxtUtil from "../../../FeatureSet/Docs/Utils/LlmsTxt";
import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { describe, expect, it, jest } from "@jest/globals";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * /docs/llms.txt is the map of the docs an AI agent reads first: it lists
 * the sidebar's sections and groups, in the sidebar's order, with each
 * page's raw Markdown and HTML address. /docs/llms-full.txt is every English
 * page in that order, in one file.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fs: typeof FileSystem = jest.requireActual("fs") as typeof FileSystem;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fs.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHomeUrl: async (): Promise<{ toString: () => string }> => {
        return {
          toString: (): string => {
            return "https://docs.example.com/";
          },
        };
      },
    },
  };
});
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    IpWhitelist: "203.0.113.10",
  };
});

const BASE: string = "https://docs.example.com";

// "## Section" and "### Group" lines.
const SECTION_OR_GROUP_HEADING: RegExp = /^#{2,3} /;

describe("llms.txt", () => {
  it("lists the sections, then their groups, in the sidebar's order", async () => {
    const text: string = await LlmsTxtUtil.getLlmsTxt();
    const headings: Array<string> = text
      .split("\n")
      .filter((line: string): boolean => {
        return SECTION_OR_GROUP_HEADING.test(line);
      });

    const expected: Array<string> = DocsNavSections.flatMap(
      (section: string): Array<string> => {
        return [
          `## ${section}`,
          ...DocsNav.filter((group: NavGroup): boolean => {
            return group.section === section;
          }).map((group: NavGroup): string => {
            return `### ${group.title}`;
          }),
        ];
      },
    );

    expect(headings).toEqual(expected);
  });

  it("links every page as raw Markdown, with its HTML page alongside", async () => {
    const text: string = await LlmsTxtUtil.getLlmsTxt();

    for (const group of DocsNav) {
      for (const link of group.links) {
        if (!link.url.startsWith("/docs/")) {
          expect(text).toContain(`- [${link.title}](${link.url})`);
          continue;
        }
        const page: string = link.url.slice("/docs/".length);
        expect(text).toContain(
          `- [${link.title}](${BASE}/docs/as-markdown/en/${page}): raw markdown (HTML version: ${BASE}/docs/en/${page})`,
        );
      }
    }
  });
});

describe("llms-full.txt", () => {
  it("has every English page, in nav order, with the placeholders filled in", async () => {
    const text: string = await LlmsTxtUtil.getLlmsFullTxt();
    let position: number = 0;

    for (const link of DocsNav.flatMap((group: NavGroup): Array<NavLink> => {
      return group.links;
    })) {
      if (!link.url.startsWith("/docs/")) {
        continue;
      }
      const source: string = `Source: ${BASE}/docs/en/${link.url.slice("/docs/".length)}`;
      const at: number = text.indexOf(source, position);

      expect({ page: link.url, found: at >= position }).toEqual({
        page: link.url,
        found: true,
      });
      position = at;
    }

    expect(text).not.toContain("{{IP_WHITELIST}}");
    expect(text).toContain("203.0.113.10");
  });
});
