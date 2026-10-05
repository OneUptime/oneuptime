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
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
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

function editor(monitorType: MonitorType): ReactElement {
  return (
    <MemoryRouter>
      <MonitorStepForm
        value={new MonitorStep()}
        monitorType={monitorType}
        onChange={() => {}}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
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
});
