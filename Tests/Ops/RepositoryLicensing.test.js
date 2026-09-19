"use strict";

/**
 * The repository's licensing layout after the Community / Enterprise split.
 *
 * Everything outside ee/ is Apache-2.0. ee/ is the OneUptime Enterprise
 * Edition under ee/LICENSE. Several files have to agree on that, and nothing
 * else checks them:
 *
 *  - the root LICENSE stays the verbatim Apache License 2.0 text, so GitHub
 *    keeps detecting it (and the README's license badge keeps working). The
 *    carve-out for ee/ lives in the root NOTICE, the README, CONTRIBUTING and
 *    ee/ itself, never in the root LICENSE;
 *  - ee/LICENSE carries the terms the design settled on;
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

const packageDirectories = findPackageDirectories(REPO_ROOT);

/**
 * The title ee/LICENSE opens with, and what Scripts/GHA/check_app_image_edition.sh
 * looks for to tell an Enterprise License from any other LICENSE in an image.
 */
const ENTERPRISE_LICENSE_TITLE = "OneUptime Enterprise License";

/**
 * The statements NOTICE must make, whitespace-normalised. Returns the ones
 * `text` is missing.
 */
const NOTICE_STATEMENTS = [
  'All content in the "ee/" directory of this repository is licensed under the OneUptime Enterprise License, in ee/LICENSE.',
  "It is not licensed under the Apache License 2.0.",
  "Third-party components keep the licenses their owners provide them under.",
  "All other content is available under the Apache License 2.0, in LICENSE.",
];

function missingNoticeStatements(text) {
  const normalised = normaliseWhitespace(text);

  return NOTICE_STATEMENTS.filter((statement) => {
    return !normalised.includes(statement);
  });
}

describe("root LICENSE", () => {
  const license = read("LICENSE");

  test("is the Apache License 2.0", () => {
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain(
      "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    );
    expect(license).toContain("END OF TERMS AND CONDITIONS");
  });

  test("carries no edition carve-out, which would break GitHub's license detection", () => {
    expect(license).not.toMatch(/\bee\//);
    expect(license).not.toMatch(/Enterprise License/i);
    expect(license).not.toMatch(/OneUptime Enterprise/i);
  });
});

describe("ee/LICENSE", () => {
  const license = read("ee/LICENSE");

  test("is the OneUptime Enterprise License", () => {
    expect(license.split("\n")[0]).toBe(
      'OneUptime Enterprise License (the "Enterprise License")',
    );
    expect(license).toContain("HackerBay, Inc. (doing business as OneUptime");
  });

  test("requires a subscription for the right number of seats in production", () => {
    expect(license).toContain("may only be used in");
    expect(license).toContain("production");
    expect(license).toContain(
      "valid OneUptime Enterprise subscription for the",
    );
    expect(license).toContain("correct number of user seats");
    expect(license).toContain("https://oneuptime.com/legal/terms");
  });

  test("allows development and testing without a subscription", () => {
    expect(license).toContain(
      "you may copy and modify the Software for\ndevelopment and testing purposes, without requiring a subscription",
    );
  });

  test("lets you modify it, with modifications owned by OneUptime", () => {
    expect(license).toContain("you are free to modify this Software");
    expect(license).toContain(
      "retain all right, title and interest in and to all such",
    );
  });

  test("forbids copying, distribution, sublicensing and selling", () => {
    expect(license).toContain(
      "it is forbidden to copy, merge, publish, distribute,\nsublicense, and/or sell the Software",
    );
  });

  test("leaves third-party components and everything outside ee/ alone", () => {
    expect(license).toContain(
      "those components are licensed under the original license",
    );
    expect(license).toContain(
      'This Enterprise License applies only to the contents of the "ee" directory',
    );
    expect(license).toContain("Apache License, Version 2.0");
  });

  test("keeps the legal-review caveat out of the license text", () => {
    expect(license).not.toMatch(/pending|draft|legal review/i);
  });
});

/*
 * The root LICENSE has to stay verbatim Apache-2.0, so the ee/ carve-out that
 * PostHog and Metabase put at the top of their LICENSE lives in NOTICE.
 */
describe("NOTICE", () => {
  const notice = read("NOTICE");

  test("opens with OneUptime and carries ee/LICENSE's copyright line", () => {
    const eeCopyright = read("ee/LICENSE").split("\n\n")[1];

    expect(notice.split("\n")[0]).toBe("OneUptime");
    expect(eeCopyright.startsWith("Copyright (c) ")).toBe(true);
    expect(normaliseWhitespace(notice)).toContain(
      normaliseWhitespace(eeCopyright),
    );
  });

  test("states that ee/ is under the Enterprise License and everything else Apache-2.0", () => {
    expect(missingNoticeStatements(notice)).toEqual([]);
  });

  test("the statement check notices a missing carve-out (negative control)", () => {
    expect(missingNoticeStatements(read("LICENSE"))).toEqual(NOTICE_STATEMENTS);
    expect(
      missingNoticeStatements(
        notice.replace(/All content in the "ee\/" directory/, "All content"),
      ),
    ).toEqual([NOTICE_STATEMENTS[0]]);
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

describe("ee/README.md", () => {
  const readme = read("ee/README.md");

  test("points at the license and flags that it is pending legal review", () => {
    expect(readme).toContain("[OneUptime Enterprise License](./LICENSE)");
    expect(readme).toContain("**Legal review pending.**");
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

  test("the English License section points at NOTICE, on the line that states the split", () => {
    const licenseLine = english.split("\n").find((line) => {
      return line.startsWith("OneUptime is open source under the");
    });

    expect(licenseLine).toContain(
      "The [`NOTICE`](/NOTICE) file states this split.",
    );
    expect(exists("NOTICE")).toBe(true);
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
      expect(content).toContain("(/LICENSE)");
      expect(content).toContain(`(/${ENTERPRISE_DOCS_PAGE})`);
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
