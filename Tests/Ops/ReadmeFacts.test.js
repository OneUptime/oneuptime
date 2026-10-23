"use strict";

/**
 * What the README and its 16 translations say, held to what makes it true.
 *
 * The README is short on purpose: what OneUptime is, how to try it on
 * OneUptime Cloud, how to install it, where to get help, how to contribute,
 * and the license, with the docs linked for everything else. So the little it
 * says has to stay true, and every translation has to keep saying it:
 *
 *  - each translation keeps the English layout line for line: the same
 *    headings, list items, HTML, code blocks, images and links, and each
 *    docs link opens the same page in the translation's own language. App's
 *    ReadmeDocsLinks holds those pages to the docs' nav;
 *  - every link is a full https URL, a mailto: address or a path from the
 *    repository root, so it lands in the same place from Docs/translations/,
 *    and every path names a file or directory that is there;
 *  - each README says what OneUptime is in the docs' own Getting Started
 *    paragraph, in its language, and the chart's README in the same words;
 *  - the sentences beside the Docker Compose commands say what the commands
 *    do: the line npm start ends with, the address it serves, the first
 *    account, HOST, and the memory the Docker Compose guide asks for;
 *  - the Helm commands add the repository the chart's own README adds, and
 *    install the chart this repository builds, under the release name that
 *    README upgrades and uninstalls, with a value the chart has;
 *  - the sign-up, Slack, support and sales addresses are the ones the
 *    product, the website and the docs give;
 *  - and no README carries an emoji.
 *
 * ReadmeQuickStart pins the Docker Compose block itself, and
 * RepositoryLicensing the license and edition wording.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TRANSLATIONS_DIR = "Docs/translations";
const DOCS_CONTENT = "packages/App/FeatureSet/Docs/Content";
const WEBSITE_ORIGIN = "https://oneuptime.com";
const DOCS_PATH = "/docs/";
const COMPOSE_GUIDE = "installation/docker-compose.md";
const CHART_DIR = "HelmChart/Public/oneuptime";
const CHART_README = `${CHART_DIR}/README.md`;
const README_TRANSLATION = /^README\.([\w-]+)\.md$/;
const HEADING = /^(#{1,6}) /;
const HTML_LINK = /\b(?:href|src)="([^"]*)"/g;
const MARKDOWN_LINK = /\]\(([^()\s]*)\)/g;
const IMAGE_SOURCE = /\bsrc="([^"]*)"/g;
const ALT_TEXT = /\balt="[^"]*"/g;
const ALLOWED_LINK = /^(?:https:\/\/|mailto:|\/)/;
const SLACK_INVITE =
  /https:\/\/join\.slack\.com\/t\/[\w-]+\/shared_invite\/[\w-]+/g;
const EMOJI = /\p{Extended_Pictographic}/u;
const WHITESPACE = /\s+/;
const RIGHT_TO_LEFT_MARK = "\u{200F}";
const GETTING_STARTED = "introduction/getting-started.md";
const FENCE = "```";

const REPO_ADD = "helm repo add oneuptime https://helm-chart.oneuptime.com/";
const HELM_INSTALL =
  "helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

// The docs' languages but English: the README has one translation for each.
const TRANSLATION_LANGUAGES = fs
  .readdirSync(path.join(REPO_ROOT, DOCS_CONTENT), { withFileTypes: true })
  .filter((entry) => {
    return entry.isDirectory() && entry.name !== "en";
  })
  .map((entry) => {
    return entry.name;
  })
  .sort();

function translationFile(language) {
  return `${TRANSLATIONS_DIR}/README.${language}.md`;
}

const ENGLISH = { language: "en", file: "README.md", text: read("README.md") };

const TRANSLATIONS = TRANSLATION_LANGUAGES.filter((language) => {
  return exists(translationFile(language));
}).map((language) => {
  return {
    language,
    file: translationFile(language),
    text: read(translationFile(language)),
  };
});

const READMES = [ENGLISH, ...TRANSLATIONS];

/*
 * A Markdown file's lines, with every line of a fenced block (its fences
 * too) marked as code.
 */
function linesOf(text) {
  let inFence = false;

  return text.split("\n").map((line, index) => {
    const fence = line.startsWith(FENCE);
    const entry = { number: index + 1, text: line, code: inFence || fence };

    if (fence) {
      inFence = !inFence;
    }

    return entry;
  });
}

/*
 * What a line is, in words every language shares: code and HTML as written
 * (an image's alt text aside, which is translated), and prose by its kind.
 */
function shapeOf(line) {
  if (line.code) {
    return `code ${line.text}`;
  }

  if (line.text === "") {
    return "blank";
  }

  const heading = line.text.match(HEADING);

  if (heading) {
    return `heading ${heading[1].length}`;
  }

  if (line.text.startsWith("- ")) {
    return "list item";
  }

  if (line.text.startsWith("<") || line.text.startsWith("  <")) {
    return `html ${line.text.replace(ALT_TEXT, 'alt=""')}`;
  }

  return "paragraph";
}

function matchesOf(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => {
    return match[1];
  });
}

// Every link and image target outside code, in order, with its line.
function linksOf(text) {
  return linesOf(text)
    .filter((line) => {
      return !line.code;
    })
    .flatMap((line) => {
      return [
        ...matchesOf(line.text, HTML_LINK),
        ...matchesOf(line.text, MARKDOWN_LINK),
      ].map((target) => {
        return { line: line.number, target };
      });
    });
}

function targetsOf(text) {
  return linksOf(text).map((link) => {
    return link.target;
  });
}

/*
 * The names after /docs/ of a link into the website's docs, or null for any
 * other link: https://oneuptime.com/docs/de/installation/docker-compose is
 * ["de", "installation", "docker-compose"].
 */
function docsNamesOf(target) {
  let url;

  try {
    url = new URL(target);
  } catch {
    return null;
  }

  if (url.origin !== WEBSITE_ORIGIN || !url.pathname.startsWith(DOCS_PATH)) {
    return null;
  }

  return url.pathname.slice(DOCS_PATH.length).split("/");
}

function isDocsLink(target) {
  return docsNamesOf(target) !== null;
}

/*
 * A translation's docs link as the English README writes it: the same page,
 * without the language. A link that does not carry the translation's own
 * language is left as it is, so it differs from the English one.
 */
function asEnglishLink(target, language) {
  const names = docsNamesOf(target);

  if (names === null || names[0] !== language) {
    return target;
  }

  const url = new URL(target);
  url.pathname = `${DOCS_PATH}${names.slice(1).join("/")}`;
  return url.toString();
}

function codeBlocksOf(text) {
  const blocks = [];
  let current = null;

  for (const line of text.split("\n")) {
    if (line.startsWith(FENCE)) {
      if (current === null) {
        current = [];
      } else {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    if (current !== null) {
      current.push(line);
    }
  }

  return blocks;
}

// A file's lines without their indentation.
function trimmedLines(text) {
  return text.split("\n").map((line) => {
    return line.trim();
  });
}

// The cells of a Markdown table row, trimmed.
function cellsOf(row) {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell) => {
      return cell.trim();
    });
}

// The value a KEY=value line of an env file gives KEY, or undefined.
function envValue(contents, key) {
  const line = contents.split("\n").find((entry) => {
    return entry.startsWith(`${key}=`);
  });

  return line === undefined ? undefined : line.slice(key.length + 1);
}

function slackInvitesOf(text) {
  return text.match(SLACK_INVITE) || [];
}

const byLanguage = READMES.map((readme) => {
  return [readme.language, readme];
});

const translationsByLanguage = TRANSLATIONS.map((readme) => {
  return [readme.language, readme];
});

describe("the README's translations", () => {
  test("there is one for every docs language, and no other", () => {
    expect(TRANSLATION_LANGUAGES.length).toBeGreaterThanOrEqual(16);
    expect(
      TRANSLATIONS.map((readme) => {
        return readme.language;
      }),
    ).toEqual(TRANSLATION_LANGUAGES);

    const translationFiles = fs
      .readdirSync(path.join(REPO_ROOT, TRANSLATIONS_DIR))
      .filter((file) => {
        return README_TRANSLATION.test(file);
      })
      .map((file) => {
        return file.match(README_TRANSLATION)[1];
      })
      .sort();

    expect(translationFiles).toEqual(TRANSLATION_LANGUAGES);
  });

  test("the language switcher lists every README once", () => {
    const switcher = ENGLISH.text.slice(0, ENGLISH.text.indexOf("</p>"));

    expect(matchesOf(switcher, HTML_LINK).sort()).toEqual(
      [
        "/README.md",
        ...TRANSLATION_LANGUAGES.map((language) => {
          return `/${translationFile(language)}`;
        }),
      ].sort(),
    );
  });

  test.each(translationsByLanguage)(
    "%s keeps the English layout line for line",
    (_language, readme) => {
      expect(linesOf(readme.text).map(shapeOf)).toEqual(
        linesOf(ENGLISH.text).map(shapeOf),
      );
    },
  );

  test.each(translationsByLanguage)(
    "%s has the English code blocks and images",
    (_language, readme) => {
      expect(codeBlocksOf(readme.text)).toEqual(codeBlocksOf(ENGLISH.text));
      expect(matchesOf(readme.text, IMAGE_SOURCE)).toEqual(
        matchesOf(ENGLISH.text, IMAGE_SOURCE),
      );
    },
  );

  test.each(translationsByLanguage)(
    "%s links what the English README links, on the same lines, and the docs in its own language",
    (language, readme) => {
      const links = linksOf(readme.text);

      expect(
        links.map((link) => {
          return {
            line: link.line,
            target: asEnglishLink(link.target, language),
          };
        }),
      ).toEqual(linksOf(ENGLISH.text));

      const docsLinks = links.filter((link) => {
        return isDocsLink(link.target);
      });

      expect(docsLinks.length).toBeGreaterThanOrEqual(10);
      for (const link of docsLinks) {
        expect({
          link: link.target,
          language: docsNamesOf(link.target)[0],
        }).toEqual({ link: link.target, language });
      }
    },
  );

  test("the English README links the docs without a language, so they open in English", () => {
    const docsLinks = linksOf(ENGLISH.text).filter((link) => {
      return isDocsLink(link.target);
    });

    expect(docsLinks.length).toBeGreaterThanOrEqual(10);
    for (const link of docsLinks) {
      const first = docsNamesOf(link.target)[0];

      expect({
        link: link.target,
        language: TRANSLATION_LANGUAGES.includes(first),
      }).toEqual({ link: link.target, language: false });
    }
  });

  test("a docs link in another language, or on another site, is told apart", () => {
    expect(
      asEnglishLink(
        "https://oneuptime.com/docs/de/installation/docker-compose",
        "de",
      ),
    ).toBe("https://oneuptime.com/docs/installation/docker-compose");
    expect(
      asEnglishLink(
        "https://oneuptime.com/docs/fr/installation/docker-compose",
        "de",
      ),
    ).toBe("https://oneuptime.com/docs/fr/installation/docker-compose");
    expect(docsNamesOf("https://oneuptime.com.example.org/docs/de/a")).toBe(
      null,
    );
    expect(docsNamesOf("https://oneuptime.com/pricing")).toBe(null);
    expect(docsNamesOf("/README.md")).toBe(null);
    expect(docsNamesOf("mailto:sales@oneuptime.com")).toBe(null);
  });
});

describe("the README's links", () => {
  test.each(byLanguage)(
    "%s links only full https URLs, mailto: addresses and paths from the repository root",
    (_language, readme) => {
      const links = linksOf(readme.text);

      expect(links.length).toBeGreaterThan(30);
      expect(
        links.filter((link) => {
          return !ALLOWED_LINK.test(link.target);
        }),
      ).toEqual([]);
    },
  );

  test.each(byLanguage)(
    "every path %s links names a file or directory in the repository",
    (_language, readme) => {
      const missing = linksOf(readme.text)
        .filter((link) => {
          return link.target.startsWith("/");
        })
        .map((link) => {
          return decodeURIComponent(link.target.split("#")[0].split("?")[0]);
        })
        .filter((target) => {
          return !exists(target.slice(1));
        });

      expect(missing).toEqual([]);
    },
  );
});

describe("what the README says OneUptime is", () => {
  const introIndex = ENGLISH.text.split("\n").findIndex((line) => {
    return line.startsWith(
      "OneUptime is an open-source observability platform.",
    );
  });

  // A line without the right-to-left mark a Persian line can open with.
  function withoutMark(line) {
    return line.startsWith(RIGHT_TO_LEFT_MARK)
      ? line.slice(RIGHT_TO_LEFT_MARK.length)
      : line;
  }

  function introOf(readme) {
    return withoutMark(readme.text.split("\n")[introIndex]);
  }

  // The first paragraph of the docs' Getting Started page, after its title.
  function docsIntroOf(language) {
    const lines = read(`${DOCS_CONTENT}/${language}/${GETTING_STARTED}`).split(
      "\n",
    );

    return withoutMark(
      lines.find((line, index) => {
        return index > 0 && line.trim() !== "";
      }),
    );
  }

  test("the English intro is where the translations' intros are", () => {
    expect(introIndex).toBeGreaterThan(20);
  });

  test.each(byLanguage)(
    "%s opens with the docs' own Getting Started paragraph in its language",
    (language, readme) => {
      const intro = introOf(readme);
      const docsIntro = docsIntroOf(language);

      expect(intro.length).toBeGreaterThan(100);
      // The docs' paragraph ends by offering OneUptime Cloud or your own
      // servers; the README says that on a line of its own, linking Cloud.
      expect({ language, prefix: docsIntro.startsWith(intro) }).toEqual({
        language,
        prefix: true,
      });
      expect(docsIntro.length - intro.length).toBeLessThan(120);
    },
  );

  test("the chart's README describes OneUptime in the README's words", () => {
    const description = `${introOf(ENGLISH).split(". ").slice(0, 2).join(". ")}.`;

    expect(description).toBe(
      "OneUptime is an open-source observability platform. It checks that your websites, APIs and servers work, collects the logs, metrics and traces your apps send, pages whoever is on call when something breaks, and tells your customers on a status page.",
    );
    expect(read(CHART_README).split(WHITESPACE).join(" ")).toContain(
      description,
    );
  });
});

describe("installing with Docker Compose", () => {
  const packageJson = JSON.parse(read("package.json"));
  const configExample = read("config.example.env");
  const quickStart = codeBlocksOf(ENGLISH.text)[0];

  test.each(byLanguage)(
    "%s quotes the line npm start ends with",
    (_language, readme) => {
      expect(readme.text).toContain("**OneUptime is up!**");
    },
  );

  test("npm start ends with the status check, which says OneUptime is up only once the backend holds ready", () => {
    const statusCheck = read("Tests/Scripts/status-check.sh");

    expect(packageJson.scripts.start.endsWith("&& npm run status-check")).toBe(
      true,
    );
    expect(packageJson.scripts["status-check"]).toContain(
      "bash ./Tests/Scripts/status-check.sh",
    );
    expect(statusCheck.indexOf("Backend held ready across")).toBeGreaterThan(0);
    expect(statusCheck.indexOf("OneUptime is up!")).toBeGreaterThan(
      statusCheck.indexOf("Backend held ready across"),
    );
  });

  test.each(byLanguage)(
    "%s sends the reader to http://localhost, where a new config.env serves OneUptime",
    (_language, readme) => {
      expect(readme.text).toContain("`http://localhost`");
      expect(envValue(configExample, "HOST")).toBe("localhost");
      expect(envValue(configExample, "HTTP_PROTOCOL")).toBe("http");
      expect(envValue(configExample, "ONEUPTIME_HTTP_PORT")).toBe("80");
    },
  );

  test("the first account to sign up becomes the instance's admin", () => {
    expect(read("packages/Common/Server/Services/UserService.ts")).toContain(
      "data.user.isMasterAdmin = await this.isInstanceAwaitingFirstUser();",
    );
    expect(ENGLISH.text).toContain(
      "open `http://localhost` and sign up. The first account becomes the instance's admin.",
    );
  });

  test.each(byLanguage)(
    "%s says to set HOST in config.env on a server, the setting every container reads",
    (_language, readme) => {
      expect(readme.text).toContain("`HOST`");
      expect(readme.text).toContain("`config.env`");
      expect(trimmedLines(read("docker-compose.base.yml"))).toContain(
        "HOST: ${HOST}",
      );
    },
  );

  test("HOST is set before step 3, the step that starts OneUptime", () => {
    expect(quickStart).toContain("cp config.example.env config.env");
    expect(
      quickStart.slice(quickStart.indexOf("# 3. Start everything")),
    ).toEqual(["# 3. Start everything", "npm start"]);
    expect(ENGLISH.text).toContain(
      "On a server, set `HOST` in `config.env` to the server's domain name or IP address before step 3, and open that address instead.",
    );
  });

  test.each(byLanguage)(
    "%s asks for the memory its own Docker Compose guide gives as the minimum",
    (language, readme) => {
      const english = read(`${DOCS_CONTENT}/en/${COMPOSE_GUIDE}`).split("\n");
      const memoryRow = english.findIndex((line) => {
        return line.startsWith("| **Memory**");
      });

      expect(cellsOf(english[memoryRow])).toEqual([
        "**Memory**",
        "16 GB",
        "8 GB",
      ]);

      // The guide's translations keep its lines, so the row is on the same one.
      const row = read(`${DOCS_CONTENT}/${language}/${COMPOSE_GUIDE}`).split(
        "\n",
      )[memoryRow];
      const minimum = cellsOf(row)[2];

      expect(minimum.length).toBeGreaterThan(0);
      expect(readme.text).toContain(minimum);
    },
  );

  test("the README names the server and tools the guide asks for", () => {
    const guide = read(`${DOCS_CONTENT}/en/${COMPOSE_GUIDE}`);

    expect(guide).toContain(
      "- **Docker** with the **Docker Compose v2** plugin (the `docker compose` command).",
    );
    expect(guide).toContain("- **Git**, to fetch OneUptime.");
    expect(guide).toContain("- **Node.js and npm**");
    expect(guide).toContain("Debian, Ubuntu or RHEL-based Linux");
    expect(ENGLISH.text).toContain(
      "You need a Linux server with at least 8 GB of memory, and Docker, Docker Compose, Git and Node.js.",
    );

    for (const readme of READMES) {
      for (const name of ["Linux", "Docker Compose", "Git", "Node.js"]) {
        expect({
          readme: readme.language,
          name,
          named: readme.text.includes(name),
        }).toEqual({ readme: readme.language, name, named: true });
      }
    }
  });
});

describe("installing with Helm", () => {
  const chartReadme = read(CHART_README);
  const chartInstallation = read(`${CHART_DIR}/docs/installation.md`);

  test.each(byLanguage)(
    "%s gives the two Helm commands",
    (_language, readme) => {
      expect(codeBlocksOf(readme.text)[1]).toEqual([REPO_ADD, HELM_INSTALL]);
    },
  );

  test("the repository is the one the chart's README and installation guide add", () => {
    expect(trimmedLines(chartReadme)).toContain(REPO_ADD);
    expect(trimmedLines(chartInstallation)).toContain(REPO_ADD);
  });

  test("the chart is the one this repository builds, under the release name the chart's README installs, upgrades and uninstalls", () => {
    const chart = yaml.load(read(`${CHART_DIR}/Chart.yaml`));
    const [, , release, reference] = HELM_INSTALL.split(" ");
    const [repository, chartName] = reference.split("/");

    expect(REPO_ADD.split(" ")[3]).toBe(repository);
    expect(chart.name).toBe(chartName);
    expect(trimmedLines(chartReadme)).toContain(
      `helm install ${release} ${reference} -f values.yaml`,
    );
    expect(trimmedLines(chartReadme)).toContain(`helm uninstall ${release}`);
    expect(trimmedLines(chartInstallation)).toContain(
      `helm upgrade ${release} ${reference} -f values.yaml`,
    );
  });

  test("--set host= sets a value the chart has, which otherwise says localhost", () => {
    const schema = JSON.parse(read(`${CHART_DIR}/values.schema.json`));
    const values = yaml.load(read(`${CHART_DIR}/values.yaml`));

    expect(HELM_INSTALL.endsWith(" --set host=oneuptime.example.com")).toBe(
      true,
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.host.type).toBe("string");
    expect(values.host).toBe("localhost");
  });

  test.each(byLanguage)("%s says what host is for", (_language, readme) => {
    expect(readme.text).toContain("`host`");
  });
});

describe("the addresses the README gives", () => {
  test.each(byLanguage)(
    "%s signs up where the website's Get started button does",
    (_language, readme) => {
      expect(targetsOf(readme.text)).toContain(
        `${WEBSITE_ORIGIN}/accounts/register`,
      );
      expect(read("packages/Home/Views/Partials/home-hero.ejs")).toContain(
        'href="/accounts/register"',
      );
      expect(read("packages/App/FeatureSet/Accounts/src/App.tsx")).toContain(
        '<Route path="/accounts/register" element={<RegisterPage />} />',
      );
    },
  );

  test("the free plan needs no credit card, as the first Create New Project screen says on OneUptime Cloud", () => {
    const welcome = read(
      "packages/App/FeatureSet/Dashboard/src/Pages/Onboarding/Welcome.tsx",
    );
    const billing = welcome.indexOf("{BILLING_ENABLED && (");
    const noCard = welcome.indexOf(
      'translator.translateText("No credit card required.")',
    );

    expect(billing).toBeGreaterThan(0);
    expect(noCard).toBeGreaterThan(billing);
    expect(noCard - billing).toBeLessThan(200);
    expect(ENGLISH.text).toContain("The free plan needs no credit card.");
  });

  test.each(byLanguage)(
    "%s invites to the Slack the Dashboard's Help menu and the website's Support page open",
    (_language, readme) => {
      const invites = slackInvitesOf(readme.text);

      expect(invites).toHaveLength(1);
      expect(
        slackInvitesOf(
          read(
            "packages/App/FeatureSet/Dashboard/src/Components/Header/Help.tsx",
          ),
        ),
      ).toContain(invites[0]);
      expect(slackInvitesOf(read("packages/Home/Views/support.ejs"))).toContain(
        invites[0],
      );
    },
  );

  test.each(byLanguage)(
    "%s gives the website's support address and the Enterprise docs page's sales address",
    (_language, readme) => {
      expect(targetsOf(readme.text)).toContain("mailto:support@oneuptime.com");
      expect(targetsOf(readme.text)).toContain("mailto:sales@oneuptime.com");
      expect(read("packages/Home/Views/support.ejs")).toContain(
        'href="mailto:support@oneuptime.com"',
      );
      expect(read(`${DOCS_CONTENT}/en/self-hosted/enterprise.md`)).toContain(
        "sales@oneuptime.com",
      );
    },
  );

  test("SECURITY.md says how to report a vulnerability privately, and CONTRIBUTING.md how pull requests and licensing work", () => {
    expect(targetsOf(read(".github/SECURITY.md"))).toContain(
      "https://github.com/OneUptime/oneuptime/security/advisories/new",
    );

    const contributing = read(".github/CONTRIBUTING.md");

    expect(contributing).toContain(
      "All Code Changes Happen Through Pull Requests",
    );
    expect(contributing).toContain("## Licensing of contributions");
    expect(ENGLISH.text).toContain(
      "Report a security vulnerability privately, as [SECURITY.md](/.github/SECURITY.md) explains.",
    );
    expect(ENGLISH.text).toContain(
      "the [contributing guidelines](/.github/CONTRIBUTING.md) explain how pull requests and licensing work.",
    );
  });
});

describe("the README stays plain", () => {
  test.each(byLanguage)("%s has no emoji", (_language, readme) => {
    const lines = readme.text.split("\n").filter((line) => {
      return EMOJI.test(line);
    });

    expect(lines).toEqual([]);
  });

  test("the emoji check catches the emoji the README used to carry, and nothing a language writes", () => {
    for (const line of [
      "## \u{26A1} Quick Start",
      "### \u{2601}\u{FE0F} OneUptime Cloud, the easy way",
      "- \u{2B50} **Star this repo**",
      "<sub>Made with \u{2764}\u{FE0F} by the OneUptime team</sub>",
      "<b>\u{1F680} Try OneUptime Cloud</b>",
    ]) {
      expect(EMOJI.test(line)).toBe(true);
    }

    for (const readme of READMES) {
      expect(EMOJI.test(readme.text.split("\n").slice(0, 20).join("\n"))).toBe(
        false,
      );
    }
  });
});
