import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FEED_ATTACHMENT_ROUTES_NOT_SERVED,
  FEED_ATTACHMENT_ROUTES_SERVED,
} from "../../../Server/Utils/Feed/FeedAttachmentLinks";

/*
 * Every attachment link a feed entry carries leads to a route that serves it.
 *
 * A note's feed entry lists its files as links (FileAttachmentMarkdownUtil).
 * In November 2025 the download routes gained the project id the reader's
 * access is checked against (`${crudPath}/attachment/:projectId/:noteId/
 * :fileId`, 30651f1ca7), and the feed went on writing the old address
 * without it: every attachment link in every feed was a 404 - now opened in
 * a tab of its own by the viewer, so the 404 would have been a whole tab.
 *
 * This holds the two together, for every note service that writes them:
 *
 *   - each attachment path a service passes is served: its note model's API
 *     registers the download route, with the project id first;
 *   - each service reads the note's project id and hands it over;
 *   - a service with no download route passes null, and its files are listed
 *     by name (the episodes' private notes).
 */

const COMMON: string = path.join(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON, "Server", "Services");
const API_DIR: string = path.join(COMMON, "Server", "API");
const MODELS_DIR: string = path.join(COMMON, "Models", "DatabaseModels");

const DOWNLOAD_ROUTE: string =
  "getCrudApiPath()?.toString()}/attachment/:projectId/:noteId/:fileId`";

// "/incident-internal-note/attachment" -> "/incident-internal-note".
const ATTACHMENT_PATH: RegExp = /^(\/[a-z-]+)\/attachment$/;

const WHITESPACE: RegExp = /\s+/;

// The second argument of each getAttachmentsMarkdown(...) call.
const ATTACHMENTS_CALL: RegExp =
  /this\.getAttachmentsMarkdown\([^,()]*,\s*("[^"]*"|null)/g;

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(file, "utf8");
};

// "incident-internal-note" -> "IncidentInternalNote".
const pascalCase: (kebab: string) => string = (kebab: string): string => {
  return kebab
    .split("-")
    .map((word: string): string => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
};

interface NoteService {
  file: string;
  source: string;
  // Each path a getAttachmentsMarkdown call passes, or null.
  attachmentPaths: Array<string | null>;
}

const NOTE_SERVICES: Array<NoteService> = fs
  .readdirSync(SERVICES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts");
  })
  .map((file: string): NoteService => {
    const source: string = read(path.join(SERVICES_DIR, file));

    return {
      file: file,
      source: source,
      attachmentPaths: Array.from(
        source.matchAll(ATTACHMENTS_CALL),
        (match: RegExpMatchArray): string | null => {
          return match[1] === "null" ? null : JSON.parse(match[1]!);
        },
      ),
    };
  })
  .filter((service: NoteService): boolean => {
    return service.source.includes(
      "FileAttachmentMarkdownUtil.buildAttachmentMarkdown(",
    );
  });

describe("feed attachment links", () => {
  test("the note services that write them are all read", () => {
    expect(
      NOTE_SERVICES.map((service: NoteService): string => {
        return service.file;
      }).sort(),
    ).toEqual([
      "AlertEpisodeInternalNoteService.ts",
      "AlertInternalNoteService.ts",
      "IncidentEpisodeInternalNoteService.ts",
      "IncidentEpisodePublicNoteService.ts",
      "IncidentInternalNoteService.ts",
      "IncidentPublicNoteService.ts",
      "ScheduledMaintenanceInternalNoteService.ts",
      "ScheduledMaintenancePublicNoteService.ts",
    ]);

    for (const service of NOTE_SERVICES) {
      // Once when a note is posted, once when it is edited.
      expect(`${service.file}: ${service.attachmentPaths.length}`).toBe(
        `${service.file}: 2`,
      );
    }
  });

  test("every path a feed links an attachment at is a route that serves it", () => {
    for (const service of NOTE_SERVICES) {
      for (const attachmentPath of service.attachmentPaths) {
        if (attachmentPath === null) {
          continue;
        }

        const match: RegExpExecArray | null =
          ATTACHMENT_PATH.exec(attachmentPath);

        expect(`${service.file}: ${attachmentPath} ${Boolean(match)}`).toBe(
          `${service.file}: ${attachmentPath} true`,
        );

        const crudPath: string = match![1]!;
        const modelName: string = pascalCase(crudPath.slice(1));

        // The path is the note model's own...
        expect(read(path.join(MODELS_DIR, `${modelName}.ts`))).toContain(
          `@CrudApiEndpoint(new Route("${crudPath}"))`,
        );
        expect(service.source).toContain(
          `import Model from "../../Models/DatabaseModels/${modelName}";`,
        );

        // ...and its API serves the file there, the project id first.
        const api: string = read(path.join(API_DIR, `${modelName}API.ts`));

        // However prettier wraps the call.
        expect(api.split(WHITESPACE).join("")).toContain(
          `super(${modelName},${modelName}Service`,
        );
        expect(api).toContain(DOWNLOAD_ROUTE);
      }
    }
  });

  test("each service reads the note's project id and hands it over", () => {
    for (const service of NOTE_SERVICES) {
      expect(
        `${service.file}: ${service.source.includes("projectId: noteWithAttachments.projectId,")}`,
      ).toBe(`${service.file}: true`);
      expect(service.source).toMatch(
        /findOneById\(\{\s*id: modelId,\s*select: \{\s*projectId: true,\s*attachments: \{/,
      );
    }
  });

  /*
   * Entries written before the routes took the project id keep the old
   * address; the RewriteFeedAttachmentLinks data migration rewrites them
   * (FeedAttachmentLinks) for exactly the routes the feed links today, and
   * turns the episodes' private notes' links, which never had a route,
   * into the names the feed lists today.
   */
  test("the old links rewritten are exactly the feed's own: served routes, and the episodes' private notes", () => {
    const served: Array<string> = [];

    for (const service of NOTE_SERVICES) {
      for (const attachmentPath of service.attachmentPaths) {
        const match: RegExpExecArray | null = attachmentPath
          ? ATTACHMENT_PATH.exec(attachmentPath)
          : null;

        if (match) {
          served.push(match[1]!.slice(1));
        }
      }
    }

    expect([...FEED_ATTACHMENT_ROUTES_SERVED].sort()).toEqual(
      Array.from(new Set(served)).sort(),
    );
    expect([...FEED_ATTACHMENT_ROUTES_NOT_SERVED].sort()).toEqual([
      "alert-episode-internal-note",
      "incident-episode-internal-note",
    ]);
  });

  test("a note with no download route passes none, and has no download route", () => {
    const withoutRoute: Array<string> = NOTE_SERVICES.filter(
      (service: NoteService): boolean => {
        return service.attachmentPaths.includes(null);
      },
    ).map((service: NoteService): string => {
      return service.file;
    });

    expect(withoutRoute.sort()).toEqual([
      "AlertEpisodeInternalNoteService.ts",
      "IncidentEpisodeInternalNoteService.ts",
    ]);

    for (const modelName of [
      "AlertEpisodeInternalNote",
      "IncidentEpisodeInternalNote",
    ]) {
      const apiFile: string = path.join(API_DIR, `${modelName}API.ts`);

      // When one is added, its notes' feed entries should link their files.
      expect(
        fs.existsSync(apiFile) && read(apiFile).includes(DOWNLOAD_ROUTE),
      ).toBe(false);
    }
  });
});
