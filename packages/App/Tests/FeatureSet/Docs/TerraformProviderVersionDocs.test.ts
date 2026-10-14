import DocsPlaceholders, {
  TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER,
  TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER,
  TERRAFORM_PROVIDER_VERSION_PLACEHOLDER,
  getTerraformProviderMajorVersion,
  getTerraformProviderMatchingConstraint,
  getTerraformProviderVersionConstraint,
} from "../../../FeatureSet/Docs/Utils/Placeholders";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Terraform pages recommended `version = "~> 11.0"` for three majors
 * after 11 - a constraint that installs a provider that old, without any of
 * the fixes since. The constraint is filled in from the version of the
 * OneUptime serving the page now ({{TERRAFORM_PROVIDER_VERSION}}), and no
 * Terraform page may write a major down again.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const APP_PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf-8"),
).version;

function terraformPages(): Array<string> {
  const pages: Array<string> = [];

  for (const lang of fs.readdirSync(CONTENT_DIR)) {
    const dir: string = path.join(CONTENT_DIR, lang, "terraform");

    if (!fs.existsSync(dir)) {
      continue;
    }

    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".md")) {
        pages.push(path.join(dir, file));
      }
    }
  }

  return pages;
}

describe("the provider version constraint", () => {
  it.each([
    ["14.0.21", "~> 14.0"],
    ["v14.2.0", "~> 14.0"],
    ["12.3", "~> 12.0"],
    ["1.0.0", "~> 1.0"],
  ])("for OneUptime %s is %s", (version: string, constraint: string) => {
    expect(getTerraformProviderVersionConstraint(version)).toBe(constraint);
  });

  it.each([["unknown"], [""], ["latest"]])(
    "without a version (%p) is the newest provider, not a guessed major",
    (version: string) => {
      expect(getTerraformProviderVersionConstraint(version)).toBe(">= 1.0");
      expect(getTerraformProviderMajorVersion(version)).toBeNull();
    },
  );

  it("is this release's when rendered", () => {
    const major: string = APP_PACKAGE_VERSION.split(".")[0]!;

    expect(
      DocsPlaceholders.render(
        `version = "${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}"`,
      ),
    ).toBe(`version = "~> ${major}.0"`);
  });
});

/*
 * A self-hosted OneUptime takes the newest provider that is not newer than
 * itself: {{TERRAFORM_PROVIDER_MATCHING}} is that range for the OneUptime
 * serving the page, as the dashboard's Terraform pages write it
 * (TerraformOperationsDocsFacts holds the two to each other).
 */
describe("the self-hosted range", () => {
  it.each([
    ["14.0.21", ">= 14.0, <= 14.0.21"],
    ["v14.2.0", ">= 14.0, <= 14.2.0"],
    [" 15.0.3 ", ">= 15.0, <= 15.0.3"],
  ])("for OneUptime %s is %s", (version: string, constraint: string) => {
    expect(getTerraformProviderMatchingConstraint(version)).toBe(constraint);
  });

  it.each([["1.0.0"], ["14.0"], ["unknown"], [""]])(
    "without a release's version (%p) is the newest provider of the major, as the version placeholder",
    (version: string) => {
      expect(getTerraformProviderMatchingConstraint(version)).toBe(
        getTerraformProviderVersionConstraint(version),
      );
    },
  );

  it("is this release's when rendered, every time it is written", () => {
    const major: string = APP_PACKAGE_VERSION.split(".")[0]!;
    const rendered: string = DocsPlaceholders.render(
      [
        `version = "${TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER}"`,
        `\`${TERRAFORM_PROVIDER_MATCHING_PLACEHOLDER}\``,
      ].join("\n"),
    );

    expect(rendered).not.toContain("{{TERRAFORM_PROVIDER");
    expect(rendered).toBe(
      [
        `version = ">= ${major}.0, <= ${APP_PACKAGE_VERSION}"`,
        `\`>= ${major}.0, <= ${APP_PACKAGE_VERSION}\``,
      ].join("\n"),
    );
  });
});

describe("rendering", () => {
  it("fills in every occurrence of both placeholders", () => {
    const major: string = APP_PACKAGE_VERSION.split(".")[0]!;
    const rendered: string = DocsPlaceholders.render(
      [
        `version = "${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}"`,
        `version = "${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}"`,
        `provider ${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}.x tracks OneUptime ${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}.x`,
      ].join("\n"),
    );

    expect(rendered).not.toContain("{{TERRAFORM_PROVIDER");
    expect(rendered).toContain(
      `provider ${major}.x tracks OneUptime ${major}.x`,
    );
    expect(rendered.split(`version = "~> ${major}.0"`).length).toBe(3);
  });

  it("leaves other double-brace tokens alone", () => {
    expect(DocsPlaceholders.render("{{monitorSecrets.token}}")).toBe(
      "{{monitorSecrets.token}}",
    );
  });
});

describe("the Terraform pages", () => {
  it("exist in more than one language", () => {
    expect(terraformPages().length).toBeGreaterThan(10);
  });

  it("never write a provider major down", () => {
    // probe_version and required_version are other things.
    const writtenDown: RegExp = new RegExp(
      '~>\\s*\\d+\\.\\d|(^|[^\\w])version\\s*=\\s*"[=~><\\s]*\\d+\\.\\d',
    );

    for (const page of terraformPages()) {
      const content: string = fs.readFileSync(page, "utf-8");
      const offending: Array<string> = content
        .split("\n")
        .filter((line: string) => {
          return writtenDown.test(line);
        });

      expect({ page: path.relative(CONTENT_DIR, page), offending }).toEqual({
        page: path.relative(CONTENT_DIR, page),
        offending: [],
      });
    }
  });

  it("use the version placeholder wherever they pin the provider", () => {
    const pinned: Array<string> = terraformPages().filter((page: string) => {
      return fs
        .readFileSync(page, "utf-8")
        .includes(TERRAFORM_PROVIDER_VERSION_PLACEHOLDER);
    });

    // index, quick-start, complete-guide, registry and opentofu in every language at least.
    expect(pinned.length).toBeGreaterThan(40);
  });
});
