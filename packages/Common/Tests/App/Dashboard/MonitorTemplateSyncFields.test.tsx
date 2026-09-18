import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import URL from "../../../Types/API/URL";
import Route from "../../../Types/API/Route";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorTemplateSyncFields, {
  getMonitorTemplateSyncFieldSummary,
  MonitorTemplateSyncFieldsSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTemplateSyncFields";
import MonitorTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplates";

type TemplateCreateCallback = (
  item: MonitorTemplate,
) => Promise<MonitorTemplate>;
let templateCreateCallback: TemplateCreateCallback | undefined;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { onBeforeCreate: TemplateCreateCallback }) => {
      templateCreateCallback = props.onBeforeCreate;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  templateCreateCallback = undefined;
});

function configuredStep(selectedFields?: Array<string>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(URL.fromString("https://monitor.example.test"));
  step.setRequestHeaders({
    Authorization: "secret-header",
    "X-Region": "west",
  });
  step.setRequestBody("secret-request-body");
  step.data!.doNotFollowRedirects = false;
  step.data!.retryCount = 0;
  if (selectedFields) {
    step.data!.doNotSyncFields = selectedFields;
  }
  return step;
}

function monitorSteps(...steps: Array<MonitorStep>): MonitorSteps {
  const result: MonitorSteps = new MonitorSteps();
  result.setMonitorStepsInstanceArray(steps);
  return result;
}

type MonitorStepChangeMock = ReturnType<
  typeof jest.fn<(value: MonitorStep) => void>
>;

interface HarnessProps {
  initialValue: MonitorStep;
  onChange: (value: MonitorStep) => void;
}

function Harness(props: HarnessProps): ReactElement {
  const [step, setStep] = useState<MonitorStep>(props.initialValue);
  return (
    <MonitorTemplateSyncFields
      monitorType={MonitorType.API}
      isMonitorTemplate={true}
      value={step}
      onChange={(value: MonitorStep) => {
        setStep(value);
        props.onChange(value);
      }}
    />
  );
}

describe("monitor template field sync controls", () => {
  test("existing templates start with no fields protected and do not change on mount", () => {
    const onChange: MonitorStepChangeMock =
      jest.fn<(value: MonitorStep) => void>();
    render(<Harness initialValue={configuredStep()} onChange={onChange} />);

    expect(
      screen.getByRole("heading", { name: "Template sync settings" }),
    ).toBeVisible();
    const checkboxes: Array<HTMLElement> = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);
    checkboxes.forEach((checkbox: HTMLElement) => {
      expect(checkbox).not.toBeChecked();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/defaults for new monitors/)).toBeVisible();
    expect(
      screen.getByText(/Lists such as request headers are preserved in full/),
    ).toBeVisible();
  });

  test("checking a field emits a cloned step while keeping its default value and other settings", () => {
    const original: MonitorStep = configuredStep();
    const originalJson: unknown = original.toJSON();
    const onChange: MonitorStepChangeMock =
      jest.fn<(value: MonitorStep) => void>();
    render(<Harness initialValue={original} onChange={onChange} />);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Monitor destination Do not sync this field",
      }),
    );

    const emitted: MonitorStep = onChange.mock.calls[0]![0];
    expect(emitted).not.toBe(original);
    expect(emitted.data?.doNotSyncFields).toEqual(["monitorDestination"]);
    expect(emitted.data?.monitorDestination?.toString()).toBe(
      original.data?.monitorDestination?.toString(),
    );
    expect(emitted.data?.requestHeaders).toEqual(original.data?.requestHeaders);
    expect(emitted.data?.requestBody).toBe("secret-request-body");
    expect(emitted.data?.doNotFollowRedirects).toBe(false);
    expect(emitted.data?.retryCount).toBe(0);
    expect(emitted.data?.id).toBe(original.data?.id);
    expect(emitted.data?.monitorCriteria.toJSON()).toEqual(
      original.data?.monitorCriteria.toJSON(),
    );
    expect(original.toJSON()).toEqual(originalJson);
  });

  test("multiple fields can be checked and one unchecked without losing other selections", () => {
    const onChange: MonitorStepChangeMock =
      jest.fn<(value: MonitorStep) => void>();
    render(<Harness initialValue={configuredStep()} onChange={onChange} />);
    const destination: HTMLElement = screen.getByRole("checkbox", {
      name: "Monitor destination Do not sync this field",
    });
    const headers: HTMLElement = screen.getByRole("checkbox", {
      name: "Request headers Do not sync this field",
    });

    fireEvent.click(destination);
    fireEvent.click(headers);
    expect(onChange.mock.calls[1]![0].data?.doNotSyncFields).toEqual([
      "monitorDestination",
      "requestHeaders",
    ]);
    fireEvent.click(destination);
    expect(destination).not.toBeChecked();
    expect(headers).toBeChecked();
    expect(onChange.mock.calls[2]![0].data?.doNotSyncFields).toEqual([
      "requestHeaders",
    ]);
    fireEvent.click(headers);
    expect(onChange.mock.calls[3]![0].data?.doNotSyncFields).toEqual([]);
  });

  test("loads saved selections after serialization and responds to replacement values", () => {
    const saved: MonitorStep = MonitorStep.clone(
      configuredStep(["requestHeaders", "tlsClientAuthentication"]),
    );
    const { rerender } = render(
      <MonitorTemplateSyncFields
        monitorType={MonitorType.API}
        isMonitorTemplate={true}
        value={saved}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: "Request headers Do not sync this field",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Client certificate authentication Do not sync this field",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Monitor destination Do not sync this field",
      }),
    ).not.toBeChecked();

    rerender(
      <MonitorTemplateSyncFields
        monitorType={MonitorType.API}
        isMonitorTemplate={true}
        value={configuredStep(["monitorDestination"])}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Request headers Do not sync this field",
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Monitor destination Do not sync this field",
      }),
    ).toBeChecked();
  });

  test("each checkbox has an accessible field name and its visible label is clickable", () => {
    const onChange: MonitorStepChangeMock =
      jest.fn<(value: MonitorStep) => void>();
    render(<Harness initialValue={configuredStep()} onChange={onChange} />);
    const headers: HTMLElement = screen.getByRole("checkbox", {
      name: "Request headers Do not sync this field",
    });
    fireEvent.click(
      within(headers.closest("label")!).getByText("Do not sync this field"),
    );
    expect(headers).toBeChecked();
    expect(headers).toHaveAccessibleDescription(
      "Keep the monitor's entire set of request headers.",
    );
  });

  test.each([
    [MonitorType.API, "Request headers", "Port"],
    [MonitorType.Website, "Monitor destination", "Request headers"],
    [MonitorType.Ping, "Monitor destination", "Request headers"],
    [MonitorType.Port, "Port", "Request body"],
    [MonitorType.DNS, "DNS query name", "Request headers"],
    [MonitorType.SQLQuery, "Database connection", "Monitor destination"],
    [MonitorType.SyntheticMonitor, "Browsers", "Request headers"],
    [MonitorType.Logs, "Log query configuration", "Monitor destination"],
  ])(
    "offers relevant fields for %s",
    (type: MonitorType, visible: string, hidden: string) => {
      render(
        <MonitorTemplateSyncFields
          monitorType={type}
          isMonitorTemplate={true}
          value={configuredStep()}
        />,
      );
      expect(
        screen.getByRole("checkbox", {
          name: `${visible} Do not sync this field`,
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("checkbox", {
          name: `${hidden} Do not sync this field`,
        }),
      ).not.toBeInTheDocument();
    },
  );

  test.each([undefined, false])(
    "is hidden on ordinary monitors when template mode is %s",
    (isMonitorTemplate: boolean | undefined) => {
      const { container } = render(
        <MonitorTemplateSyncFields
          monitorType={MonitorType.API}
          isMonitorTemplate={isMonitorTemplate}
          value={configuredStep(["monitorDestination"])}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  test.each([MonitorType.Manual, MonitorType.NetworkDevice])(
    "offers no sync controls for %s",
    (monitorType: MonitorType) => {
      const { container } = render(
        <MonitorTemplateSyncFields
          monitorType={monitorType}
          isMonitorTemplate={true}
          value={configuredStep()}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  test("field controls in separate steps have distinct accessible labels", () => {
    render(
      <>
        <MonitorTemplateSyncFields
          monitorType={MonitorType.API}
          isMonitorTemplate={true}
          value={configuredStep(["requestHeaders"])}
        />
        <MonitorTemplateSyncFields
          monitorType={MonitorType.API}
          isMonitorTemplate={true}
          value={configuredStep()}
        />
      </>,
    );
    const headers: Array<HTMLElement> = screen.getAllByRole("checkbox", {
      name: "Request headers Do not sync this field",
    });
    expect(headers[0]).toBeChecked();
    expect(headers[1]).not.toBeChecked();
    expect(headers[0]!.getAttribute("aria-labelledby")).not.toBe(
      headers[1]!.getAttribute("aria-labelledby"),
    );
  });

  test.each([MonitorType.Ping, MonitorType.Website])(
    "changing template type to %s clears incompatible selections and preserves shared fields",
    (monitorType: MonitorType) => {
      const original: MonitorStep = configuredStep([
        "monitorDestination",
        "requestHeaders",
      ]);
      const onChange: MonitorStepChangeMock =
        jest.fn<(value: MonitorStep) => void>();
      const { rerender } = render(
        <MonitorTemplateSyncFields
          monitorType={MonitorType.API}
          isMonitorTemplate={true}
          value={original}
          onChange={onChange}
        />,
      );
      expect(onChange).not.toHaveBeenCalled();

      rerender(
        <MonitorTemplateSyncFields
          monitorType={monitorType}
          isMonitorTemplate={true}
          value={original}
          onChange={onChange}
        />,
      );
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0].data?.doNotSyncFields).toEqual([
        "monitorDestination",
      ]);
      expect(original.data?.doNotSyncFields).toEqual([
        "monitorDestination",
        "requestHeaders",
      ]);
      expect(
        screen.queryByRole("checkbox", {
          name: "Request headers Do not sync this field",
        }),
      ).not.toBeInTheDocument();
    },
  );

  test("remounting after changing template type also clears incompatible selections", () => {
    const onChange: MonitorStepChangeMock =
      jest.fn<(value: MonitorStep) => void>();
    render(
      <MonitorTemplateSyncFields
        monitorType={MonitorType.DNS}
        isMonitorTemplate={true}
        value={configuredStep(["monitorDestination", "requestHeaders"])}
        onChange={onChange}
      />,
    );
    expect(onChange.mock.calls[0]![0].data?.doNotSyncFields).toEqual([]);
  });

  test("does not rewrite ordinary monitor metadata", () => {
    const onChange: MonitorStepChangeMock =
      jest.fn<(value: MonitorStep) => void>();
    render(
      <MonitorTemplateSyncFields
        monitorType={MonitorType.Ping}
        value={configuredStep(["requestHeaders"])}
        onChange={onChange}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("template sync summaries", () => {
  test("shows saved protected field labels without showing protected values", () => {
    render(
      <MonitorTemplateSyncFieldsSummary
        monitorType={MonitorType.API}
        monitorSteps={monitorSteps(
          configuredStep(["monitorDestination", "requestHeaders"]),
        )}
      />,
    );
    expect(
      screen.getByText(/Monitor destination, Request headers/),
    ).toBeVisible();
    expect(
      screen.getByText(/New monitors still start with the template's values/),
    ).toBeVisible();
    expect(
      screen.queryByText(
        /monitor.example.test|secret-header|secret-request-body/,
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  test("an unprotected template explicitly says destinations and request settings are copied", () => {
    const summary: string = getMonitorTemplateSyncFieldSummary({
      monitorType: MonitorType.API,
      monitorSteps: monitorSteps(configuredStep()),
    });
    expect(summary).toContain("No fields are protected.");
    expect(summary).toContain("destinations and request options");
  });

  test("identifies the step when different steps protect different fields", () => {
    const summary: string = getMonitorTemplateSyncFieldSummary({
      monitorType: MonitorType.API,
      monitorSteps: monitorSteps(
        configuredStep(["monitorDestination"]),
        configuredStep(["requestHeaders"]),
      ),
    });
    expect(summary).toContain(
      "Step 1: Monitor destination; Step 2: Request headers",
    );
  });

  test("network device bindings are described as always preserved", () => {
    const summary: string = getMonitorTemplateSyncFieldSummary({
      monitorType: MonitorType.NetworkDevice,
      monitorSteps: monitorSteps(configuredStep()),
    });
    expect(summary).toContain("Network device bindings are always preserved.");
    expect(summary).not.toContain("No fields are protected.");
  });
});

describe("template creation after skipping the criteria step", () => {
  function renderCreatePage(): void {
    render(
      <MonitorTemplates
        pageRoute={new Route("/monitor-templates")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
    expect(templateCreateCallback).toBeDefined();
  }

  test("switching to Manual clears prior selections from every outgoing step without mutating form state", async () => {
    renderCreatePage();
    const originalSteps: MonitorSteps = monitorSteps(
      configuredStep(["monitorDestination", "requestHeaders"]),
      configuredStep(["requestBody"]),
    );
    const item: MonitorTemplate = new MonitorTemplate();
    item.monitorType = MonitorType.Manual;
    item.monitorSteps = originalSteps;

    const outgoing: MonitorTemplate = await templateCreateCallback!(item);
    expect(outgoing.monitorSteps).not.toBe(originalSteps);
    expect(outgoing.monitorType).toBe(MonitorType.Manual);
    expect(outgoing.monitorSteps?.data?.monitorStepsInstanceArray).toHaveLength(
      2,
    );
    for (const step of outgoing.monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      expect(step.data?.doNotSyncFields).toEqual([]);
      expect(step.data?.requestBody).toBe("secret-request-body");
    }
    expect(
      originalSteps.data?.monitorStepsInstanceArray[0]?.data?.doNotSyncFields,
    ).toEqual(["monitorDestination", "requestHeaders"]);
    expect(
      originalSteps.data?.monitorStepsInstanceArray[1]?.data?.doNotSyncFields,
    ).toEqual(["requestBody"]);
  });

  test("keeps configured protections when creating an API template", async () => {
    renderCreatePage();
    const item: MonitorTemplate = new MonitorTemplate();
    item.monitorType = MonitorType.API;
    item.monitorSteps = monitorSteps(
      configuredStep(["monitorDestination", "requestHeaders"]),
    );
    const before: unknown = item.monitorSteps.toJSON();

    const outgoing: MonitorTemplate = await templateCreateCallback!(item);
    expect(outgoing.monitorSteps?.toJSON()).toEqual(before);
  });

  test("creating a Manual template without criteria does not invent steps", async () => {
    renderCreatePage();
    const item: MonitorTemplate = new MonitorTemplate();
    item.monitorType = MonitorType.Manual;

    const outgoing: MonitorTemplate = await templateCreateCallback!(item);
    expect(outgoing.monitorSteps).toBeUndefined();
  });
});
