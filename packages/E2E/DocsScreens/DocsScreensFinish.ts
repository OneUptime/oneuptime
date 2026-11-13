import fs from "fs";
import path from "path";
import {
  DOCS_SCREENS,
  DOCS_SCREEN_FIXTURES,
  DOCS_SCREEN_LANGUAGES,
  DocsScreen,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenList";
import {
  MANIFEST_PATH,
  manifestOfFiles,
  planLanguages,
  SCREEN_EXTENSION,
  screenFile,
  SCREENS_FOLDER,
  STATIC_FOLDER,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenFiles";
import {
  DocsScreensCheck,
  staleIssueBody,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenFingerprint";
import {
  LanguageResult,
  MODE,
  OUTPUT,
  pruneFingerprints,
  RESULTS,
  ShotResult,
} from "./DocsScreenRun";

/*
 * After every language has run (#6823):
 *
 *   writing    pictures of shots the list no longer has, or of languages a
 *              shot's fixture no longer draws, are deleted, and the
 *              manifest is written from the pictures on disk;
 *   checking   what the languages found is put together as one check
 *              (check.json) and the staleness issue's text (stale-issue.md),
 *              which the job on main hands to ReportStale.js.
 *
 * Either way a summary is printed: what was written or found, and the
 * bytes the pictures take.
 */

function readResults(): Array<LanguageResult> {
  if (!fs.existsSync(RESULTS)) {
    return [];
  }

  return fs
    .readdirSync(RESULTS)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): LanguageResult => {
      return JSON.parse(
        fs.readFileSync(path.join(RESULTS, file), "utf8"),
      ) as LanguageResult;
    })
    .filter((result: LanguageResult): boolean => {
      return result.mode === MODE;
    });
}

// Deletes every picture no shot in no language it is drawn in names.
function deleteOrphans(): Array<string> {
  const deleted: Array<string> = [];
  const folder: string = path.join(STATIC_FOLDER, SCREENS_FOLDER);

  for (const lang of DOCS_SCREEN_LANGUAGES) {
    const languageFolder: string = path.join(folder, lang);

    if (!fs.existsSync(languageFolder)) {
      continue;
    }

    for (const file of fs.readdirSync(languageFolder)) {
      const name: string = file.replace(
        new RegExp(`\\.${SCREEN_EXTENSION}$`),
        "",
      );
      const shot: DocsScreen | undefined = DOCS_SCREENS.find(
        (candidate: DocsScreen): boolean => {
          return candidate.name === name;
        },
      );
      const isDrawn: boolean =
        Boolean(shot) &&
        file.endsWith(`.${SCREEN_EXTENSION}`) &&
        planLanguages(
          DOCS_SCREEN_FIXTURES[shot!.fixture]!,
          DOCS_SCREEN_LANGUAGES,
        ).drawn.includes(lang);

      if (!isDrawn) {
        fs.unlinkSync(path.join(languageFolder, file));
        deleted.push(`${lang}/${file}`);
      }
    }
  }

  return deleted;
}

function totalBytes(): { files: number; bytes: number } {
  const folder: string = path.join(STATIC_FOLDER, SCREENS_FOLDER);
  let files: number = 0;
  let bytes: number = 0;

  for (const lang of DOCS_SCREEN_LANGUAGES) {
    const languageFolder: string = path.join(folder, lang);

    if (!fs.existsSync(languageFolder)) {
      continue;
    }

    for (const file of fs.readdirSync(languageFolder)) {
      files++;
      bytes += fs.statSync(path.join(languageFolder, file)).size;
    }
  }

  return { files, bytes };
}

export default async function finish(): Promise<void> {
  const results: Array<LanguageResult> = readResults();
  const shots: Array<ShotResult> = results.flatMap(
    (result: LanguageResult): Array<ShotResult> => {
      return result.shots;
    },
  );
  const count: (status: ShotResult["status"]) => number = (
    status: ShotResult["status"],
  ): number => {
    return shots.filter((entry: ShotResult): boolean => {
      return entry.status === status;
    }).length;
  };

  if (MODE === "write") {
    const deleted: Array<string> = deleteOrphans();
    pruneFingerprints((lang: string, name: string): boolean => {
      return fs.existsSync(path.join(STATIC_FOLDER, screenFile(lang, name)));
    });
    const manifest: string = `${JSON.stringify(
      manifestOfFiles(DOCS_SCREENS, DOCS_SCREEN_LANGUAGES),
      null,
      2,
    )}\n`;
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, manifest);
    const total: { files: number; bytes: number } = totalBytes();

    process.stdout.write(
      `${[
        `Docs screens: ${count("written")} written, ${count("current")} current, ${count("failed")} failed, ${deleted.length} deleted.`,
        `On disk: ${total.files} pictures, ${(total.bytes / 1024 / 1024).toFixed(2)} MB, and the manifest (${(Buffer.byteLength(manifest) / 1024).toFixed(1)} KB).`,
      ].join("\n")}\n`,
    );
    return;
  }

  const check: DocsScreensCheck = {
    checked: shots.length,
    stale: shots
      .filter((entry: ShotResult): boolean => {
        return entry.status === "stale";
      })
      .map((entry: ShotResult) => {
        return { name: entry.name, lang: entry.lang, reasons: entry.reasons };
      }),
    failed: shots
      .filter((entry: ShotResult): boolean => {
        return entry.status === "failed";
      })
      .map((entry: ShotResult) => {
        return { name: entry.name, lang: entry.lang, reasons: entry.reasons };
      }),
  };

  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT, "check.json"),
    `${JSON.stringify(check, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUTPUT, "stale-issue.md"),
    `${staleIssueBody(check, process.env["DOCS_SCREENS_RUN_URL"])}\n`,
  );
  process.stdout.write(
    `Docs screens: ${check.checked} checked, ${check.stale.length} stale, ${check.failed.length} could not be drawn.\n`,
  );
}
