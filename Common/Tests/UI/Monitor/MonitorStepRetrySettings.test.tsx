import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep";
import MonitorStepView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStep";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

// Keep the real form, inputs and details renderer; unrelated criteria and
// live previews do not need to fetch or render to exercise retry editing.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTest",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteria",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// These type-specific editors are never rendered by the probe monitor types
// below. Avoid loading their telemetry explorers and code editor in this suite.
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/NetworkDeviceMonitor/NetworkDeviceMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DnsMonitor/DnsMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SqlMonitor/SqlMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DomainMonitor/DomainMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DnssecMonitor/DnssecMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
const RETRY_LABEL: string = "Retries on Failure";
const DEFAULT_LABEL: string = "Probe default (usually 3)";
const MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.API,
  MonitorType.Website,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
  MonitorType.SSLCertificate,
];

function apiStep(retryCount?: number | null): MonitorStep {
  const value: JSONObject = {
    id: "11111111-1111-4111-8111-111111111111",
    monitorDestination: URL.fromString("https://example.com/health").toJSON(),
    requestType: HTTPMethod.GET,
    monitorCriteria: new MonitorCriteria().toJSON(),
  };

  if (retryCount !== undefined) {
    value["retryCount"] = retryCount;
  }

  return MonitorStep.fromJSON({ _type: "MonitorStep", value });
}

function editor(data: {
  step: MonitorStep;
  monitorType: MonitorType;
  onChange: (step: MonitorStep) => void;
}): ReactElement {
  return (
    <MemoryRouter>
      <MonitorStepForm
        value={data.step}
        monitorType={data.monitorType}
        onChange={data.onChange}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        teamDropdownOptions={[]}
        userDropdownOptions={[]}
        allMonitorSteps={new MonitorSteps()}
        probes={[]}
      />
    </MemoryRouter>
  );
}

function renderView(monitorType: MonitorType, step: MonitorStep): void {
  render(
    <MemoryRouter>
      <MonitorStepView
        monitorType={monitorType}
        monitorStep={step}
        monitorStatusOptions={[]}
        incidentSeverityOptions={[]}
        alertSeverityOptions={[]}
        onCallPolicyOptions={[]}
        labelOptions={[]}
        teamOptions={[]}
        userOptions={[]}
        incidentRoleOptions={[]}
      />
    </MemoryRouter>,
  );
}

async function retryInput(expectedValue?: number): Promise<HTMLInputElement> {
  const advanced: HTMLElement = await screen.findByRole("button", {
    name: "Advanced Options",
  });

  if (advanced.getAttribute("aria-expanded") === "false") {
    fireEvent.click(advanced);
  }

  // Input applies its value through an effect after the form finishes loading.
  // Read the current control after that update before inspecting or editing it.
  return waitFor(() => {
    const input: HTMLInputElement = screen.getByRole<HTMLInputElement>(
      "spinbutton",
      {
        name: RETRY_LABEL,
      },
    );
    expect(input).toHaveValue(expectedValue ?? null);
    return input;
  });
}

function mountEditor(data: {
  step: MonitorStep;
  monitorType: MonitorType;
}): Array<MonitorStep> {
  const changes: Array<MonitorStep> = [];

  const Harness: () => ReactElement = (): ReactElement => {
    const [step, setStep] = useState<MonitorStep>(data.step);

    return editor({
      step,
      monitorType: data.monitorType,
      onChange: (nextStep: MonitorStep) => {
        changes.push(nextStep);
        setStep(nextStep);
      },
    });
  };

  render(<Harness />);
  return changes;
}

function lastChange(changes: Array<MonitorStep>): MonitorStep {
  expect(changes.length).toBeGreaterThan(0);
  return changes[changes.length - 1]!;
}

beforeEach(() => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("99999999-9999-4999-8999-999999999999"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(MONITOR_TYPES)(
  "%s retry settings",
  (monitorType: MonitorType) => {
    test.each([undefined, null])(
      "shows inherited retries on the criteria page for API retryCount=%s",
      (retryCount: undefined | null) => {
        renderView(monitorType, apiStep(retryCount));

        const details: HTMLElement = screen.getByTestId("monitor-step-details");
        expect(within(details).getByText("Retry Count")).toBeInTheDocument();
        expect(within(details).getByText(DEFAULT_LABEL)).toBeInTheDocument();
        expect(within(details).queryByText("3")).not.toBeInTheDocument();
      },
    );

    test.each([undefined, null])(
      "leaves the editor blank for API retryCount=%s without creating an override",
      async (retryCount: undefined | null) => {
        const originalStep: MonitorStep = apiStep(retryCount);
        const changes: Array<MonitorStep> = mountEditor({
          step: originalStep,
          monitorType,
        });
        const input: HTMLInputElement = await retryInput();

        expect(input).toHaveValue(null);
        expect(input).toHaveAttribute("placeholder", DEFAULT_LABEL);
        expect(originalStep.data?.retryCount).toBeUndefined();
        expect(
          changes.every((step: MonitorStep) => {
            return step.data?.retryCount === undefined;
          }),
        ).toBe(true);
      },
    );

    test.each([0, 1, 2, 3])(
      "shows an explicit %s consistently when viewing and editing",
      async (retryCount: number) => {
        const step: MonitorStep = apiStep(retryCount);
        renderView(monitorType, step);
        const details: HTMLElement = screen.getByTestId("monitor-step-details");
        expect(
          within(details).getByText(String(retryCount)),
        ).toBeInTheDocument();
        expect(
          within(details).queryByText(DEFAULT_LABEL),
        ).not.toBeInTheDocument();
        cleanup();

        mountEditor({ step, monitorType });
        expect(await retryInput(retryCount)).toHaveValue(retryCount);
      },
    );

    test.each([0, 2, 3])(
      "saves an explicit %s and shows it after an API round trip",
      async (retryCount: number) => {
        const changes: Array<MonitorStep> = mountEditor({
          step: apiStep(),
          monitorType,
        });
        fireEvent.change(await retryInput(), {
          target: { value: String(retryCount) },
        });

        const saved: MonitorStep = MonitorStep.fromJSON(
          JSON.parse(
            JSON.stringify(lastChange(changes).toJSON()),
          ) as JSONObject,
        );
        expect(saved.data?.retryCount).toBe(retryCount);
        cleanup();
        renderView(monitorType, saved);
        expect(
          within(screen.getByTestId("monitor-step-details")).getByText(
            String(retryCount),
          ),
        ).toBeInTheDocument();
      },
    );

    test("clears a saved override and keeps inheritance after saving", async () => {
      const changes: Array<MonitorStep> = mountEditor({
        step: apiStep(2),
        monitorType,
      });
      const input: HTMLInputElement = await retryInput(2);
      fireEvent.change(input, { target: { value: "" } });

      expect(input).toHaveValue(null);
      const saved: MonitorStep = MonitorStep.fromJSON(
        JSON.parse(JSON.stringify(lastChange(changes).toJSON())) as JSONObject,
      );
      expect(saved.data?.retryCount).toBeUndefined();
      cleanup();
      renderView(monitorType, saved);
      expect(screen.getByText(DEFAULT_LABEL)).toBeInTheDocument();
    });
  },
);

describe("retry editor parent updates", () => {
  test.each([0, 2])(
    "clears a displayed %s when the parent replaces it with inherited settings",
    async (retryCount: number) => {
      const props: {
        step: MonitorStep;
        monitorType: MonitorType;
        onChange: (step: MonitorStep) => void;
      } = {
        step: apiStep(retryCount),
        monitorType: MonitorType.API,
        onChange: jest.fn(),
      };
      const mounted: ReturnType<typeof render> = render(editor(props));
      const input: HTMLInputElement = await retryInput(retryCount);
      expect(input).toHaveValue(retryCount);

      mounted.rerender(editor({ ...props, step: apiStep() }));
      await waitFor(() => {
        expect(
          screen.getByRole("spinbutton", { name: RETRY_LABEL }),
        ).toHaveValue(null);
      });
      expect(
        screen.getByRole("spinbutton", { name: RETRY_LABEL }),
      ).toHaveAttribute("placeholder", DEFAULT_LABEL);
    },
  );

  test("changing an unrelated API setting does not silently set three retries", async () => {
    const changes: Array<MonitorStep> = mountEditor({
      step: apiStep(),
      monitorType: MonitorType.API,
    });
    const input: HTMLInputElement = await retryInput();
    const timeout: HTMLElement = screen.getByPlaceholderText("60");
    fireEvent.change(timeout, { target: { value: "12" } });

    expect(lastChange(changes).data?.requestTimeoutInMs).toBe(12000);
    expect(lastChange(changes).data?.retryCount).toBeUndefined();
    expect(input).toHaveValue(null);
    const saved: MonitorStep = MonitorStep.fromJSON(
      JSON.parse(JSON.stringify(lastChange(changes).toJSON())) as JSONObject,
    );
    expect(saved.data?.retryCount).toBeUndefined();
    cleanup();
    renderView(MonitorType.API, saved);
    expect(screen.getByText(DEFAULT_LABEL)).toBeInTheDocument();
  });
});
