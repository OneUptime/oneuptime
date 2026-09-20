import fs from "fs";
import path from "path";

/*
 * The seam between the two enterprise phases of one CI job.
 *
 * The enterprise job runs in two phases against the SAME booted stack: the
 * Licensed suite first, then the licence is forced to lapse (psql backdates
 * GlobalConfig.enterpriseEditionFirstSeenAt - see packages/E2E/README.md), then
 * the Lapsed suite. Phase two therefore inherits phase one's data, and the
 * interesting assertions there are about state that already exists:
 *
 *   - the project has audit logging ON and one recorded entry, so the Lapsed
 *     suite can show that a further audited write records NOTHING while the
 *     licence is dead, and that the existing trail is still readable;
 *   - the project has a ProjectSCIM row, so the Lapsed suite can show that a
 *     lapse keeps existing configuration readable while refusing to create any
 *     more of it;
 *   - the owner account exists with the shared signup password, so the Lapsed
 *     suite can show that a lapsed licence does NOT break password sign-in.
 *
 * Rebuilding that state in phase two would prove less: the point is that it
 * was created while the licence was alive and survived the lapse.
 *
 * The password is deliberately NOT written here. It is the same fixed
 * passphrase every spec uses, exported as E2E_SIGNUP_PASSWORD from
 * packages/E2E/Config.ts; read it from there.
 *
 * A reader must treat the file's absence as normal: a developer may run the
 * Lapsed suite on its own, and then it has to create whatever it needs itself.
 */

export interface LicensedSuiteHandoff {
  // The project the Licensed suite created and deliberately did not delete.
  projectId: string;
  // The owner it registered; sign in with Config.E2E_SIGNUP_PASSWORD.
  ownerEmail: string;
  // True once the Licensed suite turned the project's audit logging on.
  auditLogsEnabled: boolean;
  // The write that was recorded while the licence was still usable.
  auditedResourceType: string;
  auditedResourceName: string;
  /*
   * The name of the enterprise configuration row created while licensed, empty
   * when that test did not run. A name and not an id: the CRUD API does not
   * give a project-owner session this model's key, so both suites find the row
   * by the unique name the licensed suite chose (isProjectScimListed).
   */
  projectScimName: string;
  // When the Licensed suite finished, for a stale-file sanity check.
  completedAt: string;
}

/*
 * packages/E2E/test-results/enterprise/.
 *
 * It has to be this directory and not one of the tidier-looking siblings: in
 * CI the two phases are two separate `docker compose run --rm e2e` containers,
 * and the only paths that outlive a phase are the e2e service's two bind
 * mounts, playwright-report/ and test-results/ (Scripts/Dev/docker-compose.dev.yml).
 * A handoff written anywhere else is thrown away with the phase-A container,
 * and every assertion that depends on it then skips itself - the suite stays
 * green while quietly testing less than it claims to.
 */
export const ENTERPRISE_OUTPUT_DIRECTORY: string = path.resolve(
  __dirname,
  "../../test-results/enterprise",
);

export const HANDOFF_FILE_PATH: string = path.join(
  ENTERPRISE_OUTPUT_DIRECTORY,
  "licensed-handoff.json",
);

type WriteHandoffFunction = (handoff: LicensedSuiteHandoff) => void;

export const writeLicensedSuiteHandoff: WriteHandoffFunction = (
  handoff: LicensedSuiteHandoff,
): void => {
  fs.mkdirSync(ENTERPRISE_OUTPUT_DIRECTORY, { recursive: true });
  fs.writeFileSync(
    HANDOFF_FILE_PATH,
    `${JSON.stringify(handoff, null, 2)}\n`,
    "utf8",
  );
};

type ReadHandoffFunction = () => LicensedSuiteHandoff | null;

/*
 * Null when the Licensed suite has not run on this machine - never a throw: a
 * Lapsed spec is expected to fall back to creating its own fixtures, and a
 * missing handoff is not itself a failure.
 */
export const readLicensedSuiteHandoff: ReadHandoffFunction =
  (): LicensedSuiteHandoff | null => {
    try {
      const contents: string = fs.readFileSync(HANDOFF_FILE_PATH, "utf8");
      const parsed: LicensedSuiteHandoff = JSON.parse(
        contents,
      ) as LicensedSuiteHandoff;

      return parsed.projectId ? parsed : null;
    } catch {
      return null;
    }
  };
