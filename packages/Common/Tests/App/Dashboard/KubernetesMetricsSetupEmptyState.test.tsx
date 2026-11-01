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
  getOpenShiftKubernetesMetricsSetups,
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
  props: {
    isChecking?: boolean;
    onCheckAgain?: () => void;
    clusterProvider?: string | null;
  } = {},
): HTMLElement {
  render(
    <KubernetesMetricsSetupEmptyState
      source={source}
      clusterName={CLUSTER}
      clusterProvider={props.clusterProvider}
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

  test("while checking it says so, keeps its focus, and pressing it again does nothing", () => {
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
    // Not disabled: a disabled button would drop the keyboard focus.
    expect(button).toBeEnabled();
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button);

    expect(onCheckAgain).not.toHaveBeenCalled();
  });

  test.each([
    [
      KubernetesMetricsSource.Scheduler,
      "/docs/en/telemetry/kubernetes-agent#enable-control-plane-monitoring",
    ],
    [
      KubernetesMetricsSource.CoreDns,
      "/docs/en/telemetry/kubernetes-agent#enable-coredns-metrics",
    ],
    [
      KubernetesMetricsSource.Linkerd,
      "/docs/en/telemetry/kubernetes-agent#enable-service-mesh-metrics",
    ],
    [
      KubernetesMetricsSource.Cilium,
      "/docs/en/telemetry/kubernetes-agent#metrics-the-agent-does-not-collect",
    ],
    [
      KubernetesMetricsSource.Istiod,
      "/docs/en/telemetry/kubernetes-agent#metrics-the-agent-does-not-collect",
    ],
    [
      KubernetesMetricsSource.LinkerdControlPlane,
      "/docs/en/telemetry/kubernetes-agent#metrics-the-agent-does-not-collect",
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

describe("on an OpenShift cluster", () => {
  const OPENSHIFT: string = "OpenShift";

  test.each([
    [KubernetesMetricsSource.Scheduler, "scheduler"],
    [KubernetesMetricsSource.ControllerManager, "controller manager"],
  ])(
    "%s: turning it on is enough, so it asks for no address",
    (source: KubernetesMetricsSource, name: string) => {
      const hint: HTMLElement = renderHint(source, {
        clusterProvider: OPENSHIFT,
      });

      expect(codes(hint)).toEqual(["controlPlane.enabled"]);
      expect(hint).toHaveTextContent(
        `The agent then finds every ${name} on OpenShift by itself and reads each one.`,
      );
      expect(hint.textContent).not.toContain("endpoints");
      expect(hint.textContent).not.toContain("EKS");
      expect(within(hint).getByTestId(`${SETUP}-command`)).toHaveTextContent(
        "--set controlPlane.enabled=true",
        {
          normalizeWhitespace: true,
        },
      );
    },
  );

  test("etcd: names the Secret, and the commands that make it, before the upgrade", () => {
    const hint: HTMLElement = renderHint(KubernetesMetricsSource.Etcd, {
      clusterProvider: OPENSHIFT,
    });
    const command: string = within(hint).getByTestId(`${SETUP}-command`)
      .textContent as string;

    expect(codes(hint)).toEqual([
      "controlPlane.enabled",
      "controlPlane.etcd.clientCertSecret",
    ]);
    expect(hint.textContent).not.toContain("endpoints");
    expect(command.indexOf("oc extract secret/etcd-metric-client")).toBe(0);
    expect(command.indexOf("oc create secret generic")).toBeLessThan(
      command.indexOf("helm upgrade"),
    );
    expect(command).toContain(
      "--set controlPlane.etcd.clientCertSecret=etcd-client-cert",
    );
  });

  test.each([KubernetesMetricsSource.Scheduler, KubernetesMetricsSource.Etcd])(
    "%s: says a hosted control plane stays empty",
    (source: KubernetesMetricsSource) => {
      const hint: HTMLElement = renderHint(source, {
        clusterProvider: OPENSHIFT,
      });

      expect(hint).toHaveTextContent(
        "A hosted control plane, such as ROSA with HCP",
      );
      expect(hint).toHaveTextContent("so this stays empty there");
    },
  );

  test("the API server's hint is the same as anywhere", () => {
    const anywhere: HTMLElement = renderHint(KubernetesMetricsSource.ApiServer);
    const text: string = anywhere.textContent as string;

    cleanup();

    expect(
      renderHint(KubernetesMetricsSource.ApiServer, {
        clusterProvider: OPENSHIFT,
      }).textContent,
    ).toBe(text);
  });

  test.each([undefined, null, "", "unknown", "EKS", "GKE"])(
    "a cluster whose provider is %j keeps the hint that lists addresses",
    (clusterProvider: string | null | undefined) => {
      const hint: HTMLElement = renderHint(KubernetesMetricsSource.Scheduler, {
        clusterProvider: clusterProvider,
      });

      expect(codes(hint)).toEqual([
        "controlPlane.enabled",
        "controlPlane.scheduler.endpoints",
      ]);
      expect(hint).toHaveTextContent(
        "Managed clusters such as EKS, GKE and AKS",
      );
    },
  );

  test.each([
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ])(
    "%s: every OpenShift hint reads in the locale, with its values as code",
    (locale: string) => {
      dictionary = readLocale(locale);

      for (const setup of getOpenShiftKubernetesMetricsSetups()) {
        const hint: HTMLElement = renderHint(setup.source, {
          clusterProvider: OPENSHIFT,
        });

        expect(dictionary[setup.description]).toBeDefined();
        expect(dictionary[setup.description]).not.toBe(setup.description);
        expect(codes(hint).sort()).toEqual(expectedCodes(setup).sort());
        expect(hint.textContent).not.toContain("{{");
        // A hosted control plane's name stays as Red Hat writes it.
        expect(dictionary[setup.description]).toContain("ROSA");
        expect(dictionary[setup.description]).toContain("HCP");

        cleanup();
      }
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
