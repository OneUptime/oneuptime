import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs name the kubectl version the Runner image ships (so an operator
 * can check it against the cluster's version-skew policy). That version is
 * pinned in the Runner's Dockerfile, together with its checksums; a bump
 * there must bump the docs too, or the docs promise a kubectl the Runner
 * does not have.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const RUNNER_DOCKERFILE: string = path.join(
  PACKAGES_ROOT,
  "Runner/Dockerfile.tpl",
);
const PAGES_NAMING_THE_PIN: Array<string> = [
  path.join(PACKAGES_ROOT, "App/FeatureSet/Docs/Content/en/ai/ai-sre.md"),
  path.join(REPOSITORY_ROOT, "HelmChart/Public/kubernetes-agent/README.md"),
];

function getPinnedKubectlVersion(): string {
  const match: RegExpMatchArray | null = fs
    .readFileSync(RUNNER_DOCKERFILE, "utf8")
    .match(/^ARG KUBECTL_VERSION=(v\d+\.\d+\.\d+)$/m);

  if (!match) {
    throw new Error("packages/Runner/Dockerfile.tpl pins no KUBECTL_VERSION");
  }

  return match[1]!;
}

describe("the kubectl version the docs name", () => {
  const pinned: string = getPinnedKubectlVersion();

  for (const page of PAGES_NAMING_THE_PIN) {
    it(`is the one the Runner image pins, in ${path.relative(REPOSITORY_ROOT, page)}`, () => {
      const named: Array<string> = Array.from(
        fs
          .readFileSync(page, "utf8")
          .matchAll(/pinned kubectl \((v\d+\.\d+\.\d+)\)/g),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });

      expect(named.length).toBeGreaterThan(0);
      expect(Array.from(new Set(named))).toEqual([pinned]);
    });
  }
});
