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
import ExternalStatusPageMonitorStepForm, {
  getExternalStatusPageProviderOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorStepForm";
import { COMPONENTS_FIELD_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageComponentsField";
import { ExternalStatusPageCatalog } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExternalStatusPageComponentCatalog";
import ExternalStatusPageReading from "../../../Utils/Monitor/ExternalStatusPageReading";
import {
  GITHUB_PAGE,
  atlassianComponentsJSON,
} from "../../Helpers/ExternalStatusPageFixtures";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor, {
  MonitorStepExternalStatusPageMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The External Status Page step of Create Monitor and of a monitor's
 * criteria (ExternalStatusPageMonitorStepForm), as the UI review of issue
 * #5176's OneUptime provider left it:
 *
 *   - the Provider dropdown starts with Auto, what a new monitor starts on
 *     and most keep, and is never empty: no clear button and no
 *     "(Optional)";
 *   - every box is named by its label, for a screen reader;
 *   - each optional field says "(Optional)" once, small and grey after its
 *     title, as every form does - the two filters said it in their titles;
 *   - two steps on one page never share an id.
 *
 * And as issue #5156 left it: the components the monitor watches are
 * chosen out in the form (Components), not typed into a filter under More
 * fields; a monitor saved with one Component Name Filter shows it there as
 * that name between stars, and choosing writes the list and the one name a
 * probe that has not been upgraded reads.
 */

const GITHUB_URL: string = "https://www." + "githubstatus.com";

const readGitHub: () => Promise<ExternalStatusPageCatalog> =
  (): Promise<ExternalStatusPageCatalog> => {
    return Promise.resolve({
      provider: ExternalStatusPageProviderType.AtlassianStatuspage,
      host: "www." + "githubstatus.com",
      components: ExternalStatusPageReading.readAtlassianComponents(
        atlassianComponentsJSON(GITHUB_PAGE),
      )!,
    });
  };

const PROVIDER_LABELS: Array<string> = [
  "Auto",
  "Atlassian Statuspage",
  "incident.io",
  "OneUptime Status Page",
  "RSS",
  "Atom",
];

type OnChange = (value: MonitorStepExternalStatusPageMonitor) => void;

function renderForm(
  value: MonitorStepExternalStatusPageMonitor = MonitorStepExternalStatusPageMonitorUtil.getDefault(),
  onChange: OnChange = (): void => {},
): void {
  render(
    <ExternalStatusPageMonitorStepForm
      monitorStepExternalStatusPageMonitor={value}
      onChange={onChange}
      readCatalog={readGitHub}
    />,
  );
}

function lastChange(
  onChange: Mock<OnChange>,
): MonitorStepExternalStatusPageMonitor {
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as MonitorStepExternalStatusPageMonitor;
}

afterEach(() => {
  cleanup();
});

describe("the Provider dropdown", () => {
  test("offers Auto first, then every format in the enum's order, each once", () => {
    const options: Array<DropdownOption> =
      getExternalStatusPageProviderOptions();

    expect(
      options.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(PROVIDER_LABELS);
    expect(
      options.map((option: DropdownOption): string => {
        return option.value.toString();
      }),
    ).toEqual([
      ExternalStatusPageProviderType.Auto,
      ...Object.values(ExternalStatusPageProviderType).filter(
        (provider: string): boolean => {
          return provider !== ExternalStatusPageProviderType.Auto;
        },
      ),
    ]);
  });

  test("is named Provider, starts on Auto, and cannot be cleared", () => {
    renderForm();

    const provider: HTMLElement = screen.getByRole("combobox", {
      name: "Provider",
    });
    const control: HTMLElement = provider.closest(
      ".ou-select__control",
    ) as HTMLElement;

    expect(control).not.toBeNull();
    expect(within(control).getByText("Auto")).toBeInTheDocument();
    expect(
      control.querySelector(".ou-select__clear-indicator"),
    ).not.toBeInTheDocument();
  });

  test("says nothing of being optional: it always has a value", () => {
    renderForm();

    const label: HTMLElement = screen
      .getByText("Provider", {
        selector: "label span",
      })
      .closest("label") as HTMLElement;

    expect(label).toHaveTextContent(/^Provider$/);
  });

  test("hands the picked provider over, and shows a saved one", async () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    renderForm(
      {
        ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
        provider: ExternalStatusPageProviderType.OneUptime,
      },
      onChange,
    );

    const provider: HTMLElement = screen.getByRole("combobox", {
      name: "Provider",
    });

    expect(
      within(provider.closest(".ou-select__control") as HTMLElement).getByText(
        "OneUptime Status Page",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(provider, { key: "ArrowDown" });
    });
    await act(async () => {
      const option: HTMLElement = screen.getByRole("option", { name: "RSS" });
      fireEvent.mouseDown(option);
      fireEvent.click(option);
    });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: ExternalStatusPageProviderType.RSS }),
    );
  });
});

describe("the fields' labels", () => {
  test("name every box", () => {
    renderForm();

    expect(
      screen.getByRole("textbox", { name: "Status Page URL" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "Component Group Filter (Optional)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Components (Optional)" }),
    ).toBeInTheDocument();
    // The filter it replaced is gone.
    expect(
      screen.queryByRole("textbox", {
        name: "Component Name Filter (Optional)",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Timeout (ms) (Optional)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Retries (Optional)" }),
    ).toBeInTheDocument();
  });

  test.each([
    "Components",
    "Component Group Filter",
    "Timeout (ms)",
    "Retries",
  ])(
    "%s says (Optional) once, small and grey after its title",
    (title: string) => {
      renderForm();

      const label: HTMLElement = screen
        .getByText(title, { selector: "label > span", exact: false })
        .closest("label") as HTMLElement;

      expect(label).toHaveTextContent(`${title} (Optional)`);
      expect(label.textContent?.split("(Optional)").length).toBe(2);
      expect(label.querySelector("span.text-gray-400")).toHaveTextContent(
        "(Optional)",
      );
    },
  );

  test("the Components line says what choosing does, and what empty means", () => {
    renderForm();

    expect(
      screen.getByText(
        "Pick the components you depend on: only their incidents and statuses count. Leave empty to watch the whole page.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Only watch components whose names contain this, e.g. 'API'. With a group set, only inside that group.",
      ),
    ).not.toBeInTheDocument();
  });

  test("typing a group hands it over; clearing it hands over none", () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    renderForm(MonitorStepExternalStatusPageMonitorUtil.getDefault(), onChange);

    const group: HTMLElement = screen.getByRole("textbox", {
      name: "Component Group Filter (Optional)",
    });

    fireEvent.change(group, { target: { value: "Core" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ componentGroupName: "Core" }),
    );

    fireEvent.change(group, { target: { value: "" } });
    expect(
      (
        onChange.mock.calls[
          onChange.mock.calls.length - 1
        ]![0] as MonitorStepExternalStatusPageMonitor
      ).componentGroupName,
    ).toBeUndefined();
  });
});

describe("the components the monitor watches", () => {
  test("are chosen out in the form, before More fields, which no longer holds a name filter", () => {
    renderForm();

    const field: HTMLElement = screen.getByTestId(COMPONENTS_FIELD_TEST_ID);
    const moreFields: HTMLElement = screen.getByTestId(
      "external-status-page-monitor-more-fields",
    );

    expect(moreFields.contains(field)).toBe(false);
    expect(
      field.compareDocumentPosition(moreFields) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(moreFields).not.toHaveTextContent("Component Name Filter");
    expect(moreFields).toHaveTextContent("Component Group Filter");
  });

  test("a monitor saved with one Component Name Filter shows it as that name between stars", () => {
    renderForm({
      ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
      statusPageUrl: GITHUB_URL,
      componentName: "API",
      componentNames: undefined,
    });

    expect(
      within(screen.getByTestId(COMPONENTS_FIELD_TEST_ID)).getByText("*API*"),
    ).toBeInTheDocument();
  });

  test("choosing writes the list, and the one name an older probe reads", async () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    renderForm(
      {
        ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
        statusPageUrl: GITHUB_URL,
      },
      onChange,
    );

    const components: HTMLElement = screen.getByRole("combobox", {
      name: "Components (Optional)",
    });

    await act(async () => {
      fireEvent.keyDown(components, { key: "ArrowDown" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      const option: HTMLElement = screen.getByRole("option", {
        name: "Git Operations",
      });
      fireEvent.mouseDown(option);
      fireEvent.click(option);
    });

    expect(lastChange(onChange)).toEqual(
      expect.objectContaining({
        statusPageUrl: GITHUB_URL,
        componentNames: ["Git Operations"],
        componentName: "Git Operations",
      }),
    );
  });

  test("clearing them watches the whole page, the old filter gone too", async () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    renderForm(
      {
        ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
        statusPageUrl: GITHUB_URL,
        componentName: "API",
        componentNames: undefined,
      },
      onChange,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove *API*" }));
    });

    expect(lastChange(onChange).componentNames).toEqual([]);
    expect(lastChange(onChange).componentName).toBeUndefined();
  });
});

describe("two steps on one page", () => {
  test("never share an id, so each label names its own box", () => {
    render(
      <>
        <ExternalStatusPageMonitorStepForm
          monitorStepExternalStatusPageMonitor={MonitorStepExternalStatusPageMonitorUtil.getDefault()}
          onChange={(): void => {}}
        />
        <ExternalStatusPageMonitorStepForm
          monitorStepExternalStatusPageMonitor={MonitorStepExternalStatusPageMonitorUtil.getDefault()}
          onChange={(): void => {}}
        />
      </>,
    );

    const ids: Array<string> = Array.from(document.querySelectorAll("[id]"))
      .map((element: Element): string => {
        return element.id;
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });

    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByRole("combobox", { name: "Provider" })).toHaveLength(
      2,
    );
    expect(
      screen.getAllByRole("textbox", { name: "Status Page URL" }),
    ).toHaveLength(2);
  });
});
