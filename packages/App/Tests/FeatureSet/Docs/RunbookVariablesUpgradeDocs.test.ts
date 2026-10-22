import { inlineCode } from "./DocsTranslationChecks";
import {
  UpgradingHeading,
  flattened,
  headingAtEnglishPlace,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
  upgradingHeadings,
} from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  RunbookVariableScope,
  readRunbookVariableReference,
} from "Common/Types/Runbook/RunbookVariableReference";
import { RUNNER_FEATURE_KUBECTL_SCRIPT } from "Common/Types/Runbook/RunnerFeatures";
import {
  LEGACY_KUBERNETES_CREDENTIAL_TYPE,
  MovedCredential,
  moveStep,
} from "Common/Server/Utils/Runbook/RunbookVariablesMove";
import { LEGACY_KUBERNETES_STEP_FIELDS } from "Common/Types/Runbook/RunbookLegacySteps";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says runbook secrets, and the credentials runbook
 * steps used, became runbook variables - and that SSH and kubectl steps take
 * a script - held to the code that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on the bundled global Runner (GlobalRunnerUpgradeDocs) and before the
 * note that visitors keep their own address (VisitorAddressesUpgradeDocs),
 * and every translation carries it in the English note's
 * place, with the English note's code and its link to Runbook Variables.
 * What it claims is what the upgrade does:
 *
 *   - the data migration that moves secrets and the credentials steps named
 *     into variables runs once on every install (Workers' DataMigrations);
 *   - {{runbookSecrets.NAME}} still reads the global variable NAME;
 *   - a kubectl step that runs a script goes only to a Runner that says it
 *     can run one, and an older Runner fails it saying so;
 *   - a moved Kubernetes step kept its credential and action for an older
 *     Runner until runbook credentials were removed: the note says so, in
 *     the past, and links to the note on the removal; a step moved now, or
 *     moved before, keeps neither, and no Runner is handed the old action.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const NOTE_LEAD: string =
  "**Runbook secrets and the credentials runbook steps used are runbook variables.**";
// The note before it (GlobalRunnerUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**Every install runs a global Runner of its own.**";
// The note after it (VisitorAddressesUpgradeDocs).
const NEXT_LEAD: string = "**Visitors keep their own address in more setups.**";

const VARIABLES_LINK: string = "(/docs/runbooks/variables)";
// The note on the removal of runbook credentials, on the same page.
const REMOVAL_HEADING: string = "Runbook credentials are removed";
const REMOVAL_LINK: string = "(#runbook-credentials-are-removed)";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on runbook variables", () => {
  it("is a note of the 13 → 14 changes, once, after the note on the bundled global Runner and before the note that visitors keep their own address", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says where variables live, what became of secrets and steps, and what needs a newer Runner", () => {
    for (const claim of [
      "global ones under **Runbooks → Settings → Global Variables**, which every runbook can use, and a runbook's own under its **Settings → Variables**.",
      "Every runbook secret is now a secret global variable of the same name, with its value, its Runners and its switch for global Runners, now called **Global Runners can use it**, and `{{runbookSecrets.NAME}}` still reads it.",
      "An SSH step now runs a bash script and signs in with a secret variable, and a Kubernetes step is now a kubectl step that runs a script of kubectl commands with a kubeconfig variable.",
      "The credentials stayed, on the **AI Access** page under **Runbooks → Runners**, for OneUptime AI's own commands, and a moved Kubernetes step kept its credential and action, so a Runner older than this release still ran it as it did, until [runbook credentials were removed](#runbook-credentials-are-removed).",
      "A new kubectl step, and a moved one once its script or kubeconfig is changed, needs a Runner of this release: an older one fails such a step and says so, so update your Runners.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }

    expect(ENGLISH_NOTE).toContain(`[Runbook Variables]${VARIABLES_LINK}`);
  });

  it("says no more that the credentials stay, or that an older Runner is still handed a moved step", () => {
    for (const gone of [
      "The credentials stay, under",
      "**Runbooks → Runners → AI Access**",
      "also keeps its credential and action",
      "still runs it as it did",
    ]) {
      expect({ gone, said: ENGLISH_NOTE.includes(gone) }).toEqual({
        gone,
        said: false,
      });
    }
  });

  it("links to the note on the removal, a heading of the same page", () => {
    const slugs: Array<string> = upgradingHeadings("en").map(
      (heading: UpgradingHeading): string => {
        return heading.slug;
      },
    );

    expect(REMOVAL_LINK).toBe(`(#${slugifyMarkdownHeading(REMOVAL_HEADING)})`);
    expect(slugs).toContain(slugifyMarkdownHeading(REMOVAL_HEADING));
    expect(ENGLISH_NOTE).toContain(REMOVAL_LINK);
  });
});

describe("the note is true to the upgrade", () => {
  it("moves secrets and the credentials steps named into variables, once, on every install", () => {
    const migrations: string = source(
      "App/FeatureSet/Workers/DataMigrations/Index.ts",
    );

    expect(migrations).toContain(
      'import MoveRunbookSecretsAndCredentialsToVariables from "./MoveRunbookSecretsAndCredentialsToVariables";',
    );
    expect(migrations).toContain(
      "new MoveRunbookSecretsAndCredentialsToVariables(),",
    );
  });

  it("still reads {{runbookSecrets.NAME}} as the global variable NAME", () => {
    expect(readRunbookVariableReference("runbookSecrets.NAME")).toEqual({
      scope: RunbookVariableScope.Global,
      name: "NAME",
    });
    expect(readRunbookVariableReference(" global.variables.NAME ")).toEqual({
      scope: RunbookVariableScope.Global,
      name: "NAME",
    });
  });

  it("hands a kubectl script only to a Runner that can run one, and fails it on an older one", () => {
    const ingress: string = source(
      "App/FeatureSet/Runbook/API/RunnerIngress.ts",
    );

    expect(RUNNER_FEATURE_KUBECTL_SCRIPT).toBe("kubectl-script");
    expect(ingress).toContain(
      "This kubectl step runs a script, and this Runner is too old to run one, so it was not run.",
    );
  });

  it("moves a Kubernetes step to its kubectl script with no credential or action beside it, and takes them off a step moved before", () => {
    const legacy: JSONObject = {
      credentialId: "11111111-1111-4111-8111-111111111111",
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
    };

    const moved: JSONObject | null = moveStep({
      step: {
        id: "k1",
        type: RunbookStepType.Kubernetes,
        config: { ...legacy, agentId: "runner" },
      },
      credentials: new Map<string, MovedCredential>([
        [
          "11111111-1111-4111-8111-111111111111",
          {
            credentialType: LEGACY_KUBERNETES_CREDENTIAL_TYPE,
            kubeconfigVariable: "prod-kubeconfig",
          },
        ],
      ]),
      secretNames: new Map<string, string>(),
    });
    const config: JSONObject = moved!["config"] as JSONObject;

    // The script and the kubeconfig, and nothing an older Runner was handed.
    expect(String(config["script"])).toContain("kubectl");
    expect(String(config["kubeconfig"])).toContain("prod-kubeconfig");

    for (const field of LEGACY_KUBERNETES_STEP_FIELDS) {
      expect({ field, kept: field in config }).toEqual({ field, kept: false });
    }

    /*
     * A step the first move left with its credential and action beside its
     * script has them taken off, and keeps its script and kubeconfig.
     */
    const movedBefore: JSONObject | null = moveStep({
      step: {
        id: "k2",
        type: RunbookStepType.Kubernetes,
        config: { ...config, ...legacy },
      },
      credentials: new Map<string, MovedCredential>(),
      secretNames: new Map<string, string>(),
    });

    expect(movedBefore!["config"]).toEqual(config);

    // No Runner is handed the old action any more.
    const ingress: string = source(
      "App/FeatureSet/Runbook/API/RunnerIngress.ts",
    );

    expect(ingress).not.toContain("claimLegacyKubernetesStep");
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, with the English code and the link to Runbook Variables",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(
          language,
          "Runbook secrets and the credentials runbook steps used are runbook variables.",
        ),
      );

      // The same code spans as the English note, nothing dropped or added.
      expect(inlineCode(note).sort()).toEqual(inlineCode(ENGLISH_NOTE).sort());

      expect(note).toContain(VARIABLES_LINK);

      // The link to the note on the removal names that note's heading here.
      expect(note).toContain(
        `(#${headingAtEnglishPlace(language, REMOVAL_HEADING).slug})`,
      );

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
    },
  );
});
