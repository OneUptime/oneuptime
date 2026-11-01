import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  KUBERNETES_CLOUD_PLATFORM_PROVIDERS,
  KUBERNETES_DISTRIBUTION_PROVIDERS,
} from "Common/Types/Kubernetes/KubernetesClusterProvider";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * WHAT THE OPENSHIFT PAGE MAY SAY.
 *
 * /product/openshift is a marketing page about another company's platform
 * (issue #5477), so what it may claim is narrow, and a slip is a false claim
 * about a Red Hat relationship rather than a typo. The page describes the
 * Kubernetes product on OpenShift and leads to it. It claims no Red Hat
 * certification, listing or partnership: certification is out of scope in the
 * issue, and the agent's images are not built on UBI. It draws no Red Hat or
 * OpenShift logo, and it invents no quotes, numbers or benchmarks.
 *
 * These read the rendered page, the words a visitor gets, and hold those words
 * to the chart, the docs and the product where those can be read from here.
 */

const REPOSITORY_ROOT: string = path.join(__dirname, "..", "..", "..");
const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

const CHART: string = path.join(
  REPOSITORY_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
);
const AGENT_DOCS: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "telemetry",
  "kubernetes-agent.md",
);

const KUBERNETES_PRODUCT: string = "/product/kubernetes";
const OPENSHIFT_DOCS: string = "/docs/telemetry/kubernetes-agent#openshift";
const ALERTMANAGER_DOCS: string = "/docs/integrations/prometheus-alertmanager";
const OPENTELEMETRY_DOCS: string = "/docs/telemetry/open-telemetry";

const TRADEMARK_NOTE: string =
  "Red Hat and OpenShift are trademarks of Red Hat, Inc. OneUptime is not affiliated with or endorsed by Red Hat.";

const WHITESPACE_RUN: RegExp = /\s+/g;

function wordsOf(element: Element): string {
  return (element.textContent || "").replace(WHITESPACE_RUN, " ").trim();
}

function linksIn(element: Element): Array<string> {
  return Array.from(element.querySelectorAll("a")).map(
    (link: HTMLAnchorElement): string => {
      return link.getAttribute("href") || "";
    },
  );
}

let main: HTMLElement;
let words: string;
let source: string;

beforeAll(async () => {
  const seo: PageSEOData = getPageSEO("/product/openshift");

  // Exactly the locals Routes.ts hands the template, plus homeUrl.
  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, "openshift.ejs"),
    {
      enableGoogleTagManager: false,
      seo: { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` },
      homeUrl: HOME_URL,
    },
    { views: [VIEWS_ROOT] },
  )) as string;

  main = new JSDOM(html).window.document.querySelector("main")!;
  words = wordsOf(main);
  source = fs.readFileSync(path.join(VIEWS_ROOT, "openshift.ejs"), "utf8");
});

describe("the page reads its own words", () => {
  test("the walk finds the page, so the checks below are not vacuous", () => {
    expect(main).not.toBeNull();
    expect(words.length).toBeGreaterThan(1000);
    expect(main.querySelectorAll("section").length).toBe(5);
  });

  test("no block the site shares sits in the page's own words", () => {
    /*
     * Every word in <main> is this page's: the shared blocks (the logo roll,
     * the enterprise block, the features table) carry words of their own,
     * some about certifications, and links this page does not lead to.
     */
    for (const shared of [
      "logo-roll",
      "enterprise-ready",
      "features-table",
      "'cta'",
    ]) {
      expect([shared, source.includes(shared)]).toEqual([shared, false]);
    }
  });
});

describe("the page leads to the Kubernetes product and the docs", () => {
  test("the hero's calls to action go to the product and the docs", () => {
    expect(linksIn(main.querySelector("#openshift-hero-section")!)).toEqual([
      KUBERNETES_PRODUCT,
      OPENSHIFT_DOCS,
    ]);
  });

  test("the closing call to action goes to the same two places", () => {
    expect(
      linksIn(
        main.querySelector('section[aria-labelledby="openshift-cta-title"]')!,
      ),
    ).toEqual([KUBERNETES_PRODUCT, OPENSHIFT_DOCS]);
  });

  test("nothing else on the page leads anywhere but the docs", () => {
    expect(Array.from(new Set(linksIn(main))).sort()).toEqual(
      [
        ALERTMANAGER_DOCS,
        KUBERNETES_PRODUCT,
        OPENSHIFT_DOCS,
        OPENTELEMETRY_DOCS,
      ].sort(),
    );
  });

  test("the docs' OpenShift section is there to land on", () => {
    const docs: string = fs.readFileSync(AGENT_DOCS, "utf8");

    expect(docs.split("\n")).toContain("## OpenShift");
    // Which also says where Alertmanager and the Red Hat build's traces go.
    expect(docs).toContain(`(${ALERTMANAGER_DOCS})`);
    expect(docs).toContain("the Red Hat build of OpenTelemetry");
    expect(docs).toContain(`(${OPENTELEMETRY_DOCS})`);
  });
});

describe("the page says what is true of the product", () => {
  test("it is the Kubernetes product, beside the other clusters, not another tool", () => {
    expect(wordsOf(main.querySelector("h1")!)).toBe(
      "Monitor OpenShift beside EKS, AKS and GKE",
    );
    expect(words).toContain(
      "OneUptime monitors OpenShift with its Kubernetes product, so all your clusters are on one screen and there is no separate tool to run.",
    );
  });

  test.each([
    "OpenShift Container Platform",
    "ROSA",
    "ARO",
    "OKD",
    "OpenShift 4.11 and later",
  ])("it covers %s", (platform: string) => {
    expect(wordsOf(main.querySelector("#openshift-hero-section")!)).toContain(
      platform,
    );
  });

  test("the versions it names are the docs'", () => {
    expect(fs.readFileSync(AGENT_DOCS, "utf8")).toContain(
      "OpenShift 4.11 and later",
    );
  });

  test("it says what the chart collects and where a cluster shows up", () => {
    expect(words).toContain(
      "Node, pod and container metrics, pod logs and eBPF traces.",
    );
    expect(words).toContain("A cluster is labelled OpenShift in the product");
    expect(words).toContain(
      "Open the Kubernetes product. Your cluster is there, labelled OpenShift.",
    );
  });

  test("it draws the labels the product writes on a cluster", () => {
    const list: Element = main.querySelector(
      '[aria-label^="The Kubernetes product\'s cluster list"]',
    )!;
    const platforms: Array<string> = [
      KUBERNETES_DISTRIBUTION_PROVIDERS["openshift"]!,
      KUBERNETES_CLOUD_PLATFORM_PROVIDERS["aws_eks"]!,
      KUBERNETES_CLOUD_PLATFORM_PROVIDERS["azure_aks"]!,
      KUBERNETES_CLOUD_PLATFORM_PROVIDERS["gcp_kubernetes_engine"]!,
    ];

    expect(platforms).toEqual(["OpenShift", "EKS", "AKS", "GKE"]);

    for (const platform of platforms) {
      expect(wordsOf(list)).toContain(platform);
    }
  });

  test("it describes the OpenShift health card", () => {
    expect(words).toContain(
      "An OpenShift health card shows every ClusterOperator's Available, Progressing and Degraded conditions, the cluster's version, and whether an update is running or failing.",
    );
    expect(words).toContain("on the cluster's overview");
  });

  test("it describes Routes and DeploymentConfigs as pages of the product", () => {
    expect(words).toContain(
      "Both are pages in the Kubernetes product, with Routes linked to their Services.",
    );
  });

  test("it names the three alert templates", () => {
    expect(words).toContain(
      "ClusterOperator degraded, ClusterOperator unavailable and cluster update failing.",
    );
  });

  test("it says where OpenShift's own alerts and traces can go", () => {
    expect(words).toContain(
      "Forward its alerts to OneUptime's Alertmanager integration.",
    );
    expect(words).toContain("Red Hat build of OpenTelemetry");
    expect(words).toContain("Send your apps' traces from it to OneUptime.");
  });
});

describe("the page's install command is the product's", () => {
  /*
   * The lines of the page's command, as a shell reads them: a line ending in
   * a backslash goes on on the next one.
   */
  function commandsOnThePage(): Array<string> {
    return (main.querySelector("pre")!.textContent || "")
      .replace(/\\\n\s*/g, "")
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      })
      .filter((line: string): boolean => {
        return line.length > 0;
      });
  }

  // The OpenShift tab of the docs' install step, flags and all, on one line.
  function installCommandInTheDocs(): string {
    const docs: string = fs.readFileSync(AGENT_DOCS, "utf8");
    const tab: string = docs.slice(docs.indexOf("@tab OpenShift"));
    const start: number = tab.indexOf("helm install");

    return tab
      .slice(start, tab.indexOf("```", start))
      .replace(/\\\n\s*/g, "")
      .trim();
  }

  test("it names the preset, and the chart has that preset", () => {
    expect(words).toContain("--set preset=openshift");

    const schema: {
      properties: { preset: { enum: Array<string> } };
    } = JSON.parse(
      fs.readFileSync(path.join(CHART, "values.schema.json"), "utf8"),
    );

    expect(schema.properties.preset.enum).toContain("openshift");
  });

  test("it logs in with oc first, as the setup guide does, and adds no oc adm policy step", () => {
    const commands: Array<string> = commandsOnThePage();

    expect(commands[0]).toBe(
      "oc login --token=<token> --server=https://api.<cluster-domain>:6443",
    );
    expect(
      commands.filter((command: string): boolean => {
        return command.startsWith("oc ");
      }),
    ).toHaveLength(1);
    expect(words).toContain("One helm install, no oc adm policy step");
    // Creating an SCC takes cluster-admin: the page must not imply otherwise.
    expect(words).toContain("A cluster admin runs the install");
  });

  test("it adds the chart repository the docs add", () => {
    const docs: string = fs.readFileSync(AGENT_DOCS, "utf8");
    const commands: Array<string> = commandsOnThePage();

    for (const command of [
      "helm repo add oneuptime https://helm-chart.oneuptime.com",
      "helm repo update",
    ]) {
      expect(commands).toContain(command);
      expect(docs).toContain(command);
    }
  });

  test("it is the docs' OpenShift command, flag for flag", () => {
    const command: string | undefined = commandsOnThePage().find(
      (candidate: string): boolean => {
        return candidate.startsWith("helm install");
      },
    );
    const inTheDocs: string = installCommandInTheDocs();

    expect(inTheDocs).toContain("--set preset=openshift");
    expect(command).toBe(
      // The chart turns the AI agent on by default, so the page leaves it out.
      inTheDocs.replace("--set aiAgent.enabled=true ", ""),
    );
  });

  test("the flag it leaves out is one the chart turns on by itself", () => {
    expect(fs.readFileSync(path.join(CHART, "values.yaml"), "utf8")).toContain(
      "aiAgent:\n  enabled: true\n",
    );
  });
});

describe("the page describes the security context constraints the chart creates", () => {
  const scc: () => string = (): string => {
    return fs.readFileSync(
      path.join(CHART, "templates", "openshift-scc.yaml"),
      "utf8",
    );
  };

  // The chart's two constraints, split at each one's kind.
  const constraints: () => Array<string> = (): Array<string> => {
    return scc()
      .split("kind: SecurityContextConstraints")
      .slice(1)
      .map((constraint: string): string => {
        const end: number = constraint.indexOf("\nkind: ");

        return end === -1 ? constraint : constraint.slice(0, end);
      });
  };

  function cardFor(title: string): string {
    const heading: Element | undefined = Array.from(
      main.querySelectorAll("h3"),
    ).find((candidate: Element): boolean => {
      return wordsOf(candidate) === title;
    });

    return wordsOf(heading!.parentElement!);
  }

  test("there are two, as the page says", () => {
    expect(constraints()).toHaveLength(2);
    expect(words).toContain(
      "Two security context constraints, each for its own pods",
    );
    expect(words).toContain(
      "The chart creates both, and each can be used only by its own pods.",
    );
  });

  test("the node collector's is read-only hostPath, spc_t, unprivileged, no capabilities", () => {
    const card: string = cardFor("Node collector");
    const constraint: string = constraints()[0]!;

    for (const point of [
      "Read-only hostPath",
      "SELinux type spc_t",
      "Unprivileged",
      "No capabilities",
    ]) {
      expect(card).toContain(point);
    }

    expect(constraint).toContain("allowHostDirVolumePlugin: true");
    expect(constraint).toContain("allowPrivilegedContainer: false");
    expect(constraint).toContain("requiredDropCapabilities:\n  - ALL");
    expect(constraint).toContain("spcSeLinuxOptions");
    expect(
      fs.readFileSync(path.join(CHART, "templates", "_helpers.tpl"), "utf8"),
    ).toContain("spc_t");
  });

  test("eBPF's and the profiler's is privileged, in the host PID namespace", () => {
    const card: string = cardFor("eBPF and profiler");
    const constraint: string = constraints()[1]!;

    expect(card).toContain("Privileged");
    expect(card).toContain("Host PID");
    expect(constraint).toContain("allowPrivilegedContainer: true");
    expect(constraint).toContain("allowHostPID: true");
  });

  test("every other pod runs under restricted-v2", () => {
    expect(cardFor("Every other pod")).toContain("Runs under restricted-v2");
    expect(words).toContain("Every other pod runs under restricted-v2.");
    expect(fs.readFileSync(AGENT_DOCS, "utf8")).toContain(
      "which runs under `restricted-v2`",
    );
  });
});

describe("the page claims no Red Hat certification, listing or partnership", () => {
  const seo: PageSEOData = getPageSEO("/product/openshift");

  test.each([
    [/certif/i],
    [/operatorhub/i],
    [/operator hub/i],
    [/\bUBI\b/],
    [/universal base image/i],
    [/partner/i],
    [/ecosystem catalog/i],
    [/\bofficial\b/i],
    [/\bapproved\b/i],
    [/\bvalidated\b/i],
    [/\bsupported by\b/i],
  ])("nothing on the page or in its head matches %s", (claim: RegExp) => {
    expect(words).not.toMatch(claim);
    expect(seo.title).not.toMatch(claim);
    expect(seo.description).not.toMatch(claim);
  });

  test("it names Red Hat only for the trademark note and the Red Hat build of OpenTelemetry", () => {
    const rest: string = words
      .replace(TRADEMARK_NOTE, "")
      .replace("Red Hat build of OpenTelemetry", "");

    expect(words).toContain("Red Hat build of OpenTelemetry");
    expect(rest).not.toMatch(/red hat|redhat/i);
    expect(seo.title).not.toMatch(/red hat/i);
    expect(seo.description).not.toMatch(/red hat/i);
  });

  test("it carries the trademark note", () => {
    expect(words).toContain(TRADEMARK_NOTE);
  });
});

describe("the page draws no Red Hat or OpenShift logo", () => {
  const STATIC_IMAGES: string = path.join(__dirname, "..", "Static", "img");
  const THEIR_ARTWORK: RegExp = /openshift|red-?hat/i;

  test("the page has no image, and its one mark is the Kubernetes one", () => {
    expect(main.querySelectorAll("img").length).toBe(0);
    expect(source.match(/Partials\/icons\/[\w-]+/g)).toEqual([
      "Partials/icons/kubernetes",
    ]);
  });

  test("the site holds no such artwork", () => {
    const artwork: Array<string> = fs
      .readdirSync(STATIC_IMAGES)
      .filter((name: string): boolean => {
        return THEIR_ARTWORK.test(name);
      });

    expect(artwork).toEqual([]);
  });

  test("its one accent is the Kubernetes product's, not Red Hat's red", () => {
    expect(source).not.toMatch(/#ee0000|#e00\b|#cc0000/i);
    expect(source).toContain("text-cyan-600");
  });
});

describe("the page invents no quotes, numbers or benchmarks", () => {
  /*
   * The page's words without the install command, which holds a port, and
   * without the two drawings, whose rows are examples.
   */
  function wordsOutsideTheExamples(): string {
    const copy: HTMLElement = main.cloneNode(true) as HTMLElement;

    for (const example of Array.from(
      copy.querySelectorAll("pre, [role=img]"),
    )) {
      example.remove();
    }

    return wordsOf(copy);
  }

  test("it quotes nobody", () => {
    expect(main.querySelectorAll("blockquote, figure, q, cite").length).toBe(0);
    expect(words).not.toMatch(/customers?\b|trusted by|testimonial/i);
  });

  test("the only numbers it states are the OpenShift version and the steps", () => {
    const numbers: Array<string> =
      wordsOutsideTheExamples().match(/\d+(?:[.,]\d+)*/g) || [];

    expect(new Set(numbers)).toEqual(new Set(["4.11", "1", "2", "3"]));
  });

  test("it states no measure of anything", () => {
    expect(wordsOutsideTheExamples()).not.toMatch(
      /%|\bminutes?\b|\bseconds?\b|\bfaster\b|\bcheaper\b|\bbest\b|\bleading\b/i,
    );
  });

  test("the examples are drawings, not text a reader is told as fact", () => {
    expect(main.querySelectorAll("[role=img]").length).toBe(2);

    for (const drawing of Array.from(main.querySelectorAll("[role=img]"))) {
      expect(drawing.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
