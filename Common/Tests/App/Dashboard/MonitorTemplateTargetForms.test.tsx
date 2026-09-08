import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import MonitorStepElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep";
import MonitorTargetFieldLabel, {
  MonitorTemplateContext,
  TEMPLATE_TARGET_FIELD_DESCRIPTION,
  NETWORK_DEVICE_TEMPLATE_TARGET_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTemplateContext";
import DnsMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DnsMonitor/DnsMonitorStepForm";
import DnssecMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DnssecMonitor/DnssecMonitorStepForm";
import DomainMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DomainMonitor/DomainMonitorStepForm";
import ExternalStatusPageMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorStepForm";
import SqlMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SqlMonitor/SqlMonitorStepForm";
import DatabaseMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm";
import MonitorStepSqlMonitor, {
  MonitorStepSqlMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSqlMonitor";
import MonitorStepDatabaseMonitor, {
  MonitorStepDatabaseMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDatabaseMonitor";
import { MonitorStepDnsMonitorUtil } from "../../../Types/Monitor/MonitorStepDnsMonitor";
import { MonitorStepDnssecMonitorUtil } from "../../../Types/Monitor/MonitorStepDnssecMonitor";
import { MonitorStepDomainMonitorUtil } from "../../../Types/Monitor/MonitorStepDomainMonitor";
import { MonitorStepExternalStatusPageMonitorUtil } from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import Hostname from "../../../Types/API/Hostname";
import Port from "../../../Types/Port";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

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

function renderInContext(
  element: ReactElement,
  isMonitorTemplate: boolean,
): void {
  render(
    <MonitorTemplateContext.Provider value={isMonitorTemplate}>
      {element}
    </MonitorTemplateContext.Provider>,
  );
}
function expectOptional(title: string, optional: boolean): void {
  const label: HTMLLabelElement | null = screen
    .getByText(title, { exact: false, selector: "label > span" })
    .closest("label");
  expect(label).not.toBeNull();
  if (optional) {
    expect(label).toHaveTextContent("(Optional)");
  } else {
    expect(label).not.toHaveTextContent("(Optional)");
  }
}
beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  jest
    .spyOn(ModelAPI, "getList")
    .mockResolvedValue({ data: [], count: 0, skip: 0, limit: 50 } as never);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("template target labels", () => {
  test.each([true, false])(
    "required fields inherit template context %s",
    (isMonitorTemplate: boolean) => {
      renderInContext(
        <MonitorTargetFieldLabel
          title="Host"
          description="Select a host."
          required={true}
        />,
        isMonitorTemplate,
      );
      expectOptional("Host", isMonitorTemplate);
      expect(
        screen.queryByText(TEMPLATE_TARGET_FIELD_DESCRIPTION) !== null,
      ).toBe(isMonitorTemplate);
      expect(screen.getByText("Select a host.")).toBeInTheDocument();
    },
  );
  test("network devices explain their existing binding behavior", () => {
    renderInContext(
      <MonitorTargetFieldLabel
        title="Network Device"
        required={true}
        preserveOnSync={true}
      />,
      true,
    );
    expectOptional("Network Device", true);
    expect(
      screen.getByText(NETWORK_DEVICE_TEMPLATE_TARGET_DESCRIPTION),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(TEMPLATE_TARGET_FIELD_DESCRIPTION),
    ).not.toBeInTheDocument();
  });
  const forms: Array<[string, () => ReactElement, string, string | undefined]> =
    [
      [
        "DNS",
        () => {
          return (
            <DnsMonitorStepForm
              monitorStepDnsMonitor={MonitorStepDnsMonitorUtil.getDefault()}
              onChange={() => {
                return;
              }}
            />
          );
        },
        "Domain Name",
        "Record Type",
      ],
      [
        "DNSSEC",
        () => {
          return (
            <DnssecMonitorStepForm
              monitorStepDnssecMonitor={MonitorStepDnssecMonitorUtil.getDefault()}
              onChange={() => {
                return;
              }}
            />
          );
        },
        "Zone (Domain Name)",
        "Resolvers",
      ],
      [
        "Domain",
        () => {
          return (
            <DomainMonitorStepForm
              monitorStepDomainMonitor={MonitorStepDomainMonitorUtil.getDefault()}
              onChange={() => {
                return;
              }}
            />
          );
        },
        "Domain Name",
        "Lookup Method",
      ],
      [
        "External status page",
        () => {
          return (
            <ExternalStatusPageMonitorStepForm
              monitorStepExternalStatusPageMonitor={MonitorStepExternalStatusPageMonitorUtil.getDefault()}
              onChange={() => {
                return;
              }}
            />
          );
        },
        "Status Page URL",
        undefined,
      ],
      [
        "SQL query",
        () => {
          return (
            <SqlMonitorStepForm
              monitorStepSqlMonitor={MonitorStepSqlMonitorUtil.getDefault()}
              onChange={() => {
                return;
              }}
            />
          );
        },
        "Host",
        "SQL Query",
      ],
      [
        "Database",
        () => {
          return (
            <DatabaseMonitorStepForm
              monitorStepDatabaseMonitor={MonitorStepDatabaseMonitorUtil.getDefault()}
              onChange={() => {
                return;
              }}
            />
          );
        },
        "Host",
        "Database Type",
      ],
    ];
  test.each(forms)(
    "%s makes its target optional without changing check settings",
    (
      _name: string,
      form: () => ReactElement,
      target: string,
      setting: string | undefined,
    ) => {
      renderInContext(form(), true);
      expectOptional(target, true);
      if (setting) {
        expectOptional(setting, false);
      }
    },
  );
  test.each(forms)(
    "%s still requires its target on ordinary monitors",
    (_name: string, form: () => ReactElement, target: string) => {
      renderInContext(form(), false);
      expectOptional(target, false);
    },
  );
});

describe("clearing destination inputs", () => {
  const monitorTypes: Array<[MonitorType, string, URL | IP | Hostname]> = [
    [
      MonitorType.Website,
      "Website URL",
      URL.fromString("https://website.example.com"),
    ],
    [MonitorType.API, "API URL", URL.fromString("https://api.example.com")],
    [
      MonitorType.SSLCertificate,
      "Certificate URL",
      URL.fromString("https://tls.example.com"),
    ],
    [MonitorType.IP, "IP Address", IP.fromString("192.0.2.10")],
    [
      MonitorType.Ping,
      "Ping Hostname or IP address",
      Hostname.fromString("ping.example.com"),
    ],
    [
      MonitorType.Port,
      "Hostname or IP address",
      Hostname.fromString("port.example.com"),
    ],
  ];
  function renderStep(
    monitorType: MonitorType,
    destination: URL | IP | Hostname,
    isMonitorTemplate: boolean,
  ): ReturnType<typeof jest.fn<(value: MonitorStep) => void>> {
    const step: MonitorStep = new MonitorStep()
      .setMonitorDestination(destination)
      .setPort(new Port(443));
    const onChange: ReturnType<typeof jest.fn<(value: MonitorStep) => void>> =
      jest.fn<(value: MonitorStep) => void>();
    renderInContext(
      <MonitorStepElement
        monitorType={monitorType}
        isMonitorTemplate={isMonitorTemplate}
        value={step}
        allMonitorSteps={new MonitorSteps()}
        onChange={onChange}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        teamDropdownOptions={[]}
        userDropdownOptions={[]}
        probes={[]}
      />,
      isMonitorTemplate,
    );
    return onChange;
  }
  test.each(monitorTypes)(
    "%s clears a stored template target instead of silently restoring it",
    async (
      monitorType: MonitorType,
      title: string,
      destination: URL | IP | Hostname,
    ) => {
      const onChange: ReturnType<typeof renderStep> = renderStep(
        monitorType,
        destination,
        true,
      );
      const input: HTMLElement = await screen.findByDisplayValue(
        destination.toString(),
      );
      expectOptional(title, true);
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(
        onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].data
          ?.monitorDestination,
      ).toBeUndefined();
      expect(input).toHaveValue("");
      expect(
        screen.queryByText("Destination is required"),
      ).not.toBeInTheDocument();
    },
  );
  test.each(monitorTypes)(
    "%s still reports a missing ordinary monitor target",
    async (
      monitorType: MonitorType,
      title: string,
      destination: URL | IP | Hostname,
    ) => {
      renderStep(monitorType, destination, false);
      const input: HTMLElement = await screen.findByDisplayValue(
        destination.toString(),
      );
      expectOptional(title, false);
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(screen.getByText("Destination is required")).toBeInTheDocument();
    },
  );
  test.each([MonitorType.SQLQuery, MonitorType.Database])(
    "%s fallback configuration starts with a blank template port",
    async (monitorType: MonitorType) => {
      const onChange: ReturnType<typeof renderStep> = renderStep(
        monitorType,
        Hostname.fromString("placeholder.example.com"),
        true,
      );
      expect(await screen.findByPlaceholderText("5432")).toHaveValue(null);
      fireEvent.change(screen.getByPlaceholderText("db.internal"), {
        target: { value: "database.example.com" },
      });
      const value: MonitorStep | undefined =
        onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
      const config:
        | MonitorStepSqlMonitor
        | MonitorStepDatabaseMonitor
        | undefined =
        monitorType === MonitorType.SQLQuery
          ? value?.data?.sqlMonitor
          : value?.data?.databaseMonitor;
      expect(config?.host).toBe("database.example.com");
      expect(config?.port).toBeUndefined();
    },
  );

  test("a port template can omit its port independently of its host", async () => {
    const destination: Hostname = Hostname.fromString("port.example.com");
    const onChange: ReturnType<typeof renderStep> = renderStep(
      MonitorType.Port,
      destination,
      true,
    );
    fireEvent.change(await screen.findByDisplayValue("443"), {
      target: { value: "" },
    });
    const value: MonitorStep | undefined =
      onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(value?.data?.monitorDestinationPort).toBeUndefined();
    expect(value?.data?.monitorDestination?.toString()).toBe(
      destination.toString(),
    );
  });
});

describe("database port omission", () => {
  test.each(["SQL query", "Database"])(
    "%s templates can clear a port and reopen without inserting a default",
    (kind: string) => {
      const sql: MonitorStepSqlMonitor = MonitorStepSqlMonitorUtil.getDefault();
      const database: MonitorStepDatabaseMonitor =
        MonitorStepDatabaseMonitorUtil.getDefault();
      const onSqlChange: ReturnType<
        typeof jest.fn<(value: MonitorStepSqlMonitor) => void>
      > = jest.fn<(value: MonitorStepSqlMonitor) => void>();
      const onDatabaseChange: ReturnType<
        typeof jest.fn<(value: MonitorStepDatabaseMonitor) => void>
      > = jest.fn<(value: MonitorStepDatabaseMonitor) => void>();
      renderInContext(
        kind === "SQL query" ? (
          <SqlMonitorStepForm
            monitorStepSqlMonitor={sql}
            onChange={onSqlChange}
          />
        ) : (
          <DatabaseMonitorStepForm
            monitorStepDatabaseMonitor={database}
            onChange={onDatabaseChange}
          />
        ),
        true,
      );
      fireEvent.change(screen.getByDisplayValue("5432"), {
        target: { value: "" },
      });
      const updated:
        | MonitorStepSqlMonitor
        | MonitorStepDatabaseMonitor
        | undefined =
        kind === "SQL query"
          ? onSqlChange.mock.calls[0]?.[0]
          : onDatabaseChange.mock.calls[0]?.[0];
      expect(updated).not.toHaveProperty("port");
      cleanup();
      renderInContext(
        kind === "SQL query" ? (
          <SqlMonitorStepForm
            monitorStepSqlMonitor={updated as MonitorStepSqlMonitor}
            onChange={onSqlChange}
          />
        ) : (
          <DatabaseMonitorStepForm
            monitorStepDatabaseMonitor={updated as MonitorStepDatabaseMonitor}
            onChange={onDatabaseChange}
          />
        ),
        true,
      );
      expect(screen.getByPlaceholderText("5432")).toHaveValue(null);
    },
  );
});

describe("creating database monitors from targetless templates", () => {
  const scenarios: Array<
    [string, SqlDatabaseType, string | null | undefined, number]
  > = [
    ["SQL query", SqlDatabaseType.PostgreSQL, undefined, 5432],
    ["SQL query", SqlDatabaseType.MySQL, undefined, 3306],
    ["SQL query", SqlDatabaseType.MicrosoftSqlServer, undefined, 1433],
    ["Database", SqlDatabaseType.PostgreSQL, undefined, 5432],
    ["Database", SqlDatabaseType.MySQL, undefined, 3306],
    ["Database", SqlDatabaseType.MicrosoftSqlServer, undefined, 1433],
    ["Database", SqlDatabaseType.MySQL, null, 3306],
    ["Database", SqlDatabaseType.MicrosoftSqlServer, "", 1433],
  ];

  test.each(scenarios)(
    "%s with %s replaces blank port %p with default %i",
    (
      kind: string,
      databaseType: SqlDatabaseType,
      storedPort: string | null | undefined,
      expectedPort: number,
    ) => {
      const changes: Array<MonitorStepSqlMonitor | MonitorStepDatabaseMonitor> =
        [];

      const Form: React.FunctionComponent = (): ReactElement => {
        const [config, setConfig] = React.useState<
          MonitorStepSqlMonitor | MonitorStepDatabaseMonitor
        >(() => {
          const initial: MonitorStepSqlMonitor | MonitorStepDatabaseMonitor =
            kind === "SQL query"
              ? MonitorStepSqlMonitorUtil.getDefault()
              : MonitorStepDatabaseMonitorUtil.getDefault();
          initial.databaseType = databaseType;
          initial.host = "original.example.com";
          initial.databaseName = "orders";
          initial.username = "monitor_user";
          // API-authored templates may encode an omitted target as null or "".
          const step: MonitorStep = new MonitorStep();
          if (kind === "SQL query") {
            step.setSqlMonitor(initial as MonitorStepSqlMonitor);
          } else {
            step.setDatabaseMonitor(initial as MonitorStepDatabaseMonitor);
          }
          Object.assign(initial, { port: storedPort });
          const restored: MonitorStep = MonitorStep.clone(step);
          return kind === "SQL query"
            ? restored.data!.sqlMonitor!
            : restored.data!.databaseMonitor!;
        });
        const onChange: (
          value: MonitorStepSqlMonitor | MonitorStepDatabaseMonitor,
        ) => void = (
          value: MonitorStepSqlMonitor | MonitorStepDatabaseMonitor,
        ): void => {
          changes.push(value);
          setConfig(value);
        };
        return kind === "SQL query" ? (
          <SqlMonitorStepForm
            monitorStepSqlMonitor={config as MonitorStepSqlMonitor}
            onChange={onChange}
          />
        ) : (
          <DatabaseMonitorStepForm
            monitorStepDatabaseMonitor={config as MonitorStepDatabaseMonitor}
            onChange={onChange}
          />
        );
      };

      renderInContext(<Form />, false);
      expect(
        screen.getByDisplayValue(expectedPort.toString()),
      ).toBeInTheDocument();
      expect(changes[changes.length - 1]?.port).toBe(expectedPort);
      fireEvent.change(screen.getByPlaceholderText("db.internal"), {
        target: { value: "updated.example.com" },
      });
      expect(changes[changes.length - 1]).toMatchObject({
        port: expectedPort,
        host: "updated.example.com",
        databaseName: "orders",
        username: "monitor_user",
      });
    },
  );
});
