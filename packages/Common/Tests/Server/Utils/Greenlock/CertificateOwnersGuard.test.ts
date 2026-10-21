/**
 * Every code path that orders certificates is a certificate owner, and every
 * certificate owner is listed in CertificateOwners.
 *
 * The daily cleanup (GreenlockUtil.removeExpiredCertificatesNobodyOwns)
 * deletes a certificate 30 days after it expires unless an owner in
 * CertificateOwners claims it. A new kind of custom domain that calls
 * GreenlockUtil.orderCert without being added there would have its
 * certificates taken for abandoned ones. This scans the product's sources for
 * orderCert callers, so adding one fails here until the owner is registered.
 */

import CertificateOwners, {
  CertificateOwner,
} from "../../../../Server/Utils/Greenlock/CertificateOwners";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// packages/Common/Tests/Server/Utils/Greenlock -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  ".git",
]);

const ORDER_CERT_CALL: RegExp = /GreenlockUtil\s*\.\s*orderCert\s*\(/;
const SOURCE_FILE: RegExp = /\.tsx?$/;

/*
 * Each file that orders certificates, and the CertificateOwners entry that
 * claims what it orders.
 */
const KNOWN_CALLERS: Record<string, string> = {
  // The renewal run, on behalf of whichever owner called it.
  "packages/Common/Server/Utils/Greenlock/Greenlock.ts": "renewal run",
  "packages/Common/Server/Services/StatusPageDomainService.ts":
    "status page domains",
  "packages/Common/Server/Services/DashboardDomainService.ts":
    "dashboard domains",
  "packages/App/FeatureSet/Workers/Jobs/CoreSsl/ProvisionPrimaryDomain.ts":
    "primary host",
};

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function findOrderCertCallers(): Array<string> {
  const roots: Array<string> = [
    path.join(REPOSITORY_ROOT, "packages"),
    path.join(REPOSITORY_ROOT, "ee"),
  ].filter((root: string) => {
    return fs.existsSync(root);
  });

  return roots
    .flatMap(listSourceFiles)
    .filter((file: string) => {
      return ORDER_CERT_CALL.test(fs.readFileSync(file, "utf-8"));
    })
    .map((file: string) => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();
}

describe("certificate owners", () => {
  test("every file that orders certificates is a known owner, registered in CertificateOwners", () => {
    const callers: Array<string> = findOrderCertCallers();

    // The scan reaches the callers it knows about.
    expect(callers).toEqual(Object.keys(KNOWN_CALLERS).sort());

    const ownerNames: Array<string> = CertificateOwners.getAll().map(
      (owner: CertificateOwner) => {
        return owner.name;
      },
    );

    for (const caller of callers) {
      const owner: string = KNOWN_CALLERS[caller]!;

      if (owner === "renewal run") {
        continue;
      }

      expect(ownerNames).toContain(owner);
    }
  }, 120000);
});
