import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The setup hint a Kubernetes Control Plane or Service Mesh tab shows in
 * place of charts that came back empty: what is missing, the Helm values
 * that collect it (drawn as code), the helm upgrade to copy, Check again and
 * the docs - in English and, through the real locale files, in the reader's
 * language with every value still in place.
 */

let dictionary: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return dictionary[key] ?? opts?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

const mockNavigate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        mockNavigate(...args);
      },
    },
  };
});

import KubernetesMetricsSetupEmptyState, {
  KUBERNETES_METRICS_SETUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesMetricsSetupEmptyState";
import {
  getAllKubernetesMetricsSetups,
  getKubernetesMetricsSetupCommand,
  KubernetesMetricsSetup,
  KubernetesMetricsSource,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesMetricsSetup";
import Route from "../../../Types/API/Route";

const SETUP: string = KUBERNETES_METRICS_SETUP_TEST_ID;
const SOURCES: Array<[KubernetesMetricsSource]> =
  getAllKubernetesMetricsSetups().map(
    (setup: KubernetesMetricsSetup): [KubernetesMetricsSource] => {
      return [setup.source];
    },
  );
const CLUSTER: string = "staging-eu-west";
const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

function renderHint(
  source: KubernetesMetricsSource,
  props: { isChecking?: boolean; onCheckAgain?: () => void } = {},
): HTMLElement {
  render(
    <KubernetesMetricsSetupEmptyState
      source={source}
      clusterName={CLUSTER}
      isChecking={props.isChecking || false}
      onCheckAgain={props.onCheckAgain || (() => {})}
    />,
  );
  return screen.getByTestId(`${SETUP}-${source}`);
}

function codes(hint: HTMLElement): Array<string> {
  return Array.from(
    within(hint).getByTestId(`${SETUP}-description`).querySelectorAll("code"),
  ).map((code: Element): string => {
    return code.textContent || "";
  });
}

// The values a setup's sentence names, in the order it names them.
function expectedCodes(setup: KubernetesMetricsSetup): Array<string> {
  return Array.from(setup.description.matchAll(/\{\{(\w+)\}\}/g)).map(
    (match: RegExpMatchArray): string => {
      const name: string = match[1] || "";
      return name === "clusterName" ? CLUSTER : setup.code[name] || "";
    },
  );
}

afterEach(() => {
  cleanup();
  dictionary = {};
  mockNavigate.mockReset();
});

describe("every source's hint", () => {
  test.each(SOURCES)(
    "%s: a heading, every value drawn as code, and no placeholder left",
    (source: KubernetesMetricsSource) => {
      const setup: KubernetesMetricsSetup =
        getAllKubernetesMetricsSetups().find(
          (candidate: KubernetesMetricsSetup): boolean => {
            return candidate.source === source;
          },
        )!;
      const hint: HTMLElement = renderHint(source);

      expect(
        within(hint).getByRole("heading", { name: setup.title }),
      ).toBeInTheDocument();
      expect(codes(hint)).toEqual(expectedCodes(setup));
      expect(hint.textContent).not.toContain("{{");
    },
  );

  test.each(SOURCES)(
    "%s: the helm upgrade to copy when an agent value collects it, none otherwise",
    (source: KubernetesMetricsSource) => {
      const hint: HTMLElement = renderHint(source);
      const command: string | null = getKubernetesMetricsSetupCommand(source);
      const block: HTMLElement | null = within(hint).queryByTestId(
        `${SETUP}-command`,
      );

      if (command === null) {
        expect(block).toBeNull();
        return;
      }

      expect(block).toHaveTextContent(command.replace(/\s+/g, " "), {
        normalizeWhitespace: true,
      });
      expect(
        within(block!).getByRole("button", { name: "Copy to clipboard" }),
      ).toBeInTheDocument();
    },
  );
});

describe("the actions", () => {
  test("Check again checks again", () => {
    const onCheckAgain: MockFunction = getJestMockFunction();
    const hint: HTMLElement = renderHint(KubernetesMetricsSource.Etcd, {
      onCheckAgain: () => {
        onCheckAgain();
      },
    });

    const button: HTMLElement = within(hint).getByTestId(
      `${SETUP}-check-again`,
    );
    expect(button).toHaveTextContent("Check again");

    fireEvent.click(button);

    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  test("while checking it says so and cannot be pressed again", () => {
    const onCheckAgain: MockFunction = getJestMockFunction();
    const hint: HTMLElement = renderHint(KubernetesMetricsSource.Istio, {
      isChecking: true,
      onCheckAgain: () => {
        onCheckAgain();
      },
    });

    const button: HTMLElement = within(hint).getByTestId(
      `${SETUP}-check-again`,
    );
    expect(button).toHaveTextContent("Checking…");
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onCheckAgain).not.toHaveBeenCalled();
  });

  test.each([
    [
      KubernetesMetricsSource.Scheduler,
      "/docs/telemetry/kubernetes-agent#enable-control-plane-monitoring",
    ],
    [
      KubernetesMetricsSource.CoreDns,
      "/docs/telemetry/kubernetes-agent#enable-coredns-metrics",
    ],
    [
      KubernetesMetricsSource.Linkerd,
      "/docs/telemetry/kubernetes-agent#enable-service-mesh-metrics",
    ],
    [
      KubernetesMetricsSource.Cilium,
      "/docs/telemetry/kubernetes-agent#metrics-the-agent-does-not-collect",
    ],
  ])(
    "%s: View Documentation opens its docs section in a new tab",
    (source: KubernetesMetricsSource, docsRoute: string) => {
      const hint: HTMLElement = renderHint(source);

      fireEvent.click(within(hint).getByTestId(`${SETUP}-docs`));

      const [route, options] = mockNavigate.mock.calls[0] as [
        Route,
        { openInNewTab: boolean },
      ];
      expect(route.toString()).toBe(docsRoute);
      expect(options).toEqual({ openInNewTab: true });
    },
  );
});

describe("in the reader's language", () => {
  test.each(["de", "ja", "es", "zh-CN", "fa"])(
    "%s: every hint reads in the locale, with the same values as code",
    (locale: string) => {
      dictionary = readLocale(locale);

      for (const setup of getAllKubernetesMetricsSetups()) {
        const hint: HTMLElement = renderHint(setup.source);
        const description: HTMLElement = within(hint).getByTestId(
          `${SETUP}-description`,
        );

        // Translated, not the English sentence.
        expect(dictionary[setup.description]).toBeDefined();
        expect(dictionary[setup.description]).not.toBe(setup.description);
        expect(within(hint).getByRole("heading")).toHaveTextContent(
          dictionary[setup.title]!,
        );

        // Every value survives translation, as code, and nothing raw is left.
        expect(codes(hint).sort()).toEqual(expectedCodes(setup).sort());
        expect(description.textContent).not.toContain("{{");

        cleanup();
      }
    },
  );
});
