import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A Kubernetes cluster's platform (KubernetesCluster.provider: OpenShift,
 * EKS, GKE, ...) shows in the cluster list's Platform column and on the
 * overview's Cluster Details card. Both read the stored value through
 * getKubernetesClusterProviderLabel, so the column's default ("unknown")
 * shows as nothing known - a dash in the list, "Not reported" on the card,
 * the words the Agent Version beside it uses - and never as the word
 * "unknown".
 *
 * The pages compose model tables and cards that no node harness renders, so
 * the wiring is pinned here by reading the sources, comments stripped and
 * whitespace squashed so Prettier reflows and rationale comments cannot make
 * a test pass or fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function source(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, "")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

// The entry, in a columns or fields array, that reads the provider.
function providerEntry(code: string): string {
  const at: number = code.indexOf("field: { provider: true, }");
  expect(at).toBeGreaterThan(-1);
  const end: number = code.indexOf("field: {", at + 1);
  return code.slice(at, end > -1 ? end : undefined);
}

const IMPORT: string =
  'import { getKubernetesClusterProviderLabel } from "Common/Types/Kubernetes/KubernetesClusterProvider";';

describe("the cluster list", () => {
  const code: string = source("Pages/Kubernetes/Clusters.tsx");

  test("has a Platform column that reads the provider", () => {
    const entry: string = providerEntry(code);

    expect(entry).toContain('title: "Platform"');
    expect(entry).toContain("type: FieldType.Element");
    expect(entry).toContain(
      'getKubernetesClusterProviderLabel(item.provider) || "—"',
    );
  });

  test("keeps it off narrow screens, as Labels and Owners are", () => {
    expect(providerEntry(code)).toContain("hideOnMobile: true");
  });

  test("puts it right after the cluster's name", () => {
    expect(code.indexOf('title: "Cluster Name (clusterName)"')).toBeLessThan(
      code.indexOf('title: "Platform"'),
    );
    expect(code.indexOf('title: "Platform"')).toBeLessThan(
      code.indexOf('title: "Status"'),
    );
  });

  test("imports the label helper", () => {
    expect(code).toContain(IMPORT);
  });
});

describe("the overview's Cluster Details", () => {
  const code: string = source("Pages/Kubernetes/View/Index.tsx");

  test("show the platform, or Not reported, as the Agent Version does", () => {
    const entry: string = providerEntry(code);

    expect(entry).toContain('title: "Platform"');
    expect(entry).toContain("fieldType: FieldType.Element");
    expect(entry).toContain(
      'getKubernetesClusterProviderLabel(item.provider) || translator.translateText("Not reported")',
    );
    expect(code).toContain('placeholder="Not reported"');
  });

  test("put it right after the cluster's name, in the details card", () => {
    const card: string = code.slice(code.indexOf('name="Cluster Details"'));

    expect(card.indexOf('title: "Cluster Name (clusterName)"')).toBeGreaterThan(
      -1,
    );
    expect(card.indexOf('title: "Cluster Name (clusterName)"')).toBeLessThan(
      card.indexOf('title: "Platform"'),
    );
    expect(card.indexOf('title: "Platform"')).toBeLessThan(
      card.indexOf('title: "Description"'),
    );
  });

  test("import the label helper", () => {
    expect(code).toContain(IMPORT);
  });
});

describe("the words they show", () => {
  const locales: Array<string> = fs
    .readdirSync(path.join(DASHBOARD_SRC, "Locales"))
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("are read from all 17 Dashboard locales", () => {
    expect(locales).toHaveLength(17);
  });

  test.each(["Platform", "Not reported"])(
    "every locale translates %j",
    (key: string) => {
      for (const file of locales) {
        const locale: Record<string, unknown> = JSON.parse(
          fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", file), "utf8"),
        );
        const value: unknown = locale[key];

        expect({
          file,
          key,
          translated: typeof value === "string" && value.length > 0,
        }).toEqual({
          file,
          key,
          translated: true,
        });
      }
    },
  );
});
