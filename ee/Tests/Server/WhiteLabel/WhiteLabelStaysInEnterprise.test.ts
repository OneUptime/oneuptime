import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * White-labelling lives in ee/ and is advertised nowhere.
 *
 * The maintainer: "If a license is not allowed to be whitelabeled, please
 * dont even show that option ... We dont want customers to know about this
 * option." So the option exists only in the Enterprise Edition's own code,
 * and an installation learns of it only from a license that has it. Core
 * holds the schema (EnterpriseLicense.canBeWhiteLabelled, GlobalConfig's
 * branding columns - ee/ holds behaviour, not schema) and neutral branding
 * hooks that never say what they are for.
 *
 * What these pin, over the whole repository:
 *   - outside ee/, the words for it (white-label, whitelabel, WhiteLabel,
 *     canBeWhiteLabelled, white_label) appear only in the two schema files
 *     that must hold the license switch: the EnterpriseLicense model and the
 *     migration that adds it. No core code, test, view, template, locale or
 *     script names it;
 *   - the public docs, the root documents, the Helm chart and every
 *     frontend's locale files never mention white-labelling at all;
 *   - the Home site keeps only the mentions it already had, which are about
 *     STATUS PAGES (their custom branding, a public feature), never about
 *     white-labelling OneUptime itself;
 *   - no changelog or release-notes file mentions it.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

// The words for it, in every spelling code and copy use. A plain "white label" (a label coloured white) is not one.
const WHITE_LABEL_WORDS: RegExp = /white[-_]?label/i;

// The same, including the spaced spelling, for copy people read.
const WHITE_LABEL_WORDS_IN_COPY: RegExp = /white[\s_-]?label/i;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  ".git",
  "build",
  "dist",
  ".claude",
  "coverage",
  "playwright-report",
  "test-results",
]);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".ejs",
  ".hbs",
  ".html",
  ".css",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".txt",
  ".env",
  ".sh",
  ".sql",
  ".tpl",
  ".go",
  ".py",
]);

// Core's schema for the license server's switch: ee/ holds behaviour, not schema.
const SCHEMA_FILES: ReadonlyArray<string> = [
  "packages/Common/Models/DatabaseModels/EnterpriseLicense.ts",
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1800200000000-AddInstanceBranding.ts",
];

/*
 * The Home site's mentions, all about status pages: competitors charge for
 * white-label status pages, OneUptime includes them. A new line here must be
 * about status pages too, never about white-labelling OneUptime.
 */
const HOME_STATUS_PAGE_LINES: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    "packages/Home/Utils/Reviews.ts": [
      `text: "We white-label OneUptime's status pages for our clients. They see our branding, we see a unified dashboard. It's a key part of our managed services offering.",`,
      `title: "White-label for agencies",`,
    ],
    "packages/Home/Tests/ClaimsGovernance.test.ts": [
      `"White-label, password, SSO at $208-250/page",`,
    ],
    "packages/Home/Utils/ProductCompare.ts": [
      `title: "White Label",`,
      `"White-label, custom-domain status pages included rather than a $208-250 per-page add-on",`,
      `"White-label, password, SSO at $208-250/page",`,
      `"SaaS company with 150 monitors, 5 responders, and a white-label status page",`,
      `"Better Stack (140 extra monitors + 5 responders + white-label page)",`,
      `title: "White-Label Branding",`,
      `"Better Stack includes one status page, then charges for extras: about $12 per page per month for additional pages or custom CSS and JavaScript, $208-250 per page per month for white-label branding, password protection, and SSO, and $40/month for each additional 1,000 subscribers. OneUptime includes public and private status pages, custom domains with free SSL, custom branding and HTML/CSS/JS, and unlimited subscribers at no extra cost.",`,
      `"OneUptime includes several things Better Stack meters or gates behind add-ons: on-call and incident management in every paid plan (no separate responder license), unlimited status page subscribers (no $40 per 1,000), white-label custom-domain status pages (no $208-250 per-page fee), and native server and infrastructure monitoring. On top of that, OneUptime offers 1-second minimum check intervals, an open-source Apache 2.0 codebase you can audit and extend, and self-hosting on your own infrastructure.",`,
      `"Custom domain & whitelabel",`,
      `"White-labeled status pages",`,
      `description: "Full white labeling",`,
      `"Yes. Checkly launched a Communicate module with public and internal status pages and the ability to open, update, and resolve incidents from a failing check. However, branding, custom CSS, and white labeling sit behind a paid add-on, subscribers are email/RSS only, and incidents are essentially status-page updates without postmortems, action items, runbooks, or MTTR analytics. OneUptime includes unlimited subscribers, free custom domain and SSL, and a full incident lifecycle at no extra tier.",`,
    ],
  };

const toRepositoryPath: (absolutePath: string) => string = (
  absolutePath: string,
): string => {
  return path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join("/");
};

const listTextFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listTextFiles(fullPath));
      }

      continue;
    }

    if (
      TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ||
      entry.name === "Dockerfile" ||
      entry.name.endsWith(".env.example")
    ) {
      files.push(fullPath);
    }
  }

  return files;
};

// Every line of `files` that matches `pattern`, as "path:line: text".
const findMentions: (
  files: Array<string>,
  pattern: RegExp,
) => Array<{ file: string; line: number; text: string }> = (
  files: Array<string>,
  pattern: RegExp,
): Array<{ file: string; line: number; text: string }> => {
  const mentions: Array<{ file: string; line: number; text: string }> = [];

  for (const file of files) {
    const content: string = fs.readFileSync(file, "utf8");

    if (!pattern.test(content)) {
      continue;
    }

    content.split("\n").forEach((text: string, index: number) => {
      if (pattern.test(text)) {
        mentions.push({
          file: toRepositoryPath(file),
          line: index + 1,
          text: text.trim(),
        });
      }
    });
  }

  return mentions;
};

const ROOT_DIRECTORIES_OUTSIDE_EE: ReadonlyArray<string> = fs
  .readdirSync(REPOSITORY_ROOT, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return (
      entry.isDirectory() &&
      entry.name !== "ee" &&
      !SKIPPED_DIRECTORIES.has(entry.name)
    );
  })
  .map((entry: fs.Dirent): string => {
    return path.join(REPOSITORY_ROOT, entry.name);
  });

const ROOT_FILES: ReadonlyArray<string> = fs
  .readdirSync(REPOSITORY_ROOT, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isFile();
  })
  .map((entry: fs.Dirent): string => {
    return path.join(REPOSITORY_ROOT, entry.name);
  });

const FILES_OUTSIDE_EE: ReadonlyArray<string> = [
  ...ROOT_FILES,
  ...ROOT_DIRECTORIES_OUTSIDE_EE.flatMap((directory: string) => {
    return listTextFiles(directory);
  }),
];

describe("white-labelling outside ee/", () => {
  test("the scan reaches core: it reads the files the option must never appear in", () => {
    const scanned: Set<string> = new Set<string>(
      FILES_OUTSIDE_EE.map(toRepositoryPath),
    );

    for (const file of [
      "packages/Common/Server/Enterprise/EnterpriseServerModule.ts",
      "packages/Common/Types/Branding/ProductBranding.ts",
      "packages/App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePlugins.ts",
      "packages/App/FeatureSet/AdminDashboard/src/Locales/en.json",
      "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
      "packages/App/FeatureSet/Notification/Templates/Partials/Footer.hbs",
      "packages/App/FeatureSet/Docs/Content/introduction/getting-started.md",
      "README.md",
      ...SCHEMA_FILES,
    ]) {
      if (fs.existsSync(path.join(REPOSITORY_ROOT, file))) {
        expect({ file, scanned: scanned.has(file) }).toEqual({
          file,
          scanned: true,
        });
      }
    }

    expect(scanned.size).toBeGreaterThan(1000);
  });

  test("is named only in the schema of the license server's switch", () => {
    const outsideHome: Array<string> = FILES_OUTSIDE_EE.filter(
      (file: string): boolean => {
        return !toRepositoryPath(file).startsWith("packages/Home/");
      },
    );

    const mentions: Array<string> = findMentions(
      outsideHome,
      WHITE_LABEL_WORDS,
    )
      .filter((mention: { file: string }): boolean => {
        return !SCHEMA_FILES.includes(mention.file);
      })
      .map((mention: { file: string; line: number; text: string }) => {
        return `${mention.file}:${mention.line}: ${mention.text}`;
      });

    expect(mentions).toEqual([]);
  });

  test("the schema files hold the switch itself and nothing more", () => {
    for (const file of SCHEMA_FILES) {
      const content: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect(content).toContain("canBeWhiteLabelled");
    }
  });

  test("the public docs never mention white-labelling", () => {
    const docs: Array<string> = listTextFiles(
      path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet", "Docs"),
    );

    expect(docs.length).toBeGreaterThan(100);
    expect(findMentions(docs, WHITE_LABEL_WORDS_IN_COPY)).toEqual([]);
  });

  test("no frontend's locale file mentions it", () => {
    const localeFiles: Array<string> = FILES_OUTSIDE_EE.filter(
      (file: string): boolean => {
        return file.includes(`${path.sep}Locales${path.sep}`);
      },
    );

    expect(localeFiles.length).toBeGreaterThan(17);
    expect(findMentions(localeFiles, WHITE_LABEL_WORDS_IN_COPY)).toEqual([]);
  });

  test("the root documents and the Helm chart never mention it", () => {
    const files: Array<string> = [
      ...ROOT_FILES,
      ...listTextFiles(path.join(REPOSITORY_ROOT, "HelmChart")),
      ...listTextFiles(path.join(REPOSITORY_ROOT, "Docs")),
    ];

    expect(findMentions(files, WHITE_LABEL_WORDS_IN_COPY)).toEqual([]);
  });

  test("no changelog or release-notes file mentions it", () => {
    const releaseFiles: Array<string> = FILES_OUTSIDE_EE.filter(
      (file: string): boolean => {
        const name: string = path.basename(file).toLowerCase();
        return name.includes("changelog") || name.includes("release-notes");
      },
    );

    expect(findMentions(releaseFiles, WHITE_LABEL_WORDS_IN_COPY)).toEqual([]);
  });

  test("the Home site mentions only white-label STATUS PAGES, as it already did", () => {
    const homeFiles: Array<string> = listTextFiles(
      path.join(REPOSITORY_ROOT, "packages", "Home"),
    );

    const unexpected: Array<string> = findMentions(
      homeFiles,
      WHITE_LABEL_WORDS_IN_COPY,
    )
      .filter((mention: { file: string; text: string }): boolean => {
        return !(HOME_STATUS_PAGE_LINES[mention.file] || []).includes(
          mention.text,
        );
      })
      .map((mention: { file: string; line: number; text: string }) => {
        return `${mention.file}:${mention.line}: ${mention.text}`;
      });

    /*
     * A line here is new. If it is about status pages, add it to
     * HOME_STATUS_PAGE_LINES; if it is about white-labelling OneUptime
     * itself, remove it: that option is not advertised (ee/README.md,
     * "White-labelling").
     */
    expect(unexpected).toEqual([]);
  });
});

describe("ee/ says what it is", () => {
  test("ee/README.md documents white-labelling, for OneUptime's own people", () => {
    const readme: string = fs.readFileSync(
      path.join(EE_DIR, "README.md"),
      "utf8",
    );

    expect(readme).toContain("## White-labelling");
    expect(readme).toContain("canBeWhiteLabelled");
  });
});
