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
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import MonitorStepElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import URL from "../../../Types/API/URL";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import Hostname from "../../../Types/API/Hostname";
import Port from "../../../Types/Port";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div>Rule editor</div>;
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
        return <button type="button">Run check</button>;
      },
    };
  },
);
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: () => {
      return <div>Code editor</div>;
    },
  };
});

function Editor(props: {
  step: MonitorStep;
  monitorType?: MonitorType;
  onChange: (step: MonitorStep) => void;
}): ReactElement {
  const [step, setStep] = useState<MonitorStep>(props.step);
  return (
    <MonitorStepElement
      value={step}
      monitorType={props.monitorType || MonitorType.Website}
      allMonitorSteps={new MonitorSteps()}
      probes={[]}
      monitorStatusDropdownOptions={[]}
      incidentSeverityDropdownOptions={[]}
      alertSeverityDropdownOptions={[]}
      onCallPolicyDropdownOptions={[]}
      labelDropdownOptions={[]}
      teamDropdownOptions={[]}
      userDropdownOptions={[]}
      onChange={(next: MonitorStep) => {
        setStep(next);
        props.onChange(next);
      }}
    />
  );
}

function savedStep(): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(URL.fromString("https://example.com/health"));
  step.setRequestType(HTTPMethod.GET);
  return step;
}

beforeEach(() => {
  jest
    .spyOn(ModelAPI, "getList")
    .mockResolvedValue({ data: [], count: 0, skip: 0, limit: 50 } as never);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Monitor check editor", () => {
  test("clearing or entering an invalid port shows a field error without crashing or retaining the old port", async () => {
    let latest: MonitorStep = savedStep();
    latest.setMonitorDestination(Hostname.fromString("example.com"));
    latest.setPort(new Port(443));
    render(
      <Editor
        step={latest}
        monitorType={MonitorType.Port}
        onChange={(step: MonitorStep) => {
          latest = step;
        }}
      />,
    );
    const port: HTMLElement = await screen.findByRole("spinbutton", {
      name: "Port",
    });
    await waitFor(() => {
      expect(port).toHaveValue(443);
    });
    fireEvent.change(port, { target: { value: "" } });
    expect(latest.data?.monitorDestinationPort).toBeUndefined();
    expect(screen.getByText("Port is required")).toBeVisible();
    fireEvent.change(port, { target: { value: "70000" } });
    expect(latest.data?.monitorDestinationPort).toBeUndefined();
    fireEvent.change(port, { target: { value: "443.5" } });
    expect(latest.data?.monitorDestinationPort).toBeUndefined();
    expect(
      screen.getByText("Enter a whole number from 0 to 65535."),
    ).toBeVisible();
    fireEvent.change(port, { target: { value: "1e3" } });
    expect(latest.data?.monitorDestinationPort?.toNumber()).toBe(1000);
    fireEvent.change(port, { target: { value: "8443" } });
    expect(latest.data?.monitorDestinationPort?.toNumber()).toBe(8443);
    expect(screen.queryByText("Port is required")).not.toBeInTheDocument();
  });

  test("shows essentials while customized settings and the optional test stay collapsed", async () => {
    const step: MonitorStep = savedStep();
    step.setRetryCount(0);
    step.setRequestTimeoutInMs(12000);
    step.setDoNotFollowRedirects(true);
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    render(<Editor step={step} onChange={onChange} />);
    const target: HTMLElement = await screen.findByRole("textbox", {
      name: "Website URL",
    });
    await waitFor(() => {
      expect(target).toHaveValue("https://example.com/health");
    });
    expect(
      screen.getByRole("heading", { name: "What to monitor" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Alert rules" })).toBeVisible();
    expect(screen.getByText("Customized")).toBeVisible();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run check" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Advanced request settings" }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Request timeout (seconds)" }),
    ).toHaveValue(12);
    expect(
      screen.getByRole("spinbutton", { name: "Retries on failure" }),
    ).toHaveValue(0);
    expect(
      screen.getByRole("checkbox", {
        name: "Do not follow redirects",
        exact: true,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Allow self-signed certificates",
        exact: true,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Use client certificate (mTLS)",
        exact: true,
      }),
    ).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try your monitor" }));
    expect(screen.getByRole("button", { name: "Run check" })).toBeVisible();
  });

  test.each(["", "   "])(
    "clearing a saved target (%j) clears the persisted value and fails validation",
    async (emptyValue: string) => {
      let latest: MonitorStep = savedStep();
      render(
        <Editor
          step={latest}
          onChange={(step: MonitorStep) => {
            latest = step;
          }}
        />,
      );
      const target: HTMLElement = await screen.findByRole("textbox", {
        name: "Website URL",
      });
      await waitFor(() => {
        expect(target).toHaveValue("https://example.com/health");
      });
      fireEvent.change(target, { target: { value: emptyValue } });
      fireEvent.blur(target);
      expect(latest.data?.monitorDestination).toBeUndefined();
      expect(
        MonitorStep.getValidationError(latest, MonitorType.Website),
      ).toBeTruthy();
      expect(target).toHaveValue(emptyValue);
      expect(screen.getByText("Destination is required")).toBeVisible();
    },
  );

  test("invalid target edits cannot silently save the previous destination", async () => {
    let latest: MonitorStep = savedStep();
    render(
      <Editor
        step={latest}
        onChange={(step: MonitorStep) => {
          latest = step;
        }}
      />,
    );
    const target: HTMLElement = await screen.findByRole("textbox", {
      name: "Website URL",
    });
    fireEvent.change(target, { target: { value: "https://" } });
    expect(latest.data?.monitorDestination).toBeUndefined();
    fireEvent.change(target, {
      target: { value: "https://invalid host name" },
    });
    expect(latest.data?.monitorDestination).toBeUndefined();
    expect(target).toHaveValue("https://invalid host name");
    fireEvent.blur(target);
    expect(
      screen.queryByText("Destination is required"),
    ).not.toBeInTheDocument();
    fireEvent.change(target, {
      target: { value: "https://example.org/ready" },
    });
    fireEvent.blur(target);
    expect(latest.data?.monitorDestination?.toString()).toBe(
      "https://example.org/ready",
    );
    expect(
      screen.queryByText("Destination is required"),
    ).not.toBeInTheDocument();
  });

  test("a target edit retains saved headers, body, TLS, retry and timeout settings", async () => {
    let latest: MonitorStep = savedStep();
    latest.setRequestType(HTTPMethod.POST);
    latest.setRequestHeaders({
      "Content-Type": "application/json",
      Authorization: "{{monitorSecrets.token}}",
    });
    latest.setRequestBody('{"ready":true}');
    latest.setTlsClientCertificate("{{monitorSecrets.certificate}}");
    latest.setTlsClientKey("{{monitorSecrets.key}}");
    latest.setTlsClientKeyPassphrase("{{monitorSecrets.passphrase}}");
    latest.setAllowSelfSignedCertificates(true);
    latest.setRetryCount(0);
    latest.setRequestTimeoutInMs(17000);
    const original: MonitorStep = MonitorStep.clone(latest);
    render(
      <Editor
        step={latest}
        monitorType={MonitorType.API}
        onChange={(step: MonitorStep) => {
          latest = step;
        }}
      />,
    );
    fireEvent.change(await screen.findByRole("textbox", { name: "API URL" }), {
      target: { value: "https://example.org/updated" },
    });
    original.setMonitorDestination(
      URL.fromString("https://example.org/updated"),
    );
    expect(latest.toJSON()).toEqual(original.toJSON());
    expect(
      screen.getByRole("combobox", { name: "Request method" }),
    ).toBeVisible();
  });

  test("timeout and retry edits survive closing the section and use supported bounds", async () => {
    let latest: MonitorStep = savedStep();
    render(
      <Editor
        step={latest}
        onChange={(step: MonitorStep) => {
          latest = step;
        }}
      />,
    );
    await screen.findByRole("textbox", { name: "Website URL" });
    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Advanced request settings",
    });
    fireEvent.click(toggle);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Request timeout (seconds)" }),
      { target: { value: "90" } },
    );
    expect(latest.data?.requestTimeoutInMs).toBe(60000);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Retries on failure" }),
      { target: { value: "-1" } },
    );
    expect(latest.data?.retryCount).toBe(0);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Request timeout (seconds)" }),
      { target: { value: "21" } },
    );
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(
      screen.getByRole("spinbutton", { name: "Request timeout (seconds)" }),
    ).toHaveValue(21);
    expect(
      screen.getByRole("spinbutton", { name: "Retries on failure" }),
    ).toHaveValue(0);
  });
});
