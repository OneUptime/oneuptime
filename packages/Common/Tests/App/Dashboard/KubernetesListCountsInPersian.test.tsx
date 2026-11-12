import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A KUBERNETES LIST'S COUNTS, IN THE READER'S DIGITS (issue #7106).
 *
 * A Deployment's "2/3" ready, a pod's restarts and containers, an
 * autoscaler's replicas are kept as plain digits in the row (the filter
 * reads them) and were drawn that way: "2/3" on a Persian page beside its
 * "۰٫۴٪" CPU. A count column (ResourceColumn.isCount) draws them in the
 * reader's digits now, and only a count: a node's name or "N/A" is drawn
 * as written. Every Kubernetes list's count column is one.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const LATIN_DIGIT: RegExp = /[0-9]/;

const COLUMNS: Array<ResourceColumn> = [
  { title: "Ready", key: "ready", isCount: true },
  { title: "Restarts", key: "restarts", isCount: true },
  { title: "Node", key: "node" },
  { title: "Containers", key: "containers", isCount: true },
];

function pod(
  name: string,
  attributes: Record<string, string>,
  memoryLimitBytes: number | null = null,
): InfrastructureResource {
  return {
    name: name,
    namespace: "shop",
    cpuUtilization: 0.4,
    memoryUsageBytes: 512 * 1024 * 1024,
    memoryLimitBytes: memoryLimitBytes,
    memoryUtilization: null,
    status: "Running",
    age: "",
    additionalAttributes: attributes,
  };
}

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

// The cells of `name`'s row, as drawn, in `language`.
function rowCells(language: string, name: string): Array<string> {
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instances[language]!}>
      <ResourceTable
        resources={[
          pod("api-7d9f", {
            ready: "2/3",
            restarts: "12",
            node: "node-a1",
            containers: "1",
          }),
          pod("worker-5c2b", {
            ready: "-",
            restarts: "N/A",
            node: "node-b2",
            containers: "1200",
          }),
          // Half of a 1 GiB limit: the share of the limit is drawn.
          pod(
            "cache-9f1a",
            {
              ready: "1/1",
              restarts: "0",
              node: "node-c3",
              containers: "1",
            },
            1024 * 1024 * 1024,
          ),
        ]}
        title="Pods"
        description="All pods running in this cluster."
        showGroupColumn={false}
        showAge={false}
        columns={COLUMNS}
      />
    </I18nextProvider>,
  );

  const row: HTMLElement = screen.getByText(name).closest("tr") as HTMLElement;

  return within(row)
    .getAllByRole("cell")
    .map((cell: HTMLElement): string => {
      return withoutIsolateMarks(cell.textContent || "").trim();
    });
}

describe("a count column on a Persian page", () => {
  test("ready out of desired, restarts and containers in Persian digits; the node's name as written", () => {
    const cells: Array<string> = rowCells("fa", "api-7d9f");

    expect(cells).toContain("۲/۳");
    expect(cells).toContain("۱۲");
    expect(cells).toContain("۱");
    expect(cells).toContain("node-a1");
    // The CPU and memory beside them, too.
    expect(cells).toContain("۰٫۴٪");
    expect(cells).toContain("۵۱۲٫۰ MB");

    const latin: Array<string> = cells.filter((cell: string): boolean => {
      return (
        LATIN_DIGIT.test(cell) && cell !== "node-a1" && cell !== "api-7d9f"
      );
    });

    expect(latin).toEqual([]);
  });

  test("a dash and N/A stay as written; thousands are grouped Persian's way", () => {
    const cells: Array<string> = rowCells("fa", "worker-5c2b");

    expect(cells).toContain("N/A");
    expect(cells).toContain("۱٬۲۰۰");
    expect(cells).toContain("node-b2");
  });

  test("the memory share of a limit, in Persian digits and Persian's percent sign", () => {
    const cells: Array<string> = rowCells("fa", "cache-9f1a");

    expect(
      cells.some((cell: string): boolean => {
        return cell.startsWith("۵۰٪");
      }),
    ).toBe(true);

    const latin: Array<string> = cells.filter((cell: string): boolean => {
      return (
        LATIN_DIGIT.test(cell) && cell !== "node-c3" && cell !== "cache-9f1a"
      );
    });

    expect(latin).toEqual([]);
  });

  test("the memory share of a limit, in English, as before", () => {
    const cells: Array<string> = rowCells("en", "cache-9f1a");

    expect(
      cells.some((cell: string): boolean => {
        return cell.startsWith("50%");
      }),
    ).toBe(true);
  });

  test("in English, as before", () => {
    const cells: Array<string> = rowCells("en", "api-7d9f");

    expect(cells).toContain("2/3");
    expect(cells).toContain("12");
    expect(cells).toContain("0.4%");
    expect(cells).toContain("512.0 MB");
  });
});

/*
 * Each Kubernetes list's count columns, as its page declares them: every
 * one is a count column. A new count column left out reads in Latin
 * digits on a Persian page again.
 */
const COUNT_COLUMNS: Array<[string, Array<string>]> = [
  ["Pages/Kubernetes/View/Deployments.tsx", ["ready"]],
  ["Pages/Kubernetes/View/StatefulSets.tsx", ["ready"]],
  ["Pages/Kubernetes/View/DaemonSets.tsx", ["ready"]],
  ["Pages/Kubernetes/View/DeploymentConfigs.tsx", ["ready"]],
  ["Pages/Kubernetes/View/Pods.tsx", ["ready", "restarts", "containers"]],
  ["Pages/Kubernetes/View/Containers.tsx", ["restarts"]],
  [
    "Pages/Kubernetes/View/HPAs.tsx",
    ["minReplicas", "maxReplicas", "currentReplicas", "desiredReplicas"],
  ],
];

// The column object that declares `key`, from its "{" to its "}".
function columnDeclaring(source: string, key: string): string {
  const at: number = source.indexOf(`key: "${key}"`);

  if (at < 0) {
    return "";
  }

  const start: number = source.lastIndexOf("{", at);
  const end: number = source.indexOf("}", at);

  return source.slice(start, end + 1);
}

describe("every Kubernetes list's count column is a count column", () => {
  test.each(COUNT_COLUMNS)(
    "%s",
    (relativePath: string, keys: Array<string>) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, ...relativePath.split("/")),
        "utf8",
      );

      for (const key of keys) {
        const column: string = columnDeclaring(source, key);

        expect({ key, declared: column !== "" }).toEqual({
          key,
          declared: true,
        });
        expect({ key, isCount: column.includes("isCount: true") }).toEqual({
          key,
          isCount: true,
        });
      }
    },
  );

  test("the check finds a column that is not one", () => {
    const source: string = `columns={[{ title: "Ready", key: "ready" }, { title: "Restarts", key: "restarts", isCount: true }]}`;

    expect(columnDeclaring(source, "ready").includes("isCount: true")).toBe(
      false,
    );
    expect(columnDeclaring(source, "restarts").includes("isCount: true")).toBe(
      true,
    );
  });
});
