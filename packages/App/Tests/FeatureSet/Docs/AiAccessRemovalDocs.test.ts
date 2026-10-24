import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  LocalizedNavGroup,
  LocalizedNavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DOCS_DIR,
  DocsLink,
  NAV_PAGES,
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  boldSpans,
  inlineCode,
  listItemCount,
  prose,
} from "./DocsTranslationChecks";
import {
  UpgradingHeading,
  flattened,
  headingAtEnglishPlace,
  sectionAtEnglishPlace,
  upgradingHeadings,
  upgradingPage,
} from "./UpgradingDocsNotes";
import { RemoveRunbookCredentials1805780000000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1805780000000-RemoveRunbookCredentials";
import { REMOVED_SSH_COMMAND_MESSAGE } from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import Permission from "Common/Types/Permission";
import { RUNNER_FEATURE_KUBECTL_SCRIPT } from "Common/Types/Runbook/RunnerFeatures";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import fs from "fs";
import path from "path";

/*
 * RUNBOOKS > RUNNERS > AI ACCESS IS GONE, AND THE RUNBOOK CREDENTIALS IT HELD.
 *
 * They were how OneUptime AI's own commands reached a server over SSH, or a
 * Kubernetes cluster from a Runner outside it. Hosts and Kubernetes
 * clusters have AI agents of their own now, which run OneUptime AI's
 * commands with their own access, and runbook steps sign in with runbook
 * variables. What the docs say about it, held to the code that makes it
 * true:
 *
 *   - the AI Access page (runbooks/credentials) is gone in every language,
 *     from the docs menu and every docs locale, and no page of any language,
 *     nor the Dashboard, links to it; its old address, in every shape it
 *     was reachable, opens the Infrastructure AI Agents page in one hop
 *     (Docs/Index.ts), and that page renders;
 *   - the upgrade guide's note "Runbook credentials are removed" sits after
 *     "What AI may do is set on the AI agent" and says what the upgrade
 *     does, each claim tied to what does it: the data migration
 *     (RunbookCredentialsRemoval), the schema migration, the Runner claim's
 *     and the plan approval's refusals, the runbook save's refusal, and the
 *     Dashboard's redirect of the page's old address; every translation
 *     carries it in the English note's place, with its code and links, and
 *     the older notes that sent readers to the page now send them to it;
 *   - a workflow's step is still never lent the read of a setting that holds
 *     credentials, now that runbook credentials are not one of them, and no
 *     page says a step is answered by whoever last saved it (moved here from
 *     CredentialsReachAiRunnersDocs, which went with the credentials).
 *
 * The routes run with the docs' real routes and templates, without booting
 * the database-backed application: only infrastructure outside docs is
 * replaced, as FormsDocsRedirects does.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const nodeFs: typeof fs = jest.requireActual("fs") as typeof fs;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return nodeFs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return nodeFs.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendMarkdownResponse: (
        _req: unknown,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.type("text/markdown").send(content);
      },
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn() },
  };
});
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    GoogleTagManagerEnabled: false,
  };
});
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/LlmsTxt", () => {
  return {
    __esModule: true,
    default: {},
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/Placeholders", () => {
  return {
    __esModule: true,
    default: {
      render: (content: string): string => {
        return content;
      },
    },
  };
});

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

// The page that is gone, and the one its old address opens.
const OLD_PAGE: string = "runbooks/credentials";
const OLD_PAGE_URL: string = `/docs/${OLD_PAGE}`;
const NEW_PAGE: string = "ai/infrastructure-ai-agents";

// The upgrade guide's note on the removal, and the notes around it.
const NOTE_HEADING: string = "Runbook credentials are removed";
const NOTE_ANCHOR: string = "#runbook-credentials-are-removed";
const PREVIOUS_HEADING: string = "What AI may do is set on the AI agent";
const NEXT_HEADING: string = "Enable AI is the only AI switch";

// The four permissions the schema migration takes off teams, keys and roles.
const REMOVED_PERMISSIONS: Array<string> = [
  "CreateRunbookCredential",
  "EditRunbookCredential",
  "DeleteRunbookCredential",
  "ReadRunbookCredential",
];

const STEPS_LINK: string =
  "(/docs/workflows/configuration#what-workflow-steps-can-do)";

// A bold menu path that ends on the AI Access page.
const AI_ACCESS_PATH_END: RegExp = /→\s*AI Access$/;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// Every file under a directory of the repository, by its path from `packages`.
function filesUnder(relativeDirectory: string): Array<string> {
  const files: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
      } else {
        files.push(path.relative(PACKAGES_DIR, full));
      }
    }
  };

  walk(path.join(PACKAGES_DIR, relativeDirectory));

  return files;
}

// The note's English text, its paragraphs and items each on one line.
function englishNote(): string {
  return flattened(sectionAtEnglishPlace("en", NOTE_HEADING));
}

function expectSaid(text: string, claims: Array<string>): void {
  for (const claim of claims) {
    expect({ claim, said: text.includes(claim) }).toEqual({
      claim,
      said: true,
    });
  }
}

// The page parts of a section's links, in order ("" for an in-page link).
function linkedPages(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return link.target.split("#")[0] as string;
  });
}

// The text of a paragraph or list item of `markdown` that starts with `opening`.
function paragraphStartingWith(markdown: string, opening: string): string {
  return (
    markdown
      .split(/\n\s*\n|\n(?=- )/)
      .map((paragraph: string): string => {
        return flattened(paragraph);
      })
      .find((paragraph: string): boolean => {
        return paragraph.startsWith(opening);
      }) || ""
  );
}

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

type FetchManualFunction = (pathname: string) => Promise<Response>;

const fetchManual: FetchManualFunction = async (
  pathname: string,
): Promise<Response> => {
  return await fetch(`${origin}${pathname}`, { redirect: "manual" });
};

// The first line of the page the old address opens, in a language.
function newPageTitleLine(lang: string): string {
  return readPage(hasPage(lang, NEW_PAGE) ? lang : "en", NEW_PAGE).split(
    "\n",
  )[0] as string;
}

describe("the AI Access page's old address", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "opens the Infrastructure AI Agents page in %s, as HTML and as Markdown, in one hop to a page that renders",
    async (lang: string) => {
      for (const prefix of ["/docs", "/docs/as-markdown"]) {
        const response: Response = await fetchManual(
          `${prefix}/${lang}/${OLD_PAGE}`,
        );
        const destination: string = `${prefix}/${lang}/${NEW_PAGE}`;

        expect({ prefix, status: response.status }).toEqual({
          prefix,
          status: 301,
        });
        expect(response.headers.get("location")).toBe(destination);

        const page: Response = await fetchManual(destination);

        expect({ destination, status: page.status }).toEqual({
          destination,
          status: 200,
        });

        const content: string = await page.text();

        if (prefix === "/docs") {
          expect(content).toContain('id="docs-content"');
          expect(content).toContain(`/docs/${lang}/${NEW_PAGE}`);
        } else {
          expect(content.startsWith(`${newPageTitleLine(lang)}\n`)).toBe(true);
        }
      }
    },
  );

  it("opens the English page from an address without a language, straight to the address to keep", async () => {
    const html: Response = await fetchManual(OLD_PAGE_URL);

    expect(html.status).toBe(301);
    expect(html.headers.get("location")).toBe(`/docs/en/${NEW_PAGE}`);

    const markdown: Response = await fetchManual(
      `/docs/as-markdown/${OLD_PAGE}`,
    );

    expect(markdown.status).toBe(301);
    expect(markdown.headers.get("location")).toBe(
      `/docs/as-markdown/${NEW_PAGE}`,
    );
  });

  it("lands on a page that renders, following every hop", async () => {
    for (const pathname of [OLD_PAGE_URL, `/docs/as-markdown/${OLD_PAGE}`]) {
      const response: Response = await fetch(`${origin}${pathname}`);

      expect({ pathname, status: response.status }).toEqual({
        pathname,
        status: 200,
      });
      expect(await response.text()).toContain("Infrastructure AI Agents");
    }
  });

  it("does not send an unsupported language to a page that does not exist", async () => {
    const response: Response = await fetchManual(`/docs/invalid/${OLD_PAGE}`);

    expect(response.headers.get("location") || "").not.toContain(
      `/docs/invalid/${NEW_PAGE}`,
    );
  });
});

describe("the AI Access page is gone from the docs", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s has no AI Access page, and none of its pages links to it",
    (lang: string) => {
      expect(hasPage(lang, OLD_PAGE)).toBe(false);

      const linking: Array<string> = listPages(lang).filter(
        (page: string): boolean => {
          return readPage(lang, page).includes(OLD_PAGE_URL);
        },
      );

      expect(linking).toEqual([]);
    },
  );

  it("is in no docs menu and no docs locale", () => {
    expect(NAV_PAGES).not.toContain(OLD_PAGE);

    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const urls: Array<string> = getLocalizedNav(lang).flatMap(
        (group: LocalizedNavGroup): Array<string> => {
          return group.links.map((link: LocalizedNavLink): string => {
            return link.url;
          });
        },
      );

      expect({ lang, listed: urls.includes(OLD_PAGE_URL) }).toEqual({
        lang,
        listed: false,
      });

      const locale: { navLinks?: Record<string, string> } = JSON.parse(
        fs.readFileSync(path.join(DOCS_DIR, "Locales", `${lang}.json`), "utf8"),
      ) as { navLinks?: Record<string, string> };

      expect({ lang, key: "AI Access" in (locale.navLinks || {}) }).toEqual({
        lang,
        key: false,
      });
    }
  });

  it("is named in a menu path by no English page", () => {
    const paths: Array<string> = listPages("en").flatMap(
      (page: string): Array<string> => {
        return boldSpans(prose(readPage("en", page)))
          .filter((span: string): boolean => {
            return AI_ACCESS_PATH_END.test(span);
          })
          .map((span: string): string => {
            return `${page}: ${span}`;
          });
      },
    );

    expect(paths).toEqual([]);
  });

  it("is linked from nowhere in the Dashboard, which has no route to it", () => {
    const linking: Array<string> = filesUnder(
      "App/FeatureSet/Dashboard/src",
    ).filter((file: string): boolean => {
      return source(file).includes(OLD_PAGE_URL);
    });

    expect(linking).toEqual([]);

    expect(
      source("App/FeatureSet/Dashboard/src/Utils/PageMap.ts"),
    ).not.toContain("RUNBOOKS_RUNNER_CREDENTIALS");
    expect(
      fs.existsSync(
        path.join(
          PACKAGES_DIR,
          "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials.tsx",
        ),
      ),
    ).toBe(false);
  });
});

describe("the upgrade guide's note on the removal", () => {
  it("sits after the note on what AI may do and before the note on the Enable AI switch", () => {
    const headings: Array<string> = upgradingHeadings("en").map(
      (heading: UpgradingHeading): string => {
        return heading.text;
      },
    );
    const at: number = headings.indexOf(NOTE_HEADING);

    expect(at).toBeGreaterThan(0);
    expect(
      headings.filter((text: string): boolean => {
        return text === NOTE_HEADING;
      }),
    ).toHaveLength(1);
    expect(headings[at - 1]).toBe(PREVIOUS_HEADING);
    expect(headings[at + 1]).toBe(NEXT_HEADING);
    expect(headingAtEnglishPlace("en", NOTE_HEADING).slug).toBe(
      NOTE_ANCHOR.slice(1),
    );
  });

  it("says the AI Access page and its credentials are gone, and what took their place", () => {
    expectSaid(englishNote(), [
      "The **AI Access** page under **Runbooks → Runners** is gone, and the runbook credentials it held with it.",
      "They were how OneUptime AI's own commands reached a server over SSH, or a Kubernetes cluster from a Runner outside it.",
      "Hosts and Kubernetes clusters have AI agents of their own now, which run OneUptime AI's commands with their own access, and runbook steps sign in with [runbook variables](/docs/runbooks/variables).",
    ]);
  });

  it("says the credentials are deleted once the steps that still name one are moved, as the data migration does", () => {
    expectSaid(englishNote(), [
      "**The credentials are deleted.** A runbook step that still named one is moved to secret runbook variables first, the way the move to variables moved the others, and runs as it did.",
    ]);

    const removal: string = source(
      "Common/Server/Utils/Runbook/RunbookCredentialsRemoval.ts",
    );
    const move: number = removal.indexOf(
      "RunbookVariablesMove.moveAll(query, {",
    );
    const clear: number = removal.indexOf(
      "RunbookCredentialsRemoval.clearOutsideRunnerBindings(query)",
    );
    const remove: number = removal.indexOf(
      "RunbookCredentialsRemoval.deleteCredentials(query)",
    );

    // Moved first, then the bindings cleared, then the credentials deleted.
    expect(move).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(move);
    expect(remove).toBeGreaterThan(clear);
    expect(removal).toContain(
      'export const DELETE_CREDENTIALS_SQL: string = `DELETE FROM "RunbookCredential"`;',
    );

    // The Workers run it once, right after the move to variables.
    const migrations: string = source(
      "App/FeatureSet/Workers/DataMigrations/Index.ts",
    );
    const moved: number = migrations.indexOf(
      "new MoveRunbookSecretsAndCredentialsToVariables(),",
    );
    const removed: number = migrations.indexOf(
      "new RemoveRunbookCredentials(),",
    );

    expect(moved).toBeGreaterThan(0);
    expect(removed).toBeGreaterThan(moved);
    expect(
      migrations.slice(moved, removed).match(/new [A-Za-z]+\(\),/g),
    ).toEqual(["new MoveRunbookSecretsAndCredentialsToVariables(),"]);
  });

  it("says every kubectl step needs a Runner that runs kubectl scripts, the release the variables page names", () => {
    expectSaid(englishNote(), [
      "A Kubernetes step moved earlier keeps no credential or action for an older Runner any more: every kubectl step needs a Runner of 14.0.79 or later.",
    ]);

    const ingress: string = source(
      "App/FeatureSet/Runbook/API/RunnerIngress.ts",
    );

    expect(RUNNER_FEATURE_KUBECTL_SCRIPT).toBe("kubectl-script");
    expect(ingress).toContain("RUNNER_FEATURE_KUBECTL_SCRIPT");
    expect(ingress).toContain(
      "errorMessage: RunnerIngressAPI.KUBECTL_SCRIPT_NEEDS_NEWER_RUNNER,",
    );
    expect(ingress).not.toContain("claimLegacyKubernetesStep");

    // The same release on the variables page.
    expect(flattened(readPage("en", "runbooks/variables"))).toContain(
      "A Runner older than this release (14.0.79) cannot run a kubectl script",
    );
  });

  it("says OneUptime AI runs no SSH command, as the plan approval and the Runner claim refuse one", () => {
    expectSaid(englishNote(), [
      "**OneUptime AI runs no SSH command.** A plan that holds one is no longer approved, and a command queued before the upgrade fails, saying why.",
      "A host is fixed through its [AI agent](/docs/ai/infrastructure-ai-agents), or by a runbook whose SSH step signs in with a variable.",
    ]);

    // Approving such a plan is refused, before anything is read.
    expect(REMOVED_SSH_COMMAND_MESSAGE).toContain(
      "OneUptime AI no longer runs SSH commands",
    );
    expect(source("Common/Server/API/AutoRemediationAPI.ts")).toContain(
      "runs over SSH. ${REMOVED_SSH_COMMAND_MESSAGE}",
    );

    // A command queued with a credential fails when a Runner claims it.
    const ingress: string = source(
      "App/FeatureSet/Runbook/API/RunnerIngress.ts",
    );

    expect(ingress).toContain(
      '"OneUptime AI composed this command to run with a runbook credential, and runbook credentials were removed, so it was not run.',
    );
    expect(ingress).toContain(
      "errorMessage: RunnerIngressAPI.getRemovedCredentialRefusal(job),",
    );
  });

  it("says a cluster bound to a Runner outside it is cleared, and one on its previous in-cluster Runner keeps it, as the data migration does", () => {
    expectSaid(englishNote(), [
      "**A cluster bound to a Runner outside it is cleared.** OneUptime AI reaches it through its Kubernetes AI agent, which the Kubernetes agent chart installs, and its AI settings follow that agent's configuration like any other cluster's.",
      "A cluster still bound to its previous in-cluster Runner keeps it until the chart is upgraded.",
    ]);

    const removal: string = source(
      "Common/Server/Utils/Runbook/RunbookCredentialsRemoval.ts",
    );

    expect(removal).toContain(
      'UPDATE "KubernetesCluster" SET "aiAccessRunnerId" = NULL, "updatedAt" = now() WHERE "_id" = $1 AND "aiAccessRunnerId" = $2',
    );
    // A kubernetes-agent Runner - the cluster's own in-cluster one - is kept.
    expect(removal).toContain("RunnerServiceClass.isKubernetesAgentRunnerRow(");

    // Its AI settings follow the agent whatever Runner it was bound to.
    expect(
      source("Common/Server/Services/KubernetesAiAgentService.ts"),
    ).toContain("isAgentTheExecutor: true,");
  });

  it("says the four Runbook Credential permissions are removed from teams, API keys and custom roles, as the schema migration removes them", async () => {
    expectSaid(englishNote(), [
      "**The four Runbook Credential permissions are removed** from every team, API key and custom role that held them. Nothing else they hold changes.",
    ]);

    const queries: Array<{ sql: string; parameters: Array<unknown> }> = [];
    const queryRunner: {
      query: (sql: string, parameters?: Array<unknown>) => Promise<void>;
    } = {
      query: async (
        sql: string,
        parameters?: Array<unknown>,
      ): Promise<void> => {
        queries.push({ sql, parameters: parameters || [] });
      },
    };

    await new RemoveRunbookCredentials1805780000000().up(
      queryRunner as unknown as Parameters<
        RemoveRunbookCredentials1805780000000["up"]
      >[0],
    );

    const deletes: Array<{ sql: string; parameters: Array<unknown> }> =
      queries.filter((query: { sql: string }): boolean => {
        return query.sql.startsWith("DELETE FROM");
      });

    expect(
      deletes.map((query: { sql: string }): string => {
        return query.sql;
      }),
    ).toEqual([
      'DELETE FROM "TeamPermission" WHERE "permission" = ANY($1::text[])',
      'DELETE FROM "ApiKeyPermission" WHERE "permission" = ANY($1::text[])',
      'DELETE FROM "CustomRolePermission" WHERE "permission" = ANY($1::text[])',
    ]);

    for (const query of deletes) {
      expect(query.parameters).toEqual([REMOVED_PERMISSIONS]);
    }

    // Four, and none of them is a permission any more.
    expect(REMOVED_PERMISSIONS).toHaveLength(4);

    for (const name of REMOVED_PERMISSIONS) {
      expect({
        name,
        permission: (Object.values(Permission) as Array<string>).includes(name),
      }).toEqual({ name, permission: false });
    }
  });

  it("says what the API and Terraform lose, and that a step given a credential is refused, as the models and the runbook save do", () => {
    expectSaid(englishNote(), [
      "**API and Terraform.** `RunbookCredential` and the Terraform resource `oneuptime_runbook_credential` are gone, and so is a Kubernetes cluster's `aiAccessCredentialId` (`ai_access_credential_id`).",
      "A save that gives a runbook step a `credentialId` is refused: write the step as a script that signs in with a variable.",
    ]);

    // No model, so no API and no Terraform resource.
    expect(
      fs.existsSync(
        path.join(
          PACKAGES_DIR,
          "Common/Models/DatabaseModels/RunbookCredential.ts",
        ),
      ),
    ).toBe(false);
    expect(source("Common/Models/DatabaseModels/Index.ts")).not.toContain(
      "RunbookCredential",
    );
    expect(source("App/FeatureSet/BaseAPI/Index.ts")).not.toContain(
      "RunbookCredential",
    );
    expect(
      source("Common/Models/DatabaseModels/KubernetesCluster.ts"),
    ).not.toContain("aiAccessCredential");

    // The schema migration drops the cluster's column.
    expect(
      source(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1805780000000-RemoveRunbookCredentials.ts",
      ),
    ).toContain(
      'ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessCredentialId"',
    );

    // The save's refusal, and what it says to do.
    expect(source("Common/Server/Services/RunbookService.ts")).toContain(
      '"names a runbook credential, and runbook credentials were removed. An SSH or kubectl step signs in with a secret runbook variable: give the step a script and pick the variable',
    );
  });

  it("says the AI Access page's old address opens the Runners, as the Dashboard's routes do", () => {
    expectSaid(englishNote(), [
      "The **AI Access** page's old address opens **Runbooks → Runners**.",
    ]);

    expect(
      source("App/FeatureSet/Dashboard/src/Routes/MovedPagePaths.ts"),
    ).toContain(
      'export const MOVED_RUNNER_CREDENTIALS_PATH: string = "runner-credentials";',
    );
    expect(
      source("App/FeatureSet/Dashboard/src/Routes/RunbookRoutes.tsx").replace(
        /\s+/g,
        " ",
      ),
    ).toContain(
      "path={MOVED_RUNNER_CREDENTIALS_PATH} element={<MovedPageRedirect pageMap={PageMap.RUNBOOKS_RUNNERS} />}",
    );
  });

  it("is where the older notes that sent readers to the AI Access page send them now", () => {
    const page: string = flattened(upgradingPage("en"));

    // The note on SSH credentials reaching AI Runners, and the one on variables.
    expect(page).toContain(
      `See [Runbook credentials are removed](${NOTE_ANCHOR}) and [What workflow steps can do]${STEPS_LINK}.`,
    );
    expect(page).toContain(
      `until [runbook credentials were removed](${NOTE_ANCHOR}).`,
    );
    expect(page).not.toContain(OLD_PAGE_URL);
  });

  it.each(TRANSLATED_LANGUAGES)(
    "%s carries the note in the English note's place, with its code, links and kept names",
    (lang: string) => {
      const english: string = sectionAtEnglishPlace("en", NOTE_HEADING);
      const translated: string = sectionAtEnglishPlace(lang, NOTE_HEADING);
      const heading: UpgradingHeading = headingAtEnglishPlace(
        lang,
        NOTE_HEADING,
      );

      // A translated heading, after the translated note on what AI may do.
      expect(heading.text).not.toBe(NOTE_HEADING);
      expect(heading.level).toBe(3);

      // The same code, in the same order, and the same pages linked.
      expect(inlineCode(flattened(translated))).toEqual(
        inlineCode(flattened(english)),
      );
      expect(linkedPages(translated)).toEqual(linkedPages(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));

      // The page that is gone is named as it was, as the guide names removed settings.
      expect(translated.split("**AI Access**").length - 1).toBe(
        english.split("**AI Access**").length - 1,
      );

      // The older notes link to it here, by its heading in this language.
      const page: string = upgradingPage(lang);

      expect(page).not.toContain(OLD_PAGE_URL);
      expect(
        page.split(`(#${heading.slug})`).length - 1,
      ).toBeGreaterThanOrEqual(2);
    },
  );
});

describe("what a workflow's step may do, with runbook credentials gone", () => {
  it("What workflow steps can do says a step is never lent the read of settings that hold credentials, after what a Project Admin may do", () => {
    const configuration: string = readPage("en", "workflows/configuration");
    const admin: number = configuration.indexOf(
      "- **Only what a Project Admin may do.**",
    );
    const credentials: number = configuration.indexOf(
      "- **Not the read of settings that hold credentials.**",
    );
    const plan: number = configuration.indexOf(
      "- **Only what your plan includes.**",
    );

    expect(admin).toBeGreaterThan(0);
    expect(credentials).toBeGreaterThan(admin);
    expect(plan).toBeGreaterThan(credentials);

    const bullet: string = flattened(configuration.slice(credentials, plan));

    expectSaid(bullet, [
      "A Project Admin may read SMTP servers, call and SMS providers, SNMP credentials, video call connections and API keys, but a step is never lent that, whoever built or saved the workflow.",
      "A step can't name one of these settings, such as the SMTP server a status page sends email with or the API key a permission is granted to.",
      "The step is refused, and its run log says a person who may read them (the read permission of that kind of setting, or a Project Owner or Project Admin) has to make the change.",
      "A step that keeps the setting a record names already, or clears it, is not refused.",
    ]);

    for (const gone of [
      "last saved",
      "runbook credential",
      "Read Runbook Credential",
      "SSH credentials",
    ]) {
      expect({ gone, said: bullet.includes(gone) }).toEqual({
        gone,
        said: false,
      });
    }
  });

  it("Runbook Agents says a rule's pick is what lets OneUptime AI's commands run on a Runner, and asks for no credential's read", () => {
    const agents: string = flattened(readPage("en", "runbooks/agents"));

    expect(agents).toContain(
      "An AI rule picks the Runner OneUptime AI runs its commands on: picking a Runner there is what lets OneUptime AI's commands run on it.",
    );
    expect(agents).not.toContain("Picking one that holds SSH credentials");
    expect(agents).not.toContain("read runbook credentials");
  });

  it("no English page says a workflow's step is answered by whoever last saved it", () => {
    const pages: Array<string> = listPages("en").filter(
      (page: string): boolean => {
        const flat: string = flattened(readPage("en", page));

        return (
          flat.includes("last saved the workflow") ||
          flat.includes("records that person")
        );
      },
    );

    expect(pages).toEqual([]);
  });

  it("the upgrade note on SSH credentials keeps its history, after the chat buttons and before the endpoint changes", () => {
    const page: string = upgradingPage("en");
    const lead: string = paragraphStartingWith(
      page,
      "- **An SSH credential reaches a Runner that runs OneUptime AI's commands only through someone who may read runbook credentials.**",
    );
    const here: number = page.indexOf(
      "- **An SSH credential reaches a Runner that runs OneUptime AI's commands only\n",
    );
    const buttons: number = page.indexOf(
      "- **Slack and Microsoft Teams buttons act as the OneUptime member who",
    );
    const endpoints: number = page.indexOf(
      "- See [API and endpoint changes](#api-and-endpoint-changes) above for the",
    );

    expect(buttons).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(buttons);
    expect(endpoints).toBeGreaterThan(here);

    expectSaid(lead, [
      "A workflow's steps act as a Project Admin but are never lent the read of runbook credentials, or of any other setting that holds credentials:",
      // For an install that ran 14.0.26 to 14.0.31.
      "Upgrading from 14.0.26 to 14.0.31: those releases asked instead about the person who last saved a workflow's steps, recorded in a read-only `lastSavedByUserId` column on workflows.",
      "That column is dropped on start, the API and Terraform no longer return it, and a step is refused whoever saved the workflow.",
      `[Runbook credentials are removed](${NOTE_ANCHOR})`,
      STEPS_LINK,
    ]);
    expect(lead).not.toContain("OneUptime records that person");
  });

  it("the upgrade note on workflow steps says a step names no setting that holds credentials", () => {
    const text: string = flattened(
      sectionAtEnglishPlace("en", "Workflow steps act as a Project Admin"),
    );

    expectSaid(text, [
      "A step is never lent the read of settings that hold credentials: a person who may read them has to make that change.",
      "A step that keeps the one a record names already, or clears it, is not refused.",
    ]);
  });
});
