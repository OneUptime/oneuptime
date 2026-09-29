"use strict";

/**
 * The repository's licensing layout after the Community / Enterprise split.
 *
 * Everything outside ee/ is Apache-2.0. ee/ is the OneUptime Enterprise
 * Edition under ee/LICENSE. Several files have to agree on that, and nothing
 * else checks them:
 *
 *  - the root LICENSE follows PostHog's: a preamble that carves ee/ out (ee/
 *    is under ee/LICENSE, third-party components keep their own licenses,
 *    everything else is Apache-2.0), then the Apache License 2.0 text,
 *    unmodified. NOTICE repeats the preamble's split. With a preamble GitHub
 *    no longer names the repository's license, so the READMEs show a static
 *    license badge instead of the dynamic one;
 *  - ee/LICENSE carries the final terms, pinned here in full, and no document
 *    still says they are pending legal review or that the root LICENSE is kept
 *    verbatim;
 *  - both App images ship LICENSE and NOTICE, and the Enterprise image
 *    ee/LICENSE, and Scripts/GHA/check_app_image_edition.sh looks for them
 *    with the same wording the files use;
 *  - every package.json outside ee/ says Apache-2.0, ee/package.json points at
 *    its own LICENSE, and each package-lock.json root entry mirrors that. The
 *    root package is private, so it can never be published (with ee/ in it)
 *    under an Apache-2.0 manifest;
 *  - CODEOWNERS routes ee/, the license files and the files that decide what
 *    each image contains to the core maintainers;
 *  - the README and its 16 translations state the license split and no longer
 *    call all of OneUptime "100% open source" or its Enterprise images
 *    "hardened".
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  render,
  parseStages,
  ancestry,
  instructions,
} = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".claude",
  "build",
  "dist",
]);

const TRANSLATION_LANGUAGES = [
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const EE_LICENSE_FIELD = "SEE LICENSE IN LICENSE";

const APACHE_LICENSE_FIELD = "Apache-2.0";

const ENTERPRISE_DOCS_PAGE =
  "packages/App/FeatureSet/Docs/Content/en/self-hosted/enterprise.md";

/**
 * The README license badge. Static, because GitHub does not name a license
 * for a LICENSE with a preamble (PostHog's shows as "Other"), so shields.io's
 * dynamic github/license badge would read NOASSERTION, and it could not say
 * "and ee/" anyway. It renders as "license: Apache 2.0 + Enterprise (ee/)".
 */
const LICENSE_BADGE =
  '<a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>';

const DYNAMIC_LICENSE_BADGE = "img.shields.io/github/license";

/**
 * "Hardened images", as each README translation used to say it. The
 * Enterprise image is the Community image plus ee/, not a hardened base.
 */
const HARDENED_WORDING = [
  "hardened",
  "gehärtete",
  "reforzadas",
  "سخت‌شده",
  "renforcées",
  "हार्डेंड",
  "rafforzate",
  "堅牢化",
  "강화된",
  "geharde",
  "herdede",
  "reforçadas",
  "защищённые",
  "härdade",
  "加固",
  "hærdede",
];

/**
 * "100% open source (Apache 2.0)" in any of the 17 languages: a hundred
 * percent (Latin or Persian digits) followed, on the same line, by the
 * license name.
 */
const HUNDRED_PERCENT_OPEN_SOURCE = /(?:100|۱۰۰)\s*[%٪][^\n]{0,40}Apache 2\.0/;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function findPackageDirectories(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    findPackageDirectories(path.join(directory, entry.name), found);
  }

  if (fs.existsSync(path.join(directory, "package.json"))) {
    found.push(directory);
  }

  return found;
}

function relative(directory) {
  return path.relative(REPO_ROOT, directory).split(path.sep).join("/") || ".";
}

function isInsideEe(relativeDirectory) {
  return relativeDirectory === "ee" || relativeDirectory.startsWith("ee/");
}

/**
 * Every file under `directory` whose name `accept`s, skipping the same
 * directories as the package scan. Symlinks are not followed.
 */
function findFiles(directory, accept, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        findFiles(entryPath, accept, found);
      }
      continue;
    }

    if (entry.isFile() && accept(entry.name)) {
      found.push(entryPath);
    }
  }

  return found;
}

function normaliseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * `text` with its one `from` replaced by `to`, for the negative controls.
 * Throws when `from` is not there, so a control cannot pass vacuously.
 */
function edited(text, from, to) {
  if (!text.includes(from)) {
    throw new Error(`"${from}" is not in the text`);
  }

  return text.replace(from, to);
}

const packageDirectories = findPackageDirectories(REPO_ROOT);

/**
 * The title ee/LICENSE opens with, and what Scripts/GHA/check_app_image_edition.sh
 * looks for to tell an Enterprise License from any other LICENSE in an image.
 */
const ENTERPRISE_LICENSE_TITLE = "OneUptime Enterprise License";

/**
 * The final text of ee/LICENSE, pinned in full so no clause can be dropped or
 * reworded unnoticed. It follows PostHog's ee/LICENSE. Compared with
 * whitespace normalised, so rewrapping a line is not a change.
 */
const EE_LICENSE_TEXT = [
  'The OneUptime Enterprise License (the "Enterprise License")',
  "Copyright (c) 2026-present HackerBay, Inc. (doing business as OneUptime,",
  '"OneUptime")',
  "",
  "With regard to the OneUptime Software:",
  "",
  'This software and associated documentation files in the "ee/" directory of this',
  'repository and its subdirectories (the "Software") may only be used in',
  "production, if you (and any entity that you represent) have agreed to, and are",
  "in compliance with, the OneUptime Terms of Service, available at",
  'https://oneuptime.com/legal/terms (the "Enterprise Terms"), or other agreement',
  "governing the use of the Software, as agreed by you and OneUptime, and",
  "otherwise have a valid OneUptime Enterprise license for the correct number of",
  "user seats. Subject to the foregoing sentence, you are free to modify this",
  "Software and publish patches to the Software. You agree that OneUptime and/or",
  "its licensors (as applicable) retain all right, title and interest in and to",
  "all such modifications and/or patches, and all such modifications and/or",
  "patches may only be used, copied, modified, displayed, distributed, or",
  "otherwise exploited with a valid OneUptime Enterprise license for the correct",
  "number of user seats. Notwithstanding the foregoing, you may copy and modify",
  "the Software for development and testing purposes, without requiring a",
  "subscription. You agree that OneUptime and/or its licensors (as applicable)",
  "retain all right, title and interest in and to all such modifications. You are",
  "not granted any other rights beyond what is expressly stated herein. Subject to",
  "the foregoing, it is forbidden to copy, merge, publish, distribute, sublicense,",
  "and/or sell the Software.",
  "",
  'Content outside the "ee/" directory is not covered by this Enterprise License;',
  "it is licensed as set out in the LICENSE file at the root of this repository.",
  "",
  "The full text of this Enterprise License shall be included in all copies or",
  "substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
  "",
  "For all third party components incorporated into the OneUptime Software, those",
  "components are licensed under the original license provided by the owner of",
  "the applicable component.",
  "",
].join("\n");

/**
 * Whether `text` is the final Enterprise License text, apart from whitespace.
 */
function isFinalEnterpriseLicense(text) {
  return normaliseWhitespace(text) === normaliseWhitespace(EE_LICENSE_TEXT);
}

const ROOT_LICENSE_COPYRIGHT =
  'Copyright (c) HackerBay, Inc. (doing business as OneUptime, "OneUptime")';

/**
 * The preamble the root LICENSE opens with, exactly, up to and including the
 * blank line before the Apache License text. It follows PostHog's root
 * LICENSE, with the Apache License 2.0 where PostHog has MIT.
 */
const ROOT_LICENSE_PREAMBLE = [
  ROOT_LICENSE_COPYRIGHT,
  "",
  "Portions of this software are licensed as follows:",
  "",
  '* All content that resides under the "ee/" directory of this repository, if',
  '  that directory exists, is licensed under the license defined in "ee/LICENSE"',
  "  (the OneUptime Enterprise License).",
  "* All third party components incorporated into the OneUptime Software are",
  "  licensed under the original license provided by the owner of the applicable",
  "  component.",
  "* Content outside of the above mentioned directories or restrictions above is",
  '  available under the "Apache License, Version 2.0" as defined below.',
  "",
  "",
].join("\n");

/**
 * sha256 of https://www.apache.org/licenses/LICENSE-2.0.txt, the Apache
 * License 2.0 as the Apache Software Foundation publishes it.
 */
const APACHE_LICENSE_2_0_SHA256 =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function toLf(text) {
  return text.replace(/\r\n/g, "\n");
}

/**
 * What follows the preamble in `text`, or null when `text` does not open with
 * the preamble exactly.
 */
function textAfterPreamble(text) {
  const normalised = toLf(text);

  if (!normalised.startsWith(ROOT_LICENSE_PREAMBLE)) {
    return null;
  }

  return normalised.slice(ROOT_LICENSE_PREAMBLE.length);
}

/**
 * Whether `text` is the Apache Software Foundation's Apache License 2.0 text,
 * byte for byte, apart from blank lines at either end: the root LICENSE has
 * never carried that file's leading blank line or its final newline.
 */
function isUnmodifiedApacheLicense(text) {
  const trimmed = toLf(text).replace(/^\n+/, "").replace(/\n+$/, "");

  return sha256(`\n${trimmed}\n`) === APACHE_LICENSE_2_0_SHA256;
}

/**
 * The statements NOTICE must make, whitespace-normalised: the root LICENSE's
 * preamble, except that the last one points at LICENSE instead of "below".
 * Returns the ones `text` is missing.
 */
const NOTICE_STATEMENTS = [
  "Portions of this software are licensed as follows:",
  'All content that resides under the "ee/" directory of this repository, if that directory exists, is licensed under the license defined in "ee/LICENSE" (the OneUptime Enterprise License).',
  "All third party components incorporated into the OneUptime Software are licensed under the original license provided by the owner of the applicable component.",
  'Content outside of the above mentioned directories or restrictions above is available under the "Apache License, Version 2.0" as defined in "LICENSE".',
];

function missingNoticeStatements(text) {
  const normalised = normaliseWhitespace(text);

  return NOTICE_STATEMENTS.filter((statement) => {
    return !normalised.includes(statement);
  });
}

// Printable ASCII and line breaks: no curly quotes or other lookalikes.
const PLAIN_ASCII = /^[\x20-\x7E\n]*$/;

describe("root LICENSE", () => {
  const license = read("LICENSE");
  const apacheText = textAfterPreamble(license);

  test("opens with the preamble that carves ee/ out of the Apache License", () => {
    expect(apacheText).not.toBeNull();
    expect(license.split("\n")[0]).toBe(ROOT_LICENSE_COPYRIGHT);

    // What the file itself says before the Apache License heading.
    const preamble = normaliseWhitespace(
      license.slice(0, license.indexOf("Apache License\n")),
    );

    expect(preamble.startsWith(ROOT_LICENSE_COPYRIGHT)).toBe(true);
    expect(preamble).toContain(
      "Portions of this software are licensed as follows:",
    );
    expect(preamble).toContain(
      '* All content that resides under the "ee/" directory of this repository, if that directory exists, is licensed under the license defined in "ee/LICENSE" (the OneUptime Enterprise License).',
    );
    expect(preamble).toContain(
      "* All third party components incorporated into the OneUptime Software are licensed under the original license provided by the owner of the applicable component.",
    );
    expect(preamble).toContain(
      '* Content outside of the above mentioned directories or restrictions above is available under the "Apache License, Version 2.0" as defined below.',
    );
  });

  test("follows it with the Apache License 2.0, complete and unmodified", () => {
    expect(isUnmodifiedApacheLicense(apacheText)).toBe(true);
    expect(
      apacheText.startsWith(
        "                                 Apache License\n",
      ),
    ).toBe(true);
    expect(apacheText).toContain("Version 2.0, January 2004");
    expect(apacheText).toContain(
      "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    );
    expect(apacheText).toContain("END OF TERMS AND CONDITIONS");
    expect(apacheText).toContain(
      "APPENDIX: How to apply the Apache License to your work.",
    );
  });

  test("does not open with the Enterprise License title, so nothing takes it for ee/LICENSE", () => {
    expect(license.split("\n")[0]).not.toContain(ENTERPRISE_LICENSE_TITLE);
  });

  test("is plain ASCII", () => {
    expect(license).toMatch(PLAIN_ASCII);
  });

  test("the preamble check fails on the bare Apache License and on an edited preamble (negative control)", () => {
    expect(textAfterPreamble(apacheText)).toBeNull();
    expect(
      textAfterPreamble(
        edited(
          license,
          'under the "ee/" directory',
          'under the "src/" directory',
        ),
      ),
    ).toBeNull();
    expect(
      textAfterPreamble(
        edited(
          license,
          "* All third party components",
          "* Everything else, including third party components,",
        ),
      ),
    ).toBeNull();
  });

  test("the Apache check fails on an edited or extended Apache License (negative control)", () => {
    expect(isUnmodifiedApacheLicense(license)).toBe(false);
    expect(
      isUnmodifiedApacheLicense(
        edited(
          apacheText,
          "Version 2.0, January 2004",
          "Version 2.0, January 2005",
        ),
      ),
    ).toBe(false);
    expect(
      isUnmodifiedApacheLicense(
        edited(
          apacheText,
          "grants to You a perpetual,",
          "grants to You a perpetual ,",
        ),
      ),
    ).toBe(false);
    expect(
      isUnmodifiedApacheLicense(`${apacheText}\n\nAdditional terms apply.`),
    ).toBe(false);
  });
});

describe("ee/LICENSE", () => {
  const license = read("ee/LICENSE");
  const text = normaliseWhitespace(license);

  test("is the OneUptime Enterprise License", () => {
    expect(license.split("\n")[0]).toBe(
      'The OneUptime Enterprise License (the "Enterprise License")',
    );
    expect(text).toContain(
      'Copyright (c) 2026-present HackerBay, Inc. (doing business as OneUptime, "OneUptime")',
    );
    expect(text).toContain("With regard to the OneUptime Software:");
  });

  test("is the final Enterprise License text, every clause of it", () => {
    expect(isFinalEnterpriseLicense(license)).toBe(true);
  });

  test("the final-text check fails on a dropped, reworded or added clause (negative control)", () => {
    expect(
      isFinalEnterpriseLicense(
        edited(
          license,
          "The full text of this Enterprise License shall be included in all copies or\nsubstantial portions of the Software.\n\n",
          "",
        ),
      ),
    ).toBe(false);
    expect(
      isFinalEnterpriseLicense(
        edited(license, "AND NONINFRINGEMENT", "AND NON-INFRINGEMENT"),
      ),
    ).toBe(false);
    expect(
      isFinalEnterpriseLicense(
        edited(
          license,
          "retain all right, title and interest in and to all such modifications. You are",
          "retain no right in any such modifications. You are",
        ),
      ),
    ).toBe(false);
    expect(
      isFinalEnterpriseLicense(`${license}\nAdditional terms apply.\n`),
    ).toBe(false);

    // Rewrapping is not a change.
    expect(isFinalEnterpriseLicense(license.replace(/\n(?!\n)/g, " "))).toBe(
      true,
    );
  });

  test("covers the ee/ directory only, and leaves the rest to the root LICENSE", () => {
    expect(text).toContain(
      'This software and associated documentation files in the "ee/" directory of this repository and its subdirectories (the "Software")',
    );
    expect(text).toContain(
      'Content outside the "ee/" directory is not covered by this Enterprise License; it is licensed as set out in the LICENSE file at the root of this repository.',
    );
  });

  test("requires the Enterprise Terms and a license for the right number of seats in production", () => {
    expect(text).toContain(
      'may only be used in production, if you (and any entity that you represent) have agreed to, and are in compliance with, the OneUptime Terms of Service, available at https://oneuptime.com/legal/terms (the "Enterprise Terms"), or other agreement governing the use of the Software, as agreed by you and OneUptime,',
    );
    expect(text).toContain(
      "and otherwise have a valid OneUptime Enterprise license for the correct number of user seats.",
    );
  });

  test("allows development and testing without a subscription, with those modifications owned by OneUptime", () => {
    expect(text).toContain(
      "Notwithstanding the foregoing, you may copy and modify the Software for development and testing purposes, without requiring a subscription. You agree that OneUptime and/or its licensors (as applicable) retain all right, title and interest in and to all such modifications. You are not granted",
    );
  });

  test("lets you modify it and publish patches, with modifications owned by OneUptime", () => {
    expect(text).toContain(
      "you are free to modify this Software and publish patches to the Software.",
    );
    expect(text).toContain(
      "You agree that OneUptime and/or its licensors (as applicable) retain all right, title and interest in and to all such modifications and/or patches, and all such modifications and/or patches may only be used, copied, modified, displayed, distributed, or otherwise exploited with a valid OneUptime Enterprise license for the correct number of user seats.",
    );
  });

  test("forbids copying, distribution, sublicensing and selling", () => {
    expect(text).toContain(
      "You are not granted any other rights beyond what is expressly stated herein. Subject to the foregoing, it is forbidden to copy, merge, publish, distribute, sublicense, and/or sell the Software.",
    );
  });

  test("requires the license to travel with the Software", () => {
    expect(text).toContain(
      "The full text of this Enterprise License shall be included in all copies or substantial portions of the Software.",
    );
  });

  test("disclaims warranties and liability, and leaves third-party components alone", () => {
    expect(text).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
    );
    expect(text).toContain(
      "For all third party components incorporated into the OneUptime Software, those components are licensed under the original license provided by the owner of the applicable component.",
    );
  });

  test("is final: no draft or legal-review caveat in the license text", () => {
    expect(license).not.toMatch(/pending|draft|legal review/i);
  });

  test("is plain ASCII, with straight quotes", () => {
    expect(license).toMatch(PLAIN_ASCII);
    // Negative control: PostHog's text uses curly quotes.
    expect("the “Enterprise License”").not.toMatch(PLAIN_ASCII);
  });
});

/*
 * NOTICE is the notice Apache-2.0 section 4(d) has redistributors pass on,
 * and both App images ship it. It repeats the root LICENSE's preamble.
 */
describe("NOTICE", () => {
  const notice = read("NOTICE");

  test("opens with OneUptime and the root LICENSE's copyright line", () => {
    expect(notice.split("\n")[0]).toBe("OneUptime");
    expect(notice.split("\n")[1]).toBe(ROOT_LICENSE_COPYRIGHT);
    expect(read("LICENSE").split("\n")[0]).toBe(ROOT_LICENSE_COPYRIGHT);
  });

  test("states the split the root LICENSE's preamble does", () => {
    expect(missingNoticeStatements(notice)).toEqual([]);
    // The preamble says the same, except that the Apache text is "below".
    expect(missingNoticeStatements(ROOT_LICENSE_PREAMBLE)).toEqual([
      NOTICE_STATEMENTS[3],
    ]);
  });

  test("the statement check notices a missing carve-out (negative control)", () => {
    expect(missingNoticeStatements(read("ee/LICENSE"))).toEqual(
      NOTICE_STATEMENTS,
    );
    expect(
      missingNoticeStatements(
        edited(notice, 'resides under the "ee/" directory', "resides here"),
      ),
    ).toEqual([NOTICE_STATEMENTS[1]]);
  });

  test("points at license files that exist", () => {
    expect(exists("LICENSE")).toBe(true);
    expect(exists("ee/LICENSE")).toBe(true);
  });

  test("is a notice, not a second copy of either license", () => {
    expect(notice).not.toContain("TERMS AND CONDITIONS");
    expect(notice).not.toContain("may only be used in");
    expect(notice.split("\n").length).toBeLessThan(20);
  });

  test("is plain ASCII", () => {
    expect(notice).toMatch(PLAIN_ASCII);
  });
});

describe("the App images ship the license files", () => {
  const productionDockerfile = render(
    read("packages/App/Dockerfile.tpl"),
    "production",
  );
  const stages = parseStages(productionDockerfile);
  const check = read("Scripts/GHA/check_app_image_edition.sh");

  function stageInstructions(name) {
    const stage = stages.find((candidate) => {
      return candidate.name === name;
    });

    if (!stage) {
      throw new Error(`packages/App/Dockerfile.tpl has no stage ${name}`);
    }

    return instructions(stage.body);
  }

  function builtFrom(name) {
    return ancestry(stages, name).map((stage) => {
      return stage.name;
    });
  }

  test("the shared Community build copies LICENSE and NOTICE to /usr/src, so both targets have them", () => {
    expect(stageInstructions("community-build")).toContain(
      "COPY ./LICENSE ./NOTICE /usr/src/",
    );
    expect(builtFrom("community")).toContain("community-build");
    expect(builtFrom("enterprise")).toContain("community-build");
  });

  test("the Enterprise build copies ee/, and ee/LICENSE with it", () => {
    expect(stageInstructions("enterprise-build")).toContain(
      "COPY ./ee /usr/src/ee",
    );
  });

  test(".dockerignore keeps LICENSE, NOTICE and ee/LICENSE in the build context", () => {
    const excluded = read(".dockerignore")
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return (
          line.length > 0 &&
          !line.startsWith("#") &&
          (/(^|\/)(LICENSE|NOTICE)$/.test(line) || /^\*+$/.test(line))
        );
      });

    expect(excluded).toEqual([]);
  });

  test("Scripts/GHA/check_app_image_edition.sh looks for all three, with the wording the files use", () => {
    expect(check).toContain('is_apache_license "$ROOT/usr/src/LICENSE"');
    expect(check).toContain('grep -qF "Version 2.0, January 2004"');
    expect(read("LICENSE")).toContain("Version 2.0, January 2004");

    expect(check).toContain('states_the_license_split "$ROOT/usr/src/NOTICE"');
    expect(check).toContain(`grep -qF '"ee/"'`);
    expect(read("NOTICE")).toContain('"ee/"');
    expect(read("NOTICE")).toContain(ENTERPRISE_LICENSE_TITLE);

    expect(check).toContain('is_enterprise_license "$EE/LICENSE"');
    expect(check).toContain(
      `ENTERPRISE_LICENSE_TITLE="${ENTERPRISE_LICENSE_TITLE}"`,
    );
    expect(read("ee/LICENSE").split("\n")[0]).toContain(
      ENTERPRISE_LICENSE_TITLE,
    );
  });
});

/*
 * The image check finds ee/ copied anywhere in the Community image by two
 * files only ee/ has. That only works while nothing outside ee/ has them.
 */
describe("the files that mark ee/ in an image", () => {
  const check = read("Scripts/GHA/check_app_image_edition.sh");
  const candidates = findFiles(REPO_ROOT, (name) => {
    return name === "LICENSE" || name.startsWith("TrustedLicenseKeys.");
  })
    .filter((file) => {
      return (
        path.basename(file) !== "LICENSE" ||
        fs
          .readFileSync(file, "utf8")
          .split("\n")[0]
          .includes(ENTERPRISE_LICENSE_TITLE)
      );
    })
    .map(relative)
    .sort();

  test("the check scans for the Enterprise License title and ee's TrustedLicenseKeys module", () => {
    expect(check).toContain("-name LICENSE -o -name 'TrustedLicenseKeys.*'");
    expect(exists("ee/Server/License/TrustedLicenseKeys.ts")).toBe(true);
  });

  test("exist in ee/ and nowhere else in the repository", () => {
    expect(candidates).toEqual([
      "ee/LICENSE",
      "ee/Server/License/TrustedLicenseKeys.ts",
    ]);
  });
});

/*
 * Before the license was final, the root LICENSE was kept as the bare Apache
 * text so GitHub would keep detecting it, and ee/LICENSE was pending legal
 * review. Nothing may still say so.
 */
const RETIRED_LICENSING_WORDING = [
  /legal review/i,
  /review by OneUptime's counsel/i,
  /verbatim Apache/i,
  /GitHub keeps detecting/i,
];

function retiredLicensingWording(text) {
  return RETIRED_LICENSING_WORDING.filter((pattern) => {
    return pattern.test(text);
  }).map(String);
}

describe("retired licensing wording", () => {
  const files = [
    ...findFiles(REPO_ROOT, (name) => {
      return name.endsWith(".md");
    }),
    ...[
      "LICENSE",
      "NOTICE",
      "ee/LICENSE",
      ".github/CODEOWNERS",
      "packages/App/Dockerfile.tpl",
      "Scripts/GHA/check_app_image_edition.sh",
    ].map((file) => {
      return path.join(REPO_ROOT, file);
    }),
  ];

  test("the scan covers the READMEs, ee/README, CONTRIBUTING and the docs", () => {
    const scanned = files.map(relative);

    for (const expected of [
      "README.md",
      ...TRANSLATION_LANGUAGES.map((language) => {
        return `Docs/translations/README.${language}.md`;
      }),
      "ee/README.md",
      ".github/CONTRIBUTING.md",
      ENTERPRISE_DOCS_PAGE,
      "HelmChart/Public/oneuptime/README.md",
    ]) {
      expect(scanned).toContain(expected);
    }
  });

  test("no document says the license is pending legal review, or that the root LICENSE is kept verbatim", () => {
    const found = files.flatMap((file) => {
      return retiredLicensingWording(fs.readFileSync(file, "utf8")).map(
        (pattern) => {
          return `${relative(file)}: ${pattern}`;
        },
      );
    });

    expect(found).toEqual([]);
  });

  test.each([
    "> **Legal review pending.** The text of `ee/LICENSE` follows the widely used",
    "It is pending review by OneUptime's counsel, and the wording may change",
    "file is kept as the verbatim Apache License 2.0 text.",
    "so that GitHub keeps detecting the repository's license.",
  ])(
    "the scan catches the wording that used to be published: %s",
    (sentence) => {
      expect(retiredLicensingWording(sentence)).not.toEqual([]);
    },
  );
});

describe("ee/README.md", () => {
  const readme = read("ee/README.md");

  test("points at the license, and at the root LICENSE whose preamble sets out the split", () => {
    const text = normaliseWhitespace(readme);

    expect(readme).toContain("[OneUptime Enterprise License](./LICENSE)");
    expect(text).toContain(
      "The preamble of the root [`LICENSE`](../LICENSE) file sets out this split",
    );
    expect(text).toContain("https://oneuptime.com/legal/terms");
  });

  test("presents the license as final", () => {
    expect(readme).not.toMatch(/legal review|counsel|pending/i);
    expect(readme).not.toMatch(/verbatim/i);
  });

  test("documents the edition switches the loader and the builds read", () => {
    const environmentConfig = read(
      "packages/Common/Server/EnvironmentConfig.ts",
    );

    for (const variable of [
      "ONEUPTIME_EDITION",
      "ONEUPTIME_EE_DIR",
      "ALLOW_BILLING_WITHOUT_ENTERPRISE",
    ]) {
      expect(readme).toContain(`\`${variable}`);
      expect(environmentConfig).toContain(`process.env["${variable}"]`);
    }

    for (const setting of ["`auto`", "`community`", "`enterprise`"]) {
      expect(readme).toContain(setting);
    }
  });

  test("documents the development commands ee/package.json provides", () => {
    const eePackage = JSON.parse(read("ee/package.json"));

    expect(readme).toContain("npm ci --ignore-scripts");

    for (const script of ["test", "compile"]) {
      expect(eePackage.scripts[script]).toBeDefined();
      expect(readme).toContain(
        `npm ${script === "test" ? "test" : `run ${script}`}`,
      );
    }
  });

  test("points at contract files that exist", () => {
    for (const file of [
      "packages/App/Utils/EnterpriseLoader.ts",
      "packages/Common/Server/Enterprise/EnterpriseEdition.ts",
      "packages/Common/Server/Enterprise/EnterpriseServerModule.ts",
      "packages/Common/UI/esbuild-enterprise.js",
      "packages/Common/Tests/Server/Enterprise/FakeEnterpriseModule.ts",
      "packages/Common/Tests/Server/Enterprise/TestBillingFlag.ts",
      "packages/App/Tests/EnterpriseImportGuard.test.ts",
      "ee/Server/Index.ts",
      "ee/Server/License/LicenseToken.ts",
      "ee/Server/License/TrustedLicenseKeys.ts",
      "ee/Tests/Server/ModuleShape.test.ts",
      "ee/Tests/Server/License/LicenseToken.test.ts",
      "ee/jest.config.js",
    ]) {
      expect(readme).toContain(path.basename(file, path.extname(file)));
      expect({ file, exists: exists(file) }).toEqual({ file, exists: true });
    }
  });

  test("gives the key ceremony steps in the order that is safe", () => {
    const generate = readme.indexOf("**Generate the key pair**");
    const addPublicKey = readme.indexOf("**Add the public key**");
    const deploy = readme.indexOf("**Deploy that release to oneuptime.com.**");
    const setPrivateKey = readme.indexOf(
      "**Set `ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY`**",
    );

    expect(generate).toBeGreaterThan(-1);
    expect(addPublicKey).toBeGreaterThan(generate);
    expect(deploy).toBeGreaterThan(addPublicKey);
    expect(setPrivateKey).toBeGreaterThan(deploy);
    expect(readme).toContain("GenerateLicenseSigningKey.ts");
    expect(readme).toContain("refuses any output path inside the repository");
  });

  test("explains the legacy-license sunset and that oneuptime.com runs the Enterprise image", () => {
    expect(readme).toContain("## Sunsetting unverified legacy licenses");
    expect(readme).toContain("ACCEPT_UNVERIFIED_LEGACY_LICENSES");
    expect(readme).toContain("## oneuptime.com must run the Enterprise image");
  });
});

describe("package.json license fields", () => {
  test("the scan finds the packages it is meant to check", () => {
    const found = packageDirectories.map(relative);

    for (const expected of [
      ".",
      "ee",
      "packages/App",
      "packages/Common",
      "packages/App/FeatureSet/Dashboard",
      "packages/MobileApp",
    ]) {
      expect(found).toContain(expected);
    }
  });

  test("every package outside ee/ is Apache-2.0, and ee/ points at its own LICENSE", () => {
    const wrong = [];

    for (const directory of packageDirectories) {
      const relativeDirectory = relative(directory);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      );

      if (manifest.license === undefined && manifest.private === true) {
        // A private test harness that is never published.
        continue;
      }

      const expected = isInsideEe(relativeDirectory)
        ? EE_LICENSE_FIELD
        : APACHE_LICENSE_FIELD;

      if (manifest.license !== expected) {
        wrong.push(
          `${relativeDirectory}: ${manifest.license} (expected ${expected})`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  test("the six packages that used to have no license field declare one", () => {
    for (const directory of [
      "packages/App/FeatureSet/Accounts",
      "packages/App/FeatureSet/AdminDashboard",
      "packages/App/FeatureSet/Dashboard",
      "packages/App/FeatureSet/PublicDashboard",
      "packages/App/FeatureSet/StatusPage",
      "packages/MobileApp",
    ]) {
      const manifest = JSON.parse(read(`${directory}/package.json`));

      expect({ directory, license: manifest.license }).toEqual({
        directory,
        license: APACHE_LICENSE_FIELD,
      });
    }
  });

  test("each package-lock.json root entry mirrors its package's license", () => {
    const mismatched = [];

    for (const directory of packageDirectories) {
      const lockPath = path.join(directory, "package-lock.json");

      if (!fs.existsSync(lockPath)) {
        continue;
      }

      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      );
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      const rootEntry = (lock.packages && lock.packages[""]) || {};

      if (rootEntry.license !== manifest.license) {
        mismatched.push(
          `${relative(directory)}: lock ${rootEntry.license}, package.json ${manifest.license}`,
        );
      }
    }

    expect(mismatched).toEqual([]);
  });

  test("the root package is private, so it can never be published with ee/ under Apache-2.0", () => {
    const manifest = JSON.parse(read("package.json"));

    expect(manifest.private).toBe(true);
    expect(manifest.license).toBe(APACHE_LICENSE_FIELD);
  });
});

describe(".github/CODEOWNERS", () => {
  const codeOwners = read(".github/CODEOWNERS");
  const maintainers = read(".github/MAINTAINERS");

  function ownersOf(pattern) {
    const line = codeOwners
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => {
        return (
          !candidate.startsWith("#") && candidate.split(/\s+/)[0] === pattern
        );
      });

    return line ? line.split(/\s+/).slice(1) : null;
  }

  function patterns() {
    return codeOwners
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return line.length > 0 && !line.startsWith("#");
      })
      .map((line) => {
        return line.split(/\s+/)[0];
      });
  }

  test.each([
    // The license terms.
    "/ee/",
    "/ee/LICENSE",
    "/LICENSE",
    "/NOTICE",
    "/.github/CODEOWNERS",
    // What decides whether ee/ goes into the Community image.
    "/.dockerignore",
    "/packages/App/Dockerfile.tpl",
    "/packages/App/Utils/EnterpriseLoader.ts",
    "/packages/Common/UI/esbuild-enterprise.js",
    "/Scripts/GHA/build_docker_images.sh",
    // What notices when it does, or when the licensing statements drift.
    "/Scripts/GHA/check_app_image_edition.sh",
    "/Tests/Ops/EnterpriseEditionBuild.test.js",
    "/Tests/Ops/ReleaseImageEditionChecks.test.js",
    "/Tests/Ops/RepositoryLicensing.test.js",
  ])("routes %s to both core maintainers", (pattern) => {
    expect(ownersOf(pattern)).toEqual(["@simlarsen", "@nawazdhandala"]);
  });

  test("every path it names exists, so a rename cannot leave a file unowned", () => {
    const missing = patterns().filter((pattern) => {
      return !pattern.includes("*") && !exists(pattern.replace(/^\/|\/$/g, ""));
    });

    expect(patterns().length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  test("its header describes the root LICENSE as the preamble plus the Apache License", () => {
    const header = normaliseWhitespace(
      codeOwners
        .split("\n")
        .filter((line) => {
          return line.startsWith("#");
        })
        .map((line) => {
          return line.replace(/^#\s?/, "");
        })
        .join("\n"),
    );

    expect(header).toContain(
      "The root LICENSE is the Apache License 2.0 text, unmodified, after a preamble that carves ee/ out of it",
    );
  });

  test("every owner is a core maintainer listed in MAINTAINERS", () => {
    const owners = new Set(
      codeOwners
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("#"))
        .flatMap((line) => line.trim().split(/\s+/).slice(1)),
    );

    expect(owners.size).toBeGreaterThan(0);

    for (const owner of owners) {
      expect(maintainers).toContain(`"${owner.replace(/^@/, "")}"`);
    }
  });
});

describe(".github/CONTRIBUTING.md", () => {
  const contributing = read(".github/CONTRIBUTING.md");

  test("states which license covers a contribution, by location", () => {
    expect(contributing).toContain("## Licensing of contributions");
    expect(normaliseWhitespace(contributing)).toContain(
      "The preamble of the root [`LICENSE`](../LICENSE) file sets out the split:",
    );
    expect(contributing).toContain(
      "**Everything outside the [`ee/`](../ee) directory** is licensed under the",
    );
    expect(contributing).toContain(
      "[OneUptime Enterprise License](../ee/LICENSE)",
    );
    expect(contributing).toContain(
      "OneUptime may use, modify, distribute,\n  sublicense and sell it",
    );
    expect(contributing).toContain("Contributor License Agreement (CLA)");
  });

  test("no longer says every contribution is Apache-2.0", () => {
    expect(contributing).not.toContain(
      "By contributing, you agree that your contributions will be licensed under its Apache License 2.0.",
    );
    expect(contributing).not.toContain(
      "## Any contributions you make will be under the Apache 2.0 Software License",
    );
  });
});

describe("README and its translations", () => {
  const english = read("README.md");
  const readmes = [
    ["en", "README.md", english],
    ...TRANSLATION_LANGUAGES.map((language) => {
      const file = `Docs/translations/README.${language}.md`;
      return [language, file, read(file)];
    }),
  ];

  test("the English README states the license split", () => {
    expect(english).toContain(
      "OneUptime is open source under the [Apache License 2.0](/LICENSE), except for the [`ee/`](/ee) directory.",
    );
    expect(english).toContain("[OneUptime Enterprise License](/ee/LICENSE)");
    expect(english).toContain("| **License** | Apache 2.0 |");
  });

  test("the English License section points at the root LICENSE, on the line that states the split", () => {
    const licenseLine = english.split("\n").find((line) => {
      return line.startsWith("OneUptime is open source under the");
    });

    expect(licenseLine).toContain(
      "The root [`LICENSE`](/LICENSE) file sets out this split.",
    );
  });

  test("the edition table lists what the Enterprise Edition adds", () => {
    const featuresRow = english
      .split("\n")
      .find((line) => line.startsWith("| **Features** |"));

    for (const feature of [
      "SAML & OIDC single sign-on",
      "SCIM provisioning",
      "audit logs",
      "team compliance",
      "instance health dashboards",
    ]) {
      expect(featuresRow).toContain(feature);
    }

    expect(featuresRow).not.toContain("Full feature set");
  });

  test("the docs page every README links to exists", () => {
    expect(exists(ENTERPRISE_DOCS_PAGE)).toBe(true);
  });

  test.each(readmes)(
    "%s keeps the English line layout and links the license split",
    (_language, _file, content) => {
      expect(content.split("\n").length).toBe(english.split("\n").length);
      // The edition table's License row and the License section.
      expect(content.split("(/ee/LICENSE)").length - 1).toBe(2);
      // The License section: the Apache License, and the root LICENSE that
      // sets out the split.
      expect(content.split("(/LICENSE)").length - 1).toBe(2);
      expect(content).toContain(`(/${ENTERPRISE_DOCS_PAGE})`);
    },
  );

  test.each(readmes)(
    "%s shows the static license badge, not the dynamic one GitHub can no longer fill",
    (_language, _file, content) => {
      expect(content).toContain(LICENSE_BADGE);
      expect(content).not.toContain(DYNAMIC_LICENSE_BADGE);
    },
  );

  test.each(readmes)(
    "%s no longer calls all of OneUptime 100%% open source or its images hardened",
    (_language, _file, content) => {
      expect(content).not.toMatch(HUNDRED_PERCENT_OPEN_SOURCE);

      for (const word of HARDENED_WORDING) {
        expect(content.toLowerCase()).not.toContain(word.toLowerCase());
      }
    },
  );

  test.each([
    "All of it is **100% open source (Apache 2.0)** and free to self-host.",
    "Das alles ist **zu 100 % Open Source (Apache 2.0)** und kostenlos selbst hostbar.",
    "Todo ello es **100 % de código abierto (Apache 2.0)** y gratis para alojar por tu cuenta.",
    "همه این‌ها **۱۰۰٪ متن‌باز (Apache 2.0)** و برای خودمیزبانی رایگان است.",
    "यह सब **100% ओपन सोर्स (Apache 2.0)** है और सेल्फ़-होस्ट करने के लिए मुफ़्त है।",
    "これらすべてが **100% オープンソース（Apache 2.0）** で、無料でセルフホストできます。",
    "이 모든 것이 **100% 오픈소스(Apache 2.0)**이며 셀프 호스팅이 무료입니다.",
    "Всё это **на 100% открытый исходный код (Apache 2.0)** и бесплатно для самостоятельного развёртывания.",
    "以上一切均为 **100% 开源（Apache 2.0）**，可免费自托管。",
  ])(
    "the 100%% check catches the wording that used to be published: %s",
    (sentence) => {
      expect(sentence).toMatch(HUNDRED_PERCENT_OPEN_SOURCE);
    },
  );

  test("the 100%% check leaves the corrected wording alone", () => {
    expect(
      "All of it is **open source (Apache 2.0)** and free to self-host in the Community Edition.",
    ).not.toMatch(HUNDRED_PERCENT_OPEN_SOURCE);
  });
});
