import {
  DocsFence,
  TRANSLATED_LANGUAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { lineShape } from "./DocsPageShape";
import {
  boldSpans,
  comparableFence,
  inlineCode,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the cloud marketplaces guide says about installing from AWS
 * Marketplace, held to the delivery option the launch page shows
 * (HelmChart/Marketplace/aws/delivery-option.json, sent with each version):
 *
 *   - the launch page's own eksctl command attaches a role the buyer already
 *     has (--attach-role-arn) and names no policy, so the guide gives the
 *     commands the usage instructions give: they create the service account
 *     the chart runs as, with a role that may call MeterUsage
 *     (AWSMarketplaceMeteringFullAccess);
 *   - the launch page's helm install command sets every override parameter
 *     with --set, which wins over a values file, so the guide has the buyer
 *     set them in that command, and keeps them in a values file for helm
 *     upgrade;
 *   - the troubleshooting line names the policy and points at the command;
 *   - every translation lays its lines where English does, with the English
 *     code, and keeps the code and the AWS labels of the AWS steps and the
 *     code of that line.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const PAGE: string = "installation/cloud-marketplaces";
const AWS_HEADING: string = "### AWS Marketplace";
const NEXT_HEADING: string = "### Microsoft Marketplace";
const METERING_POLICY_ARN: string =
  "arn:aws:iam::aws:policy/AWSMarketplaceMeteringFullAccess";

interface OverrideParameter {
  Key: string;
  DefaultValue: string;
}

interface AwsDeliveryOption {
  namespace: string;
  usageInstructions: string;
  overrideParameters: Array<OverrideParameter>;
}

interface Editions {
  aws: { serviceAccountName: string };
}

const readRepositoryFile: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
};

const DELIVERY: AwsDeliveryOption = JSON.parse(
  readRepositoryFile("HelmChart/Marketplace/aws/delivery-option.json"),
) as AwsDeliveryOption;

// The service account the AWS edition of the chart runs OneUptime as.
const SERVICE_ACCOUNT: string = (
  JSON.parse(
    readRepositoryFile("HelmChart/Marketplace/editions.json"),
  ) as Editions
).aws.serviceAccountName;

// The commands the usage instructions give, one per line there.
const USAGE_COMMANDS: Array<string> = DELIVERY.usageInstructions
  .split("\n")
  .map((line: string): string => {
    return line.trim();
  })
  .filter((line: string): boolean => {
    return line.startsWith("eksctl ");
  });

// A page's lines from its AWS heading to the next marketplace's.
const awsSection: (lang: string) => Array<string> = (
  lang: string,
): Array<string> => {
  const lines: Array<string> = readPage(lang, PAGE).split("\n");
  const start: number = lines.indexOf(AWS_HEADING);
  const end: number = lines.indexOf(NEXT_HEADING);

  expect({ lang, start: start >= 0, end: end > start }).toEqual({
    lang,
    start: true,
    end: true,
  });

  return lines.slice(start, end);
};

const awsFences: (lang: string, fenceLang: string) => Array<DocsFence> = (
  lang: string,
  fenceLang: string,
): Array<DocsFence> => {
  return scanMarkdown(awsSection(lang).join("\n")).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === fenceLang;
    },
  );
};

// A step of the AWS steps, by its number: the line "2. Give the cluster ...".
const awsStep: (lang: string, step: number) => string = (
  lang: string,
  step: number,
): string => {
  const lines: Array<string> = awsSection(lang).filter(
    (line: string): boolean => {
      return line.startsWith(`${step}. `);
    },
  );

  expect({ lang, step, lines: lines.length }).toEqual({
    lang,
    step,
    lines: 1,
  });

  return lines[0] as string;
};

// The AWS line of what to check when OneUptime cannot report.
const awsTroubleshooting: (lang: string) => string = (lang: string): string => {
  const lines: Array<string> = readPage(lang, PAGE)
    .split("\n")
    .filter((line: string): boolean => {
      return (
        line.startsWith("- **AWS") &&
        line.includes("AWSMarketplaceMeteringFullAccess")
      );
    });

  expect({ lang, lines: lines.length }).toEqual({ lang, lines: 1 });

  return lines[0] as string;
};

// A shell sample's commands, one each, with their continued lines joined.
const commandsOf: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return code
    .split(" \\\n")
    .join(" ")
    .split("\n")
    .map((line: string): string => {
      return line.replace(/\s+/g, " ").trim();
    })
    .filter((line: string): boolean => {
      return line !== "";
    });
};

describe("Installing OneUptime Enterprise from AWS Marketplace, in the cloud marketplaces guide", () => {
  it("gives the commands of the usage instructions, which create the role OneUptime meters with", () => {
    const fences: Array<DocsFence> = awsFences("en", "bash");

    expect(fences).toHaveLength(1);
    expect(commandsOf((fences[0] as DocsFence).code)).toEqual(USAGE_COMMANDS);
    expect(USAGE_COMMANDS).toEqual([
      "eksctl utils associate-iam-oidc-provider --cluster <cluster> --approve",
      `eksctl create iamserviceaccount --name ${SERVICE_ACCOUNT} --namespace ${DELIVERY.namespace} --cluster <cluster> --attach-policy-arn ${METERING_POLICY_ARN} --approve --override-existing-serviceaccounts`,
    ]);
    expect(DELIVERY.usageInstructions).not.toContain("--attach-role-arn");
  });

  it("has the buyer set every override parameter in the launch page's helm install command, and keep them for helm upgrade", () => {
    const step: Array<string> = inlineCode(awsStep("en", 3));

    expect(
      DELIVERY.overrideParameters
        .map((parameter: OverrideParameter): string => {
          return parameter.Key;
        })
        .sort(),
    ).toEqual(["host", "httpProtocol", "serviceAccount.name"]);

    for (const parameter of DELIVERY.overrideParameters) {
      expect(step).toContain(parameter.Key);
    }

    expect(step).toEqual(
      expect.arrayContaining(["helm install", SERVICE_ACCOUNT, "https"]),
    );
    expect(DELIVERY.usageInstructions).toContain(
      `\n   serviceAccount.name=${SERVICE_ACCOUNT} `,
    );

    const values: Array<DocsFence> = awsFences("en", "yaml");

    expect(values).toHaveLength(1);
    expect((values[0] as DocsFence).code).toBe(
      [
        "host: oneuptime.example.com",
        "httpProtocol: https",
        "serviceAccount:",
        `  name: ${SERVICE_ACCOUNT}`,
      ].join("\n"),
    );
  });

  it("names the policy, and the command that creates the role, where OneUptime cannot report to AWS", () => {
    const line: string = awsTroubleshooting("en");

    expect(inlineCode(line)).toEqual(
      expect.arrayContaining([
        SERVICE_ACCOUNT,
        "AWSMarketplaceMeteringFullAccess",
        "eksctl",
        `kubectl rollout restart deployment --namespace ${DELIVERY.namespace}`,
      ]),
    );
    expect(line).toContain("](#aws-marketplace)");
  });

  it("says the same in every language: the English lines, code and labels", () => {
    const english: string = readPage("en", PAGE);
    const englishFences: Array<string> =
      scanMarkdown(english).fences.map(comparableFence);

    for (const lang of TRANSLATED_LANGUAGES) {
      const page: string = readPage(lang, PAGE);

      expect({ lang, shape: lineShape(page) }).toEqual({
        lang,
        shape: lineShape(english),
      });
      expect({
        lang,
        fences: scanMarkdown(page).fences.map(comparableFence),
      }).toEqual({ lang, fences: englishFences });

      for (const step of [2, 3]) {
        expect({
          lang,
          step,
          code: inlineCode(awsStep(lang, step)),
          labels: boldSpans(awsStep(lang, step)),
        }).toEqual({
          lang,
          step,
          code: inlineCode(awsStep("en", step)),
          labels: boldSpans(awsStep("en", step)),
        });
      }

      expect({ lang, code: inlineCode(awsTroubleshooting(lang)) }).toEqual({
        lang,
        code: inlineCode(awsTroubleshooting("en")),
      });
      expect({
        lang,
        link: awsTroubleshooting(lang).includes("](#aws-marketplace)"),
      }).toEqual({ lang, link: true });
    }
  });
});
