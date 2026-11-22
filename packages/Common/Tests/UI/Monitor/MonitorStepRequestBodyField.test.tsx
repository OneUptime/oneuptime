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
import { MemoryRouter } from "react-router-dom";
import MonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep";
import { getRequestBodyFieldError } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/RequestBodyField";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { REQUEST_BODY_NOT_JSON_MESSAGE } from "../../../Utils/Monitor/MonitorRequestBody";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * THE API MONITOR FORM'S REQUEST BODY FIELD TAKES ANY JSON VALUE (#9737).
 *
 * The field said "Invalid JSON" for anything JSON.parse refused as written:
 * an empty box, a {{monitorSecrets.NAME}} that stands for a number, JSON5
 * the probe reads. It never stopped Save, and it said nothing against an
 * array, which the probe then refused on every check. The field now asks
 * what every reader of a body asks (MonitorRequestBody): no error for no
 * body or for any JSON value, placeholders filled in; the form's sentence
 * for a field that is not JSON, with where, for anything else - and the
 * form refuses to save that (MonitorStep.getValidationError).
 *
 * The real step form is rendered; the code editor is a plain box that
 * hands on what is typed and shows the error the form gives it.
 */

jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      error?: string;
      allowJSON5?: boolean;
      onChange?: (value: string) => void;
      onBlur?: () => void;
    }) => {
      return (
        <div>
          <textarea
            data-testid="request-body-editor"
            data-allow-json5={String(Boolean(props.allowJSON5))}
            defaultValue={props.initialValue || ""}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              props.onChange?.(event.target.value);
            }}
            onBlur={() => {
              props.onBlur?.();
            }}
          />
          {props.error ? (
            <p data-testid="request-body-error">{props.error}</p>
          ) : null}
        </div>
      );
    },
  };
});

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

const ENGLISH: Translator = createTranslator(undefined, "en");

// A new API monitor's step, with its default criteria, and this body.
function apiStep(requestBody?: string): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Batch API",
    monitorType: MonitorType.API,
    onlineMonitorStatusId: new ObjectID("100000000000000000000021"),
    offlineMonitorStatusId: new ObjectID("100000000000000000000022"),
    defaultIncidentSeverityId: new ObjectID("100000000000000000000023"),
    defaultAlertSeverityId: new ObjectID("100000000000000000000024"),
  });

  step.data!.monitorDestination = URL.fromString("https://example.com/batch");
  step.setRequestType(HTTPMethod.POST);

  if (requestBody !== undefined) {
    step.setRequestBody(requestBody);
  }

  return MonitorStep.fromJSON(step.toJSON());
}

// The step form as Create Monitor draws it, keeping each change it makes.
function mountEditor(step: MonitorStep): Array<MonitorStep> {
  const changes: Array<MonitorStep> = [];

  const Harness: () => ReactElement = (): ReactElement => {
    const [current, setCurrent] = useState<MonitorStep>(step);

    return (
      <MemoryRouter>
        <MonitorStepForm
          value={current}
          monitorType={MonitorType.API}
          onChange={(next: MonitorStep) => {
            changes.push(next);
            setCurrent(next);
          }}
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
  };

  render(<Harness />);

  return changes;
}

// The request body's editor, under the target's More fields.
async function requestBodyEditor(): Promise<HTMLTextAreaElement> {
  const moreFields: HTMLElement = await screen.findByRole("button", {
    name: /More fields/,
  });

  if (moreFields.getAttribute("aria-expanded") === "false") {
    fireEvent.click(moreFields);
  }

  return (await screen.findByTestId(
    "request-body-editor",
  )) as HTMLTextAreaElement;
}

// Types a body, leaves the field, and returns the error the field shows.
async function typeBody(
  editor: HTMLTextAreaElement,
  body: string,
): Promise<string | null> {
  fireEvent.change(editor, { target: { value: body } });
  fireEvent.blur(editor);

  return await waitFor(() => {
    return screen.queryByTestId("request-body-error")?.textContent || null;
  });
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

describe("the request body field of an API monitor's form", () => {
  test("judges its editor as the probe reads a body: JSON5 allowed", async () => {
    mountEditor(apiStep("[1]"));

    const editor: HTMLTextAreaElement = await requestBodyEditor();

    expect(editor).toHaveAttribute("data-allow-json5", "true");
    expect(editor).toHaveValue("[1]");
  });

  test.each([
    { name: "an array (the issue's body)", body: '[{"id": 1}, {"id": 2}]' },
    { name: "a single value", body: '"ping"' },
    { name: "a number", body: "42" },
    { name: "an object", body: '{"check": "deep"}' },
    {
      name: "a secret standing for a number",
      body: '{"count": {{monitorSecrets.Count}}}',
    },
    { name: "an emptied box", body: "" },
  ])(
    "says nothing against $name, and keeps it as typed",
    async ({ body }: { name: string; body: string }) => {
      const changes: Array<MonitorStep> = mountEditor(apiStep("[1]"));
      const editor: HTMLTextAreaElement = await requestBodyEditor();

      expect(await typeBody(editor, body)).toBeNull();

      const last: MonitorStep = changes[changes.length - 1]!;

      expect(last.data!.requestBody).toBe(body);
      expect(MonitorStep.getValidationError(last, MonitorType.API)).toBeNull();
    },
  );

  test("says where a body stops being JSON, and the form refuses to save it", async () => {
    const changes: Array<MonitorStep> = mountEditor(apiStep(undefined));
    const editor: HTMLTextAreaElement = await requestBodyEditor();

    const error: string | null = await typeBody(editor, "<ping/>");

    expect(error).toBe(
      "Request Body is not valid JSON. Invalid character '<' (line 1, column 1)",
    );

    const last: MonitorStep = changes[changes.length - 1]!;

    // What was typed is kept, to be corrected; Save is refused.
    expect(last.data!.requestBody).toBe("<ping/>");
    expect(MonitorStep.getValidationError(last, MonitorType.API)).toBe(
      REQUEST_BODY_NOT_JSON_MESSAGE,
    );

    // Corrected, the error goes.
    expect(await typeBody(editor, "[]")).toBeNull();
  });
});

describe("the field's error", () => {
  test("is none for no body or for any JSON value", () => {
    for (const body of ["", "  ", "[1, 2]", "null", "{a: 1,}", "{{x}}"]) {
      expect(getRequestBodyFieldError(body, ENGLISH)).toBeNull();
    }
  });

  test("is the form's sentence for a field that is not JSON, with where", () => {
    expect(getRequestBodyFieldError('[{"id": 1}', ENGLISH)).toBe(
      "Request Body is not valid JSON. Invalid end of input (line 1, column 11)",
    );
  });

  test("is in the reader's language", () => {
    expect(getRequestBodyFieldError("a=1", dashboardTranslator("de"))).toBe(
      "Anfragetext ist kein gültiges JSON. Invalid character 'a' (line 1, column 1)",
    );
  });
});
