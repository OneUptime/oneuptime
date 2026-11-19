/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * What failed, and why: the dialog a failed count or a Degraded pill opens
 * on every resource's hero (#9537), and the two pills that open it -
 * rendered for real. A count opens the parts it is about, the most urgent
 * first, each with why, which one it is (with links to its namespace and
 * owner), since when, what the resource reported about it lately, and
 * View; a health pill opens what made the resource Degraded or Unhealthy.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
      getQueryStringByName: (): null => {
        return null;
      },
    },
  };
});

import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import ResourceAttentionDialog, {
  ResourceAttentionDialogRead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import ResourceAttentionPill from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionPill";
import ResourceHealthPill from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceHealthPill";
import NeedsAttentionCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/NeedsAttentionCard";
import { RESOURCE_ATTENTION_EVENTS_SHOWN } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionRow";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

const NOW: number = Date.now();

function crashLoopingPod(): ResourceAttentionItem {
  return {
    key: "Pod:shop/checkout-7d9f8b6c5-x2k4q",
    kind: "Pod",
    kindAsWritten: true,
    icon: IconProp.Circle,
    name: "checkout-7d9f8b6c5-x2k4q",
    severity: ResourceAttentionSeverity.Critical,
    reasons: [
      { text: "{{reason}}", values: { reason: "CrashLoopBackOff" } },
      {
        text: "Last restart: {{reason}}, exit code {{code}}",
        values: { reason: "Error", code: "1" },
      },
    ],
    message: "back-off 5m0s restarting failed container=app",
    route: new Route("/dashboard/k8s/pods/checkout-7d9f8b6c5-x2k4q"),
    facts: [
      {
        key: "namespace",
        label: "Namespace",
        value: "shop",
        route: new Route("/dashboard/k8s/namespaces/shop"),
      },
      {
        key: "workload",
        label: "Workload",
        valueKind: "Deployment",
        value: "checkout",
        route: new Route("/dashboard/k8s/deployments/checkout"),
      },
      { key: "container", label: "Container", value: "app" },
      { key: "restarts", label: "Restarts", value: "14", isCount: true },
    ],
    since: {
      at: new Date(NOW - 2 * 60 * 60 * 1000),
      template: "Failing since {{time}}",
    },
    events: [
      {
        key: "e1",
        reason: "BackOff",
        message: "Back-off restarting failed container app",
        count: 12,
        lastSeenAt: new Date(NOW - 2 * 60 * 1000),
      },
      {
        key: "e2",
        reason: "OOMKilling",
        message: "Memory cgroup out of memory",
        count: 1,
        lastSeenAt: new Date(NOW - 5 * 60 * 1000),
      },
      {
        key: "e3",
        reason: "Unhealthy",
        message: "Readiness probe failed",
        count: 3,
      },
      { key: "e4", reason: "FailedMount", message: "never shown", count: 1 },
    ],
  };
}

function pendingPod(): ResourceAttentionItem {
  return {
    key: "Pod:shop/queued",
    kind: "Pod",
    kindAsWritten: true,
    icon: IconProp.Circle,
    name: "queued",
    severity: ResourceAttentionSeverity.Warning,
    reasons: [{ text: "Can't be scheduled" }],
    message: "0/3 nodes are available: 3 Insufficient memory.",
    route: new Route("/dashboard/k8s/pods/queued"),
  };
}

describe("the dialog a count opens", () => {
  test("lists each part with why, which one it is, since when, its latest events and View", () => {
    render(
      <ResourceAttentionDialog
        testId="failed"
        title="2 pods"
        description="Pods with a container that cannot run."
        items={[crashLoopingPod(), pendingPod()]}
        emptyMessage="No pod is failing now."
        onClose={() => {}}
        showKind={false}
      />,
    );

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(within(dialog).getByText("2 pods")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Pods with a container that cannot run."),
    ).toBeInTheDocument();

    const rows: Array<HTMLElement> = screen.getAllByTestId("failed-item");
    expect(rows).toHaveLength(2);
    const first: HTMLElement = rows[0]!;

    expect(within(first).getByTestId("failed-name")).toHaveTextContent(
      "checkout-7d9f8b6c5-x2k4q",
    );
    // Every row is a pod: no kind chip saying "Pod" on each.
    expect(within(first).queryByTestId("failed-kind")).toBeNull();
    expect(
      within(first)
        .getAllByTestId("failed-reason")
        .map((chip: HTMLElement): string => {
          return chip.textContent || "";
        }),
    ).toEqual(["CrashLoopBackOff", "Last restart: Error, exit code 1"]);
    expect(within(first).getByTestId("failed-message")).toHaveTextContent(
      "back-off 5m0s restarting failed container=app",
    );

    // Which one it is: each fact named, the namespace and owner links.
    const facts: HTMLElement = within(first).getByTestId("failed-facts");
    expect(facts).toHaveTextContent("Namespace:");
    expect(facts).toHaveTextContent("Workload:");
    expect(facts).toHaveTextContent("Deployment checkout");
    expect(facts).toHaveTextContent("Restarts:");
    expect(facts).toHaveTextContent("14");
    const links: Array<HTMLElement> =
      within(facts).getAllByTestId("failed-fact-link");
    expect(
      links.map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      "/dashboard/k8s/namespaces/shop",
      "/dashboard/k8s/deployments/checkout",
    ]);

    expect(within(first).getByTestId("failed-since")).toHaveTextContent(
      "Failing since 2 hours ago",
    );

    // The newest three events, with how often and when.
    const events: Array<HTMLElement> =
      within(first).getAllByTestId("failed-event");
    expect(events).toHaveLength(RESOURCE_ATTENTION_EVENTS_SHOWN);
    expect(events[0]).toHaveTextContent(
      "BackOff Back-off restarting failed container app · 12 times, last 2 minutes ago",
    );
    expect(events[1]).toHaveTextContent(
      "OOMKilling Memory cgroup out of memory · 5 minutes ago",
    );
    expect(events[2]).toHaveTextContent(
      "Unhealthy Readiness probe failed · 3 times",
    );
    expect(first).not.toHaveTextContent("never shown");

    // View: a step from the part's own page.
    const view: HTMLElement = within(first).getByTestId("failed-view");
    expect(view).toHaveTextContent("View");
    expect(view.getAttribute("href")).toBe(
      "/dashboard/k8s/pods/checkout-7d9f8b6c5-x2k4q",
    );

    // A row with nothing more to say draws none of it.
    const second: HTMLElement = rows[1]!;
    expect(within(second).queryByTestId("failed-facts")).toBeNull();
    expect(within(second).queryByTestId("failed-since")).toBeNull();
    expect(within(second).queryByTestId("failed-events")).toBeNull();
  });

  test("is read and left: Close is its one way out, and no button in it is primary", () => {
    const onClose: jest.Mock = jest.fn();
    render(
      <ResourceAttentionDialog
        testId="failed"
        title="1 pod"
        items={[pendingPod()]}
        emptyMessage="No pod is pending now."
        onClose={onClose}
      />,
    );

    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
    const close: HTMLElement = screen.getByTestId("modal-footer-close-button");
    expect(close).toHaveTextContent("Close");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("reads its parts when it opens, drawing the list's shape meanwhile", async () => {
    let resolve: (read: ResourceAttentionDialogRead) => void = () => {};
    const load: jest.Mock<() => Promise<ResourceAttentionDialogRead>> = jest.fn(
      () => {
        return new Promise<ResourceAttentionDialogRead>(
          (done: (read: ResourceAttentionDialogRead) => void) => {
            resolve = done;
          },
        );
      },
    );

    render(
      <ResourceAttentionDialog
        testId="failed"
        title="1 failed pod"
        load={load}
        emptyMessage="No failed pods now."
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("failed-loading")).toBeInTheDocument();
    await act(async () => {
      resolve({ items: [crashLoopingPod()] });
    });
    expect(screen.queryByTestId("failed-loading")).toBeNull();
    expect(screen.getAllByTestId("failed-item")).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("reads once, though the page hands it a new read each time it draws", async () => {
    const load: jest.Mock<() => Promise<ResourceAttentionDialogRead>> = jest.fn(
      () => {
        return Promise.resolve({ items: [pendingPod()] });
      },
    );

    const { rerender } = render(
      <ResourceAttentionDialog
        testId="failed"
        title="1 pending pod"
        load={() => {
          return load();
        }}
        emptyMessage="No pod is pending now."
        onClose={() => {}}
      />,
    );
    await screen.findAllByTestId("failed-item");

    for (let draw: number = 0; draw < 3; draw++) {
      rerender(
        <ResourceAttentionDialog
          testId="failed"
          title="1 pending pod"
          load={() => {
            return load();
          }}
          emptyMessage="No pod is pending now."
          onClose={() => {}}
        />,
      );
    }
    await act(async () => {
      await Promise.resolve();
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  test("says why a read failed, and Try again reads again", async () => {
    let attempt: number = 0;
    const load: () => Promise<ResourceAttentionDialogRead> = () => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error("The pods could not be read."))
        : Promise.resolve({ items: [pendingPod()] });
    };

    render(
      <ResourceAttentionDialog
        testId="failed"
        title="1 pending pod"
        load={load}
        emptyMessage="No pod is pending now."
        whatFailed="Couldn't read these pods."
        onClose={() => {}}
      />,
    );

    const error: HTMLElement = await screen.findByTestId("failed-error");
    expect(error).toHaveTextContent("The pods could not be read.");
    expect(screen.queryByTestId("failed-item")).toBeNull();

    const retry: HTMLElement = within(error).getByRole("button");
    fireEvent.click(retry);

    await screen.findAllByTestId("failed-item");
    expect(attempt).toBe(2);
    expect(screen.queryByTestId("failed-error")).toBeNull();
  });

  test("says so in the page's words when nothing matches any more", async () => {
    render(
      <ResourceAttentionDialog
        testId="failed"
        title="3 failed pods"
        load={() => {
          return Promise.resolve({ items: [] });
        }}
        emptyMessage="No failed pods now: they were cleaned up since the count was read."
        onClose={() => {}}
      />,
    );

    expect(await screen.findByTestId("failed-empty")).toHaveTextContent(
      "No failed pods now: they were cleaned up since the count was read.",
    );
  });

  test("says when it lists only the first of more", async () => {
    render(
      <ResourceAttentionDialog
        testId="failed"
        title="450 failed pods"
        load={() => {
          return Promise.resolve({
            items: [crashLoopingPod(), pendingPod()],
            isTruncated: true,
          });
        }}
        emptyMessage="No failed pods now."
        onClose={() => {}}
      />,
    );

    expect(await screen.findByTestId("failed-truncated")).toHaveTextContent(
      "Showing the first 2, the most urgent first.",
    );
  });
});

describe("the dialog a part's own status opens", () => {
  /*
   * A part's page lists the part itself among what needs attention: its
   * hero above names it, and View would open the page the reader is on.
   */
  test("names the part whose page this is as its card does, with no View; the rest keep theirs", () => {
    render(
      <ResourceAttentionDialog
        testId="status"
        title="Needs attention"
        items={[crashLoopingPod(), pendingPod()]}
        emptyMessage="Nothing needs attention now."
        onClose={() => {}}
        current={{ key: "Pod:shop/queued", label: "This pod" }}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("status-item");
    expect(rows[0]!).not.toHaveAttribute("data-current");
    expect(within(rows[0]!).getByTestId("status-view")).toHaveAttribute(
      "href",
      "/dashboard/k8s/pods/checkout-7d9f8b6c5-x2k4q",
    );

    expect(rows[1]!).toHaveAttribute("data-current", "true");
    expect(within(rows[1]!).getByTestId("status-name")).toHaveTextContent(
      "This pod",
    );
    // Its kind is not repeated either: the hero says what it is.
    expect(within(rows[1]!).queryByTestId("status-kind")).toBeNull();
    expect(within(rows[1]!).queryByTestId("status-view")).toBeNull();
    // Why it needs attention still reads in full.
    expect(within(rows[1]!).getByTestId("status-reason")).toHaveTextContent(
      "Can't be scheduled",
    );
  });

  test("its own row's words are in the reader's language", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    render(
      <ResourceAttentionDialog
        testId="status"
        title="Needs attention"
        items={[pendingPod()]}
        emptyMessage="Nothing needs attention now."
        onClose={() => {}}
        current={{ key: "Pod:shop/queued", label: "This pod" }}
      />,
    );

    const german: string = readLocale("de")["This pod"] || "";
    expect(german).not.toBe("");
    expect(screen.getByTestId("status-name")).toHaveTextContent(german);
  });
});

describe("a count that opens the dialog", () => {
  test("is a real button that says it opens a dialog, and what a press shows", () => {
    render(
      <ResourceAttentionPill
        testId="status-chip"
        label={
          <>
            <span className="font-semibold">3</span>
            <span>Failed</span>
          </>
        }
        tone="danger"
        hint="Show which pods and why"
        dataAttributes={{ "data-chip": "Failed" }}
        dialog={{
          title: "3 failed pods",
          items: [pendingPod()],
          emptyMessage: "No failed pods now.",
        }}
      />,
    );

    const button: HTMLElement = screen.getByTestId("status-chip");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-chip", "Failed");
    expect(button).toHaveAttribute("data-tone", "danger");
    expect(button).toHaveTextContent("3Failed");
    expect(button).toHaveAccessibleDescription("Show which pods and why");
    expect(button).toHaveAttribute("title", "Show which pods and why");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(within(dialog).getByText("3 failed pods")).toBeInTheDocument();
    expect(screen.getByTestId("status-chip-dialog")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("its hint is in the reader's language", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });
    i18next.addResource(
      "de",
      "translation",
      "Show which pods and why",
      "Zeigen, welche Pods und warum",
    );

    render(
      <ResourceAttentionPill
        testId="status-chip"
        label="3"
        tone="danger"
        hint="Show which pods and why"
        dialog={{ title: "3", items: [], emptyMessage: "No failed pods now." }}
      />,
    );

    expect(screen.getByTestId("status-chip")).toHaveAccessibleDescription(
      "Zeigen, welche Pods und warum",
    );
  });
});

describe("a resource's health pill", () => {
  const words: { degradedTitle: string; unhealthyTitle: string } = {
    degradedTitle: "Why this cluster is Degraded",
    unhealthyTitle: "Why this cluster is Unhealthy",
  };

  test("Healthy says so, and opens nothing", () => {
    render(
      <ResourceHealthPill
        health="Healthy"
        isConnected={true}
        items={[]}
        testId="health"
        words={words}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("health");
    expect(pill.tagName).toBe("SPAN");
    expect(pill).toHaveTextContent("Healthy");
    expect(pill).toHaveAttribute("data-health", "Healthy");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("while the agent is not connected it says Health Unknown in grey, whatever the last inventory said", () => {
    render(
      <ResourceHealthPill
        health="Unhealthy"
        isConnected={false}
        items={[crashLoopingPod()]}
        testId="health"
        words={words}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("health");
    expect(pill.tagName).toBe("SPAN");
    expect(pill).toHaveTextContent("Health Unknown");
    expect(pill).toHaveAttribute("data-health", "Unknown");
    expect(pill).toHaveAttribute("data-tone", "neutral");
  });

  test("Degraded opens why: what needs attention, each a step from its page", () => {
    render(
      <ResourceHealthPill
        health="Degraded"
        isConnected={true}
        items={[pendingPod()]}
        testId="health"
        words={words}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("health");
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveTextContent("Degraded");
    expect(pill).toHaveAttribute("data-health", "Degraded");
    expect(pill).toHaveAttribute("data-tone", "warning");
    expect(pill).toHaveAccessibleDescription("Show why");

    fireEvent.click(pill);

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Why this cluster is Degraded"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Nothing is broken, but these need a look soon. The most urgent come first.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("health-dialog-item")).toHaveLength(1);
    expect(screen.getByTestId("health-dialog-name")).toHaveTextContent(
      "queued",
    );
    expect(screen.getByTestId("health-dialog-view")).toHaveAttribute(
      "href",
      "/dashboard/k8s/pods/queued",
    );
  });

  test("Unhealthy opens why, in its own words", () => {
    render(
      <ResourceHealthPill
        health="Unhealthy"
        isConnected={true}
        items={[crashLoopingPod(), pendingPod()]}
        testId="health"
        words={words}
      />,
    );

    fireEvent.click(screen.getByTestId("health"));

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Why this cluster is Unhealthy"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Something is broken. These need attention, the most urgent first.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("health-dialog-item")).toHaveLength(2);
  });

  test("a Degraded pill with nothing to list opens nothing", () => {
    render(
      <ResourceHealthPill
        health="Degraded"
        isConnected={true}
        items={[]}
        testId="health"
        words={words}
      />,
    );

    expect(screen.getByTestId("health").tagName).toBe("SPAN");
  });
});

describe("the Needs attention card draws the same row", () => {
  test("a whole-row link, its facts as words and never links of their own", async () => {
    render(
      <NeedsAttentionCard
        testId="needs-attention"
        items={[crashLoopingPod()]}
      />,
    );

    const row: HTMLElement = screen.getByTestId("needs-attention-item");
    // The row is one link: nothing inside it is another.
    const links: Array<HTMLElement> = within(row).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "/dashboard/k8s/pods/checkout-7d9f8b6c5-x2k4q",
    );
    expect(within(row).queryByTestId("needs-attention-fact-link")).toBeNull();
    expect(within(row).getByTestId("needs-attention-facts")).toHaveTextContent(
      "Deployment checkout",
    );
    expect(
      within(row)
        .getAllByTestId("needs-attention-reason")
        .map((chip: HTMLElement): string => {
          return chip.textContent || "";
        }),
    ).toEqual(["CrashLoopBackOff", "Last restart: Error, exit code 1"]);
    await waitFor(() => {
      expect(within(row).getByTestId("needs-attention-kind")).toHaveTextContent(
        "Pod",
      );
    });
  });
});
