import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep";
import { getMonitorDestinationFieldCopy } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorDestinationFieldCopy";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The address field a new probe check's criteria step opens on, as the real
 * MonitorStep form draws it: a name, one line of help with an example, and
 * the example inside the empty box (MonitorDestinationFieldCopy). The help
 * used to ask "Whats the URL of the website you want to monitor?", a Port
 * monitor's said it would ping the host, and an SSL Certificate monitor's
 * field was a bare "URL" with no help at all.
 *
 * The same mocks as MonitorStepRetrySettings.test.tsx: the criteria, the test
 * button and the other monitor types' editors need not load.
 */

/*
 * Keep the real form, inputs and details renderer; unrelated criteria and
 * live previews do not need to fetch or render to exercise retry editing.
 */
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

/*
 * These type-specific editors are never rendered by the probe monitor types
 * below. Avoid loading their telemetry explorers and code editor in this suite.
 */
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/OpenStackMonitor/OpenStackMonitorStepForm",
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
const DESTINATION_TYPES: Array<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.SSLCertificate,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
];

function editor(
  monitorType: MonitorType,
  options: { value?: MonitorStep; isAddressAskedFirst?: boolean } = {},
): ReactElement {
  return (
    <MemoryRouter>
      <MonitorStepForm
        value={options.value || new MonitorStep()}
        monitorType={monitorType}
        isAddressAskedFirst={options.isAddressAskedFirst}
        onChange={() => {}}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        userDropdownOptions={[]}
        allMonitorSteps={new MonitorSteps()}
        probes={[]}
      />
    </MemoryRouter>
  );
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

describe("the address field of a new probe check", () => {
  test.each(DESTINATION_TYPES)(
    "%s: named, with one line of help and the example in the empty box",
    async (monitorType: MonitorType) => {
      const copy: ReturnType<typeof getMonitorDestinationFieldCopy> =
        getMonitorDestinationFieldCopy(monitorType);

      render(editor(monitorType));

      const label: HTMLElement = await screen.findByText(copy!.title, {
        selector: "label, label *, span, p, div",
      });

      expect(label).toBeInTheDocument();
      expect(screen.getByText(copy!.description)).toBeInTheDocument();

      const input: HTMLElement = await waitFor((): HTMLElement => {
        return screen.getByPlaceholderText(copy!.placeholder);
      });

      expect(input).toHaveValue("");
      expect(screen.queryByText(/whats/i)).not.toBeInTheDocument();
    },
  );

  test("a Port monitor's port field says what to type, with 443 in the box", async () => {
    render(editor(MonitorType.Port));

    expect(
      await screen.findByText("The TCP or UDP port to check, like 443."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("443")).toBeInTheDocument();
    expect(
      screen.queryByText(/ping/i, { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  test("an SSL Certificate monitor's field is a Website URL with help, no bare URL", async () => {
    render(editor(MonitorType.SSLCertificate));

    expect(await screen.findByText("Website URL")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The site whose certificate to check, like https://example.com.",
      ),
    ).toBeInTheDocument();
  });

  test("the criteria card says what criteria are, and how they are checked", async () => {
    render(editor(MonitorType.Website));

    expect(
      await screen.findByText(
        "When this monitor changes status, declares an incident or creates an alert. They are checked from top to bottom, and the first one that matches decides.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Add Monitoring Criteria for this monitor. Monitor different properties.",
      ),
    ).not.toBeInTheDocument();
  });

  /*
   * The box used to have no name: its label was drawn beside it but pointed
   * at nothing, so a screen reader read "edit text", and the journey budgets
   * (packages/E2E/Journeys) could not find "Website URL" by its label.
   */
  test.each(DESTINATION_TYPES)(
    "%s: the box is named by its label and described by its help",
    async (monitorType: MonitorType) => {
      const copy: ReturnType<typeof getMonitorDestinationFieldCopy> =
        getMonitorDestinationFieldCopy(monitorType);

      render(editor(monitorType));

      const input: HTMLElement = await screen.findByLabelText(copy!.title, {
        exact: false,
      });

      expect(input).toBe(screen.getByPlaceholderText(copy!.placeholder));
      expect(input).toHaveAccessibleDescription(copy!.description);
    },
  );
});

/*
 * #7463: Create Monitor asks the address with the type, on What to Monitor.
 * Its Criteria step's Monitor Target then says what the step checks, and
 * keeps only the type's other settings: no second box for the address, and
 * no second Port box.
 */
describe("Monitor Target, when the address was asked with the type", () => {
  function stepWith(data: {
    destination: URL | IP | Hostname;
    port?: Port;
  }): MonitorStep {
    const step: MonitorStep = new MonitorStep();
    step.setMonitorDestination(data.destination);

    if (data.port) {
      step.setPort(data.port);
    }

    return step;
  }

  function target(): HTMLElement {
    return screen.getByTestId("monitor-target-address");
  }

  test.each([
    [
      MonitorType.Website,
      URL.fromString("https://example.com/shop"),
      "https://example.com/shop",
    ],
    [
      MonitorType.API,
      URL.fromString("https://api.example.com/health"),
      "https://api.example.com/health",
    ],
    // A bare host's URL, as it was typed: no slash before the full stop.
    [
      MonitorType.SSLCertificate,
      URL.fromString("https://example.com"),
      "https://example.com",
    ],
    [
      MonitorType.Ping,
      Hostname.fromString("router.example.com"),
      "router.example.com",
    ],
    [MonitorType.IP, IP.fromString("192.168.1.1"), "192.168.1.1"],
    [
      MonitorType.NTP,
      Hostname.fromString("time.example.com"),
      "time.example.com",
    ],
  ] as Array<[MonitorType, URL | IP | Hostname, string]>)(
    "%s says what it checks, and asks no address again",
    async (
      monitorType: MonitorType,
      destination: URL | IP | Hostname,
      shown: string,
    ) => {
      const copy: ReturnType<typeof getMonitorDestinationFieldCopy> =
        getMonitorDestinationFieldCopy(monitorType);

      render(
        editor(monitorType, {
          value: stepWith({ destination }),
          isAddressAskedFirst: true,
        }),
      );

      await screen.findByText("Monitor Target");

      expect(target()).toHaveTextContent(`Checks ${shown}.`, {
        normalizeWhitespace: true,
      });
      // An address reads left to right, on a right-to-left page too.
      expect(target().querySelector("[dir='ltr']")).toHaveTextContent(shown);
      expect(
        screen.queryByPlaceholderText(copy!.placeholder),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(copy!.description)).not.toBeInTheDocument();
      // The fold under the address went with it, to What to Monitor.
      expect(
        screen.queryByText("Bypass caches on every check"),
      ).not.toBeInTheDocument();
    },
  );

  test("a Port monitor says its host and port, and asks neither again", async () => {
    render(
      editor(MonitorType.Port, {
        value: stepWith({
          destination: Hostname.fromString("db.example.com"),
          port: new Port(5432),
        }),
        isAddressAskedFirst: true,
      }),
    );

    await screen.findByText("Monitor Target");

    expect(target()).toHaveTextContent("Checks db.example.com:5432.");
    expect(screen.queryByPlaceholderText("443")).not.toBeInTheDocument();
    expect(
      screen.queryByText("The TCP or UDP port to check, like 443."),
    ).not.toBeInTheDocument();
  });

  test("an API keeps its request type, and More fields keep the rest", async () => {
    render(
      editor(MonitorType.API, {
        value: stepWith({
          destination: URL.fromString("https://api.example.com/health"),
        }),
        isAddressAskedFirst: true,
      }),
    );

    await screen.findByText("Monitor Target");

    expect(screen.getByText("API Request Type")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("monitor-step-more-fields").length,
    ).toBeGreaterThan(0);
  });

  test("a saved monitor's Criteria page still asks the address in the box", async () => {
    render(
      editor(MonitorType.Website, {
        value: stepWith({ destination: URL.fromString("https://example.com") }),
      }),
    );

    expect(
      await screen.findByPlaceholderText("https://example.com"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("monitor-target-address"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Bypass caches on every check"),
    ).toBeInTheDocument();
  });
});
