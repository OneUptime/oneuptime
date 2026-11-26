import { SENSITIVE_DATA_LIMITS } from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { CODE_FILE_EXTENSIONS } from "../ProductionReviewDiff";
import { findInfrastructureLeaks } from "./InfrastructureRules";
import {
  findSensitiveColumns,
  PASSWORD_HASHING_MARKERS,
} from "./MigrationRules";
import {
  compareCandidates,
  SensitiveDataCandidate,
} from "./SensitiveDataCandidate";
import {
  ProjectDataTypeHints,
  SensitiveNameMatcher,
} from "./SensitiveDataNames";
import {
  extensionOf,
  isGeneratedPath,
  isTestPath,
  isVendoredPath,
  PatchLine,
  PatchLineKind,
  readPatchLines,
} from "./SensitiveDataPatch";
import { findTelemetryWrites } from "./TelemetryWriteRules";

/*
 * THE SENSITIVE DATA RULES, OVER A PULL REQUEST'S FILES (#10376).
 *
 * Each file a pull request adds or changes is read by the rules that are
 * for it:
 *
 *   - infrastructure code (InfrastructureRules), wherever it is - in a
 *     test, a fixture or generated code too: what a module's test opens
 *     to the world, the module does;
 *   - migrations and models (MigrationRules), and code that writes to
 *     telemetry (TelemetryWriteRules), only outside tests, fixtures and
 *     generated code: a test logs an email on purpose, and a client a
 *     tool generated is not where the team writes its logs;
 *   - nothing of a dependency's copy (vendor/, node_modules/).
 *
 * What they find is ordered - what can fail the check first, then the
 * most severe, then as the files list them - and held to
 * SENSITIVE_DATA_LIMITS: a few points a file, a few in all.
 *
 * Pure: the files and the project's own data types are all it reads.
 */

// A file of a pull request, as its host lists it.
export interface SensitiveDataFileInput {
  filename: string;
  status: string;
  patch: string | null;
}

export interface SensitiveDataRulesResult {
  // The candidates kept, in order.
  candidates: Array<SensitiveDataCandidate>;
  // What the rules found past the limits.
  moreCount: number;
}

// Whether any added line of the change hashes passwords.
function hashesPasswords(linesByFile: Array<Array<PatchLine>>): boolean {
  return linesByFile.some((lines: Array<PatchLine>): boolean => {
    return lines.some((line: PatchLine): boolean => {
      if (line.kind !== PatchLineKind.Added) {
        return false;
      }

      const lower: string = line.text.toLowerCase();

      return PASSWORD_HASHING_MARKERS.some((marker: string): boolean => {
        return lower.includes(marker);
      });
    });
  });
}

export default class SensitiveDataRules {
  public static find(data: {
    files: Array<SensitiveDataFileInput>;
    projectTypes?: ReadonlyArray<ProjectDataTypeHints> | undefined;
  }): SensitiveDataRulesResult {
    const matcher: SensitiveNameMatcher = new SensitiveNameMatcher(
      data.projectTypes || [],
    );
    const files: Array<{ path: string; lines: Array<PatchLine> }> = [];

    for (const file of data.files) {
      const path: string = (file.filename || "").trim();

      if (
        !path ||
        file.status === "removed" ||
        !file.patch ||
        isVendoredPath(path)
      ) {
        continue;
      }

      files.push({ path, lines: readPatchLines(file.patch) });
    }

    const isHashingPasswords: boolean = hashesPasswords(
      files.map((file: { lines: Array<PatchLine> }): Array<PatchLine> => {
        return file.lines;
      }),
    );
    const found: Array<SensitiveDataCandidate> = [];
    let moreCount: number = 0;

    for (const file of files) {
      const fileCandidates: Array<SensitiveDataCandidate> = [
        ...findInfrastructureLeaks({ path: file.path, lines: file.lines }),
      ];

      const isReadForCode: boolean =
        !isTestPath(file.path) && !isGeneratedPath(file.path, file.lines);

      if (isReadForCode) {
        fileCandidates.push(
          ...findSensitiveColumns({
            path: file.path,
            lines: file.lines,
            matcher,
            hashesPasswords: isHashingPasswords,
          }),
        );

        if (CODE_FILE_EXTENSIONS.has(extensionOf(file.path))) {
          fileCandidates.push(
            ...findTelemetryWrites({
              path: file.path,
              lines: file.lines,
              matcher,
            }),
          );
        }
      }

      // One point a line: a column a migration's SQL and its ORM both name.
      const byLine: Map<string, SensitiveDataCandidate> = new Map<
        string,
        SensitiveDataCandidate
      >();

      for (const candidate of fileCandidates.sort(compareCandidates)) {
        const key: string = `${candidate.line}\u0000${candidate.subject.toLowerCase()}`;

        if (!byLine.has(key)) {
          byLine.set(key, candidate);
        }
      }

      const kept: Array<SensitiveDataCandidate> = Array.from(byLine.values());

      found.push(...kept.slice(0, SENSITIVE_DATA_LIMITS.maxPointsPerFile));
      moreCount += Math.max(
        0,
        kept.length - SENSITIVE_DATA_LIMITS.maxPointsPerFile,
      );
    }

    const ordered: Array<SensitiveDataCandidate> =
      found.sort(compareCandidates);

    return {
      candidates: ordered.slice(0, SENSITIVE_DATA_LIMITS.maxPoints),
      moreCount:
        moreCount +
        Math.max(0, ordered.length - SENSITIVE_DATA_LIMITS.maxPoints),
    };
  }
}
