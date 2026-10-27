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
import * as React from "react";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A new monitor's criteria step opened on a red "Monitor Destination is
 * required." before anyone had typed a thing. The step's field drew it as
 * soon as it was touched, and the steps form touched it itself: it called
 * onBlur from the effect that hands every change to the form - including the
 * first draw, and the moment the defaults were filled in.
 *
 * It now hands changes over without touching the field. The form shows the
 * step's problem when Next or the form's action is pressed (BasicForm
 * touches every field of the step then: MonitorCreateFlow.test.tsx walks
 * that), and the address field still says what is wrong with an address the
 * moment it is left.
 *
 * And it hands Create Monitor's foldDefaultCriteria on to each step's
 * criteria (MonitorCriteriaFoldDefaults.test.tsx covers the folding).
 */

const stepProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        stepProps.push(props);
        return null;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

import MonitorStepsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ONLINE_STATUS_ID: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE_STATUS_ID: string = "33333333-3333-4333-8333-333333333333";
const INCIDENT_SEVERITY_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555555";

function listOf<T>(data: Array<T>): unknown {
  return { data: data, count: data.length, skip: 0, limit: 50 };
}

function mockModelApi(): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((request: { modelType: unknown }): never => {
      if (request.modelType === MonitorStatus) {
        const online: MonitorStatus = new MonitorStatus();
        online._id = ONLINE_STATUS_ID;
        online.name = "Operational";
        online.isOperationalState = true;

        const offline: MonitorStatus = new MonitorStatus();
        offline._id = OFFLINE_STATUS_ID;
        offline.name = "Offline";
        offline.isOfflineState = true;

        return listOf([online, offline]) as never;
      }

      if (request.modelType === IncidentSeverity) {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = INCIDENT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      if (request.modelType === AlertSeverity) {
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = ALERT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      return listOf([]) as never;
    });
}

interface Mounted {
  onChange: MockFunction;
  onBlur: MockFunction;
}

async function mount(data: {
  initialValue?: MonitorSteps | undefined;
  foldDefaultCriteria?: boolean | undefined;
  error?: string | undefined;
}): Promise<Mounted> {
  const onChange: MockFunction = getJestMockFunction();
  const onBlur: MockFunction = getJestMockFunction();

  render(
    <MonitorStepsElement
      monitorType={MonitorType.Website}
      monitorName="Marketing site"
      {...(data.initialValue ? { initialValue: data.initialValue } : {})}
      foldDefaultCriteria={data.foldDefaultCriteria}
      {...(data.error ? { error: data.error } : {})}
      onChange={(value: MonitorSteps) => {
        onChange(value);
      }}
      onBlur={() => {
        onBlur();
      }}
    />,
  );

  // Drawn once the statuses have loaded; until then it is a loader.
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "More fields" }),
    ).toBeInTheDocument();
  });

  return { onChange, onBlur };
}

function seededSteps(): MonitorSteps {
  return MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Website,
    monitorName: "Marketing site",
    defaultMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    onlineMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
    defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
    defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
  });
}

describe("the monitor steps form, on a new monitor", () => {
  beforeEach(() => {
    stepProps.length = 0;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    mockModelApi();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("hands the defaults it fills in to the form", async () => {
    const { onChange } = await mount({});

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const latest: MonitorSteps = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as MonitorSteps;

    expect(latest.data?.monitorStepsInstanceArray.length).toBe(1);
    expect(latest.data?.defaultMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID,
    );
  });

  /*
   * Touching the field is what drew its error. Nothing the user did has
   * happened yet, so nothing may touch it.
   */
  test("does not touch the field on its first draw or when it fills in the defaults", async () => {
    const { onChange, onBlur } = await mount({});

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onBlur).not.toHaveBeenCalled();
  });

  test("does not touch the field when it opens on steps a link or template brought", async () => {
    const { onChange, onBlur } = await mount({ initialValue: seededSteps() });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onBlur).not.toHaveBeenCalled();
  });

  test("hands Create Monitor's folding of the default criteria to each step", async () => {
    await mount({ foldDefaultCriteria: true });

    await waitFor(() => {
      expect(stepProps.length).toBeGreaterThan(0);
    });

    expect(stepProps[stepProps.length - 1]!["foldDefaultCriteria"]).toBe(true);
  });

  test("leaves every criteria open anywhere else", async () => {
    await mount({});

    await waitFor(() => {
      expect(stepProps.length).toBeGreaterThan(0);
    });

    expect(
      stepProps[stepProps.length - 1]!["foldDefaultCriteria"],
    ).toBeUndefined();
  });

  /*
   * The steps draw the form's message for them under all of the steps, a
   * screen or more below their start. Marked as every field's message is
   * (BringIntoView's FIELD_ERROR_MESSAGE_SELECTOR), so after Next or Create
   * the form brings the message into view, not the steps' start
   * (BasicFormRevealsFirstError.test.tsx).
   */
  test("its error is drawn as a field's message, under the steps", async () => {
    await mount({ error: "Pick at least one browser to run the script in." });

    const message: HTMLElement = screen.getByTestId("error-message");

    expect(message).toHaveTextContent(
      "Pick at least one browser to run the script in.",
    );
    expect(message).toHaveAttribute("role", "alert");
    expect(
      screen
        .getByRole("button", { name: "More fields" })
        .compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("draws no message while the steps are fine", async () => {
    await mount({});

    expect(screen.queryByTestId("error-message")).toBeNull();
  });

  /*
   * The form looks for the message to bring into view in a layout effect,
   * in the render that hands the steps their error. A message copied into
   * state by an effect is drawn a render later, after the form has looked:
   * the form found nothing, and the reader saw no message (14.0.93's gate).
   * So it must be in the page by the first layout effect after the error
   * arrives - a parent's, which runs after the steps have drawn.
   */
  test("its error is in the page in the render that brings it", async () => {
    const seenByLayoutEffect: Array<string | null> = [];

    const Form: React.FunctionComponent<{
      error?: string | undefined;
    }> = (props: { error?: string | undefined }): React.ReactElement => {
      React.useLayoutEffect(() => {
        if (props.error) {
          seenByLayoutEffect.push(
            document.querySelector("[data-testid='error-message']")
              ?.textContent || null,
          );
        }
      }, [props.error]);

      return (
        <MonitorStepsElement
          monitorType={MonitorType.Website}
          monitorName="Marketing site"
          {...(props.error ? { error: props.error } : {})}
          onChange={() => {}}
          onBlur={() => {}}
        />
      );
    };

    const { rerender } = render(<Form />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "More fields" }),
      ).toBeInTheDocument();
    });

    rerender(<Form error="Monitor Destination is required." />);

    expect(seenByLayoutEffect).toHaveLength(1);
    expect(seenByLayoutEffect[0]).toContain("Monitor Destination is required.");
  });
});
