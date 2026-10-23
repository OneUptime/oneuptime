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
 */

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
    />,
  );
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
      screen.getByRole("textbox", {
        name: "Component Name Filter (Optional)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Timeout (ms) (Optional)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Retries (Optional)" }),
    ).toBeInTheDocument();
  });

  test.each([
    "Component Group Filter",
    "Component Name Filter",
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

  test("the name filter's line says how it matches, in one sentence a person reads", () => {
    renderForm();

    expect(
      screen.getByText(
        "Only watch components whose names contain this, e.g. 'API'. With a group set, only inside that group.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Leave blank to monitor all components in scope/),
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
