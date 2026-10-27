import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { Mock } from "jest-mock";
import ExternalStatusPageComponentsField, {
  COMPONENTS_FIELD_TEST_ID,
  COMPONENTS_RETRY_TEST_ID,
  COMPONENTS_STATUS_TEST_ID,
  COMPONENTS_UNMATCHED_TEST_ID,
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageComponentsField";
import {
  ExternalStatusPageCatalog,
  ExternalStatusPageCatalogError,
  ExternalStatusPageCatalogProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExternalStatusPageComponentCatalog";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import ExternalStatusPageReading from "../../../Utils/Monitor/ExternalStatusPageReading";
import {
  GITHUB_PAGE,
  OPENAI_PAGE,
  atlassianComponentsJSON,
  incidentIoProxyJSON,
  withStatuses,
} from "../../Helpers/ExternalStatusPageFixtures";

/*
 * THE COMPONENTS FIELD OF AN EXTERNAL STATUS PAGE MONITOR (issue #5156).
 *
 * Empty, the monitor watches the whole page. Opened, the field reads the
 * page's components - once, when the menu first opens for that address -
 * and offers them in the page's groups, a component that is not
 * operational saying its status. Several are picked in a row, the menu kept
 * open. A name the page does not list is typed and added ("Add “…”"), a
 * pattern with a * worded for what it does. Under the field, what was read,
 * the chosen names the page does not list, or why nothing could be read,
 * with Try again.
 *
 * The page is read through the field's readCatalog seam, from the providers'
 * answers (ExternalStatusPageFixtures) read as the picker reads them.
 */

const GITHUB_URL: string = "https://www." + "githubstatus.com";
const GITHUB_HOST: string = "www." + "githubstatus.com";

function githubCatalog(
  statuses: Record<string, string> = {},
): ExternalStatusPageCatalog {
  return {
    provider: ExternalStatusPageProviderType.AtlassianStatuspage,
    host: GITHUB_HOST,
    components: ExternalStatusPageReading.readAtlassianComponents(
      atlassianComponentsJSON(withStatuses(GITHUB_PAGE, statuses)),
    )!,
  };
}

function openAiCatalog(): ExternalStatusPageCatalog {
  return {
    provider: ExternalStatusPageProviderType.IncidentIo,
    host: "status.openai.com",
    components: ExternalStatusPageReading.readIncidentIo(
      incidentIoProxyJSON(
        withStatuses(OPENAI_PAGE, { Conversations: "partial_outage" }),
        [],
      ),
    )!.components,
  };
}

type ReadCatalog = NonNullable<ComponentProps["readCatalog"]>;
type OnChange = (names: Array<string>) => void;

interface Harness {
  onChange: Mock<OnChange>;
  readCatalog: Mock<ReadCatalog>;
  rerender: (props: Partial<ComponentProps>) => void;
}

function renderField(
  props: Partial<ComponentProps> = {},
  catalog: () => Promise<ExternalStatusPageCatalog> = (): Promise<ExternalStatusPageCatalog> => {
    return Promise.resolve(githubCatalog());
  },
): Harness {
  const onChange: Mock<OnChange> = jest.fn<OnChange>();
  const readCatalog: Mock<ReadCatalog> = jest.fn<ReadCatalog>(catalog);

  const build: (overrides: Partial<ComponentProps>) => React.ReactElement = (
    overrides: Partial<ComponentProps>,
  ): React.ReactElement => {
    return (
      <ExternalStatusPageComponentsField
        statusPageUrl={GITHUB_URL}
        provider={ExternalStatusPageProviderType.Auto}
        componentNames={[]}
        labelId="components-label"
        descriptionId="components-description"
        onChange={onChange}
        readCatalog={readCatalog}
        {...props}
        {...overrides}
      />
    );
  };

  const result: ReturnType<typeof render> = render(build({}));

  return {
    onChange,
    readCatalog,
    rerender: (overrides: Partial<ComponentProps>): void => {
      result.rerender(build(overrides));
    },
  };
}

function box(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Components/ });
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(box(), { key: "ArrowDown" });
  });
  // Let the read settle.
  await act(async () => {
    await Promise.resolve();
  });
}

// An option's name: its label, without the status under it.
function nameOf(option: HTMLElement): string {
  return (
    option.querySelector("span.font-medium")?.textContent ||
    option.textContent ||
    ""
  ).trim();
}

function optionNames(): Array<string> {
  return screen.queryAllByRole("option").map(nameOf);
}

function option(name: string): HTMLElement {
  const found: Array<HTMLElement> = screen
    .queryAllByRole("option")
    .filter((candidate: HTMLElement): boolean => {
      return nameOf(candidate) === name;
    });

  expect({ name, found: found.length }).toEqual({ name, found: 1 });

  return found[0]!;
}

async function pick(name: string): Promise<void> {
  await act(async () => {
    const picked: HTMLElement = option(name);
    fireEvent.mouseDown(picked);
    fireEvent.click(picked);
  });
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
}

afterEach(() => {
  cleanup();
});

describe("the field, before it is opened", () => {
  test("is named Components, says it is optional, and what empty means", () => {
    renderField();

    const label: HTMLElement = screen
      .getByText("Components", { selector: "label span" })
      .closest("label") as HTMLElement;

    expect(label).toHaveTextContent("Components (Optional)");
    expect(box()).toHaveAttribute("aria-labelledby", "components-label");
    expect(
      screen.getByText(
        "Watch only these components: only their incidents and statuses count. Leave empty to watch the whole page.",
      ),
    ).toHaveAttribute("id", "components-description");
    // Empty reads as what it means.
    expect(screen.getByText("All components")).toBeInTheDocument();
  });

  test("asks nothing of the page until it is opened", () => {
    const harness: Harness = renderField();

    expect(harness.readCatalog).not.toHaveBeenCalled();
    expect(screen.queryByTestId(COMPONENTS_STATUS_TEST_ID)).toBeNull();
  });

  test("shows the chosen components as chips, a pattern as written", () => {
    renderField({ componentNames: ["Git Operations", "*API*"] });

    const field: HTMLElement = screen.getByTestId(COMPONENTS_FIELD_TEST_ID);

    expect(within(field).getByText("Git Operations")).toBeInTheDocument();
    expect(within(field).getByText("*API*")).toBeInTheDocument();
    expect(
      within(field).getByRole("button", { name: "Remove Git Operations" }),
    ).toBeInTheDocument();
  });
});

describe("opened, it reads the page once and offers its components", () => {
  test("GitHub's twelve, in the page's order, read once for the address", async () => {
    const harness: Harness = renderField();

    await openMenu();

    expect(harness.readCatalog).toHaveBeenCalledTimes(1);
    expect(harness.readCatalog.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        statusPageUrl: GITHUB_URL,
        provider: ExternalStatusPageProviderType.Auto,
      }),
    );
    expect(optionNames()).toEqual(
      GITHUB_PAGE.components.map((component: { name: string }): string => {
        return component.name;
      }),
    );
    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
      `12 components on ${GITHUB_HOST}.`,
    );

    // Closed and opened again: not read again.
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    await openMenu();

    expect(harness.readCatalog).toHaveBeenCalledTimes(1);
  });

  test("while it reads, the menu says so", async () => {
    let finish: (catalog: ExternalStatusPageCatalog) => void = (): void => {};

    renderField({}, (): Promise<ExternalStatusPageCatalog> => {
      return new Promise<ExternalStatusPageCatalog>(
        (resolve: (catalog: ExternalStatusPageCatalog) => void) => {
          finish = resolve;
        },
      );
    });

    await openMenu();

    expect(
      screen.getByText(`Reading the components of ${GITHUB_HOST}…`),
    ).toBeInTheDocument();

    await act(async () => {
      finish(githubCatalog());
    });

    expect(optionNames()).toHaveLength(12);
  });

  test("a component that is not operational says its status", async () => {
    renderField({}, (): Promise<ExternalStatusPageCatalog> => {
      return Promise.resolve(githubCatalog({ Copilot: "major_outage" }));
    });

    await openMenu();

    expect(option("Copilot")).toHaveTextContent("Major Outage");
    expect(option("Copilot AI Model Providers")).not.toHaveTextContent(
      "Outage",
    );
    expect(option("Git Operations")).not.toHaveTextContent("Operational");
  });

  test("a page in groups is offered in its groups, the ungrouped first", async () => {
    renderField({}, (): Promise<ExternalStatusPageCatalog> => {
      return Promise.resolve(openAiCatalog());
    });

    await openMenu();

    expect(optionNames()[0]).toBe("Sora");

    const groups: Array<string> = Array.from(
      document.querySelectorAll(".ou-select__group-heading"),
    ).map((heading: Element): string => {
      return (heading.textContent || "").trim();
    });

    expect(groups.map((group: string): string => {
      return group.toLowerCase();
    })).toEqual(["apis", "chatgpt", "codex"]);
  });

  test("with a group set, only that group's components, and the line says so", async () => {
    renderField({ componentGroupName: "ChatGPT" }, (): Promise<ExternalStatusPageCatalog> => {
      return Promise.resolve(openAiCatalog());
    });

    await openMenu();

    expect(optionNames()).toEqual(["Login", "Conversations", "File uploads"]);
    expect(option("Conversations")).toHaveTextContent("Partial Outage");
    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
      "3 components in ChatGPT on status.openai.com.",
    );
  });
});

describe("picking", () => {
  /*
   * The list stays open for the next pick on a desktop: jsdom passes for a
   * touch screen, where react-select closes it to put the keyboard away, so
   * the browser suite (ExternalStatusPageMonitor.spec.ts) holds that part.
   */
  test("several, one after another, each handed over by its name", async () => {
    const harness: Harness = renderField();

    await openMenu();
    await pick("Git Operations");

    expect(harness.onChange).toHaveBeenLastCalledWith(["Git Operations"]);

    harness.rerender({ componentNames: ["Git Operations"] });
    await openMenu();
    await pick("Pull Requests");

    expect(harness.onChange).toHaveBeenLastCalledWith([
      "Git Operations",
      "Pull Requests",
    ]);
  });

  test("a picked component leaves the list; removing its chip hands over the rest", async () => {
    const harness: Harness = renderField({
      componentNames: ["Git Operations", "Pull Requests"],
    });

    await openMenu();

    expect(optionNames()).not.toContain("Git Operations");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Git Operations" }),
      );
    });

    expect(harness.onChange).toHaveBeenLastCalledWith(["Pull Requests"]);
  });

  test("a name typed in another case shows as the page spells it, and is picked once", async () => {
    renderField({ componentNames: ["git operations"] });

    await openMenu();

    expect(
      within(screen.getByTestId(COMPONENTS_FIELD_TEST_ID)).getByText(
        "Git Operations",
      ),
    ).toBeInTheDocument();
    expect(optionNames()).not.toContain("Git Operations");
    expect(screen.queryByTestId(COMPONENTS_UNMATCHED_TEST_ID)).toBeNull();
  });
});

describe("typing a name the page does not list", () => {
  test("offers to add it, and adds it as typed", async () => {
    const harness: Harness = renderField();

    await openMenu();
    await type("Webhook");

    expect(screen.getByText("Add “Webhook”")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(box(), { key: "ArrowUp" });
    });
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });

    expect(harness.onChange).toHaveBeenLastCalledWith(["Webhook"]);
  });

  test("a pattern is worded for what it does", async () => {
    renderField();

    await openMenu();
    await type("*us-east-1*");

    expect(
      screen.getByText("Watch every component that matches “*us-east-1*”"),
    ).toBeInTheDocument();
  });

  test("a component's own name is not offered to add again, nor one picked", async () => {
    renderField({ componentNames: ["Pull Requests"] });

    await openMenu();
    await type("git operations");

    expect(screen.queryByText(/^Add “/)).toBeNull();
    expect(optionNames()).toEqual(["Git Operations"]);

    await type("Pull Requests");

    expect(screen.queryByText(/^Add “/)).toBeNull();
  });

  test("white space alone is nothing to add", async () => {
    renderField();

    await openMenu();
    await type("   ");

    expect(screen.queryByText(/^Add “/)).toBeNull();
  });

  test("a chosen name the page does not list is said under the field", async () => {
    renderField({ componentNames: ["Git Operations", "Webhook"] });

    await openMenu();

    expect(screen.getByTestId(COMPONENTS_UNMATCHED_TEST_ID)).toHaveTextContent(
      "Not on this page, so not watched: Webhook",
    );
  });

  test("a pattern that matches is not said to be missing; one that does not, is", async () => {
    renderField({ componentNames: ["*Requests", "*Kubernetes*"] });

    await openMenu();

    expect(screen.getByTestId(COMPONENTS_UNMATCHED_TEST_ID)).toHaveTextContent(
      "Not on this page, so not watched: *Kubernetes*",
    );
  });
});

describe("a page that cannot be read", () => {
  test("says why, under the field and in the menu, and Try again reads it again", async () => {
    let attempt: number = 0;
    const harness: Harness = renderField({}, (): Promise<ExternalStatusPageCatalog> => {
      attempt++;

      return attempt === 1
        ? Promise.reject(
            new ExternalStatusPageCatalogError(
              ExternalStatusPageCatalogProblem.NotRead,
            ),
          )
        : Promise.resolve(githubCatalog());
    });

    await openMenu();

    const sentence: string = `Could not read a list of components from ${GITHUB_HOST}. Type a component's name as the page shows it, then press Enter.`;

    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
      sentence,
    );
    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveAttribute(
      "data-problem",
      ExternalStatusPageCatalogProblem.NotRead,
    );
    expect(screen.getAllByText(sentence).length).toBeGreaterThanOrEqual(1);

    // Opened again, it is not read again by itself.
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    await openMenu();

    expect(harness.readCatalog).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId(COMPONENTS_RETRY_TEST_ID));
    });

    expect(harness.readCatalog).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
      `12 components on ${GITHUB_HOST}.`,
    );
  });

  test.each([
    [
      ExternalStatusPageCatalogProblem.TimedOut,
      `${GITHUB_HOST} took too long to answer.`,
      true,
    ],
    [
      ExternalStatusPageCatalogProblem.NoComponents,
      `${GITHUB_HOST} lists no components to pick from.`,
      false,
    ],
  ])(
    "%s: says so, Try again %p",
    async (
      problem: ExternalStatusPageCatalogProblem,
      sentence: string,
      canTryAgain: boolean,
    ) => {
      renderField({}, (): Promise<ExternalStatusPageCatalog> => {
        return Promise.reject(new ExternalStatusPageCatalogError(problem));
      });

      await openMenu();

      expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
        sentence,
      );
      expect(Boolean(screen.queryByTestId(COMPONENTS_RETRY_TEST_ID))).toBe(
        canTryAgain,
      );
    },
  );

  test("a feed asks nothing, and says to type words from its items' titles", async () => {
    const harness: Harness = renderField({
      provider: ExternalStatusPageProviderType.RSS,
      statusPageUrl: `${GITHUB_URL}/history.rss`,
    });

    await openMenu();

    expect(harness.readCatalog).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "An RSS or Atom feed lists no components. Type words from its items' titles, then press Enter.",
      ),
    ).toBeInTheDocument();
  });

  test("no address yet: asks nothing, and says what the field needs", async () => {
    const harness: Harness = renderField({ statusPageUrl: "" });

    await openMenu();

    expect(harness.readCatalog).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Enter the status page URL to pick from its components, or type a name and press Enter.",
      ),
    ).toBeInTheDocument();
  });
});

describe("another address", () => {
  test("forgets what the last one said, and reads the new one when opened", async () => {
    const harness: Harness = renderField(
      {},
      (): Promise<ExternalStatusPageCatalog> => {
        return harness.readCatalog.mock.calls.length === 1
          ? Promise.resolve(githubCatalog())
          : Promise.resolve(openAiCatalog());
      },
    );

    await openMenu();

    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
      GITHUB_HOST,
    );

    harness.rerender({ statusPageUrl: "https://status.openai.com" });

    expect(screen.queryByTestId(COMPONENTS_STATUS_TEST_ID)).toBeNull();

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    await openMenu();

    expect(harness.readCatalog).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(COMPONENTS_STATUS_TEST_ID)).toHaveTextContent(
      "status.openai.com",
    );
  });

  test("another provider is another read too", async () => {
    const harness: Harness = renderField();

    await openMenu();
    harness.rerender({
      provider: ExternalStatusPageProviderType.AtlassianStatuspage,
    });

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    await openMenu();

    expect(harness.readCatalog).toHaveBeenCalledTimes(2);
    expect(harness.readCatalog.mock.calls[1]![0].provider).toBe(
      ExternalStatusPageProviderType.AtlassianStatuspage,
    );
  });

  test("a read that ends after the field is gone changes nothing", async () => {
    let finish: (catalog: ExternalStatusPageCatalog) => void = (): void => {};

    const harness: Harness = renderField(
      {},
      (): Promise<ExternalStatusPageCatalog> => {
        return new Promise<ExternalStatusPageCatalog>(
          (resolve: (catalog: ExternalStatusPageCatalog) => void) => {
            finish = resolve;
          },
        );
      },
    );

    await openMenu();

    const signal: AbortSignal = harness.readCatalog.mock.calls[0]![0].signal;

    cleanup();

    expect(signal.aborted).toBe(true);

    await act(async () => {
      finish(githubCatalog());
    });
  });
});
