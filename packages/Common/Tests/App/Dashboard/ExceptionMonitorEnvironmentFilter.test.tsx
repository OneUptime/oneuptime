/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";

/*
 * Exceptions monitors can be scoped to deployment environments (GitHub issue
 * 4014). The form writes a comma-separated list to `environments`, and the
 * preview under the form must show the same slice the worker will count, so
 * both what the form emits and what reaches the preview table are pinned
 * here. The table itself lists occurrences over the API, so it is stubbed to
 * record the query it is given.
 */

let previewQueries: Array<JSONObject> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable",
  () => {
    return {
      __esModule: true,
      default: (props: { query: JSONObject }): ReactElement => {
        previewQueries.push(props.query);
        return <div data-testid="exceptions-preview" />;
      },
    };
  },
);

// The resolved/archived fingerprint lookup the preview runs on mount.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import ExceptionMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";

interface Recorder {
  latest: MonitorStepExceptionMonitor | null;
}

/*
 * Mirrors MonitorStep.tsx: every change is stored and handed back to the
 * form as a new object, which is what re-runs the form's own sync effect.
 */
const Harness: React.FunctionComponent<{
  recorder: Recorder;
  initial: MonitorStepExceptionMonitor;
}> = (props: {
  recorder: Recorder;
  initial: MonitorStepExceptionMonitor;
}): ReactElement => {
  const [exceptionMonitor, setExceptionMonitor] =
    React.useState<MonitorStepExceptionMonitor>(props.initial);

  return (
    <ExceptionMonitorStepForm
      monitorStepExceptionMonitor={exceptionMonitor}
      onMonitorStepExceptionMonitorChanged={(
        value: MonitorStepExceptionMonitor,
      ) => {
        props.recorder.latest = value;
        setExceptionMonitor(value);
      }}
      telemetryServices={[]}
      telemetryEntities={[]}
    />
  );
};

function renderForm(
  initial: Partial<MonitorStepExceptionMonitor> = {},
): Recorder {
  const recorder: Recorder = { latest: null };

  render(
    <Harness
      recorder={recorder}
      initial={{ ...MonitorStepExceptionMonitorUtil.getDefault(), ...initial }}
    />,
  );

  return recorder;
}

function environmentsInput(): HTMLInputElement {
  return screen.getByPlaceholderText("production, staging") as HTMLInputElement;
}

function latestPreviewQuery(): JSONObject {
  return previewQueries[previewQueries.length - 1]!;
}

describe("Exceptions monitor form — environment filter", () => {
  beforeEach(() => {
    previewQueries = [];
  });

  afterEach(() => {
    cleanup();
  });

  test("offers an Environments field without opening the advanced options", () => {
    renderForm();

    expect(screen.getByText("Environments")).toBeInTheDocument();
    expect(environmentsInput()).toBeVisible();
    expect(environmentsInput().value).toBe("");
    expect(screen.getByText("Show Advanced Options")).toBeInTheDocument();
  });

  test("an unfiltered monitor previews every environment", () => {
    renderForm();

    expect(latestPreviewQuery()["environment"]).toBeUndefined();
  });

  test("typing environments saves them and narrows the preview", async () => {
    const recorder: Recorder = renderForm({ exceptionTypes: ["TypeError"] });

    fireEvent.change(environmentsInput(), {
      target: { value: "production, staging" },
    });

    expect(recorder.latest?.environments).toEqual(["production", "staging"]);
    // Nothing else the monitor had is disturbed.
    expect(recorder.latest?.exceptionTypes).toEqual(["TypeError"]);

    // The preview is debounced so typing does not refetch per keystroke.
    await waitFor(
      () => {
        expect(latestPreviewQuery()["environment"]).toEqual({
          _type: "Includes",
          value: ["production", "staging"],
        });
      },
      { timeout: 3000 },
    );
    expect(latestPreviewQuery()["exceptionType"]).toEqual({
      _type: "Includes",
      value: ["TypeError"],
    });
  });

  test("blank entries and repeats are dropped, but case is kept", () => {
    const recorder: Recorder = renderForm();

    fireEvent.change(environmentsInput(), {
      target: { value: " production , , Production, production," },
    });

    expect(recorder.latest?.environments).toEqual(["production", "Production"]);
  });

  test("a trailing comma while typing is left in the box", () => {
    renderForm();

    fireEvent.change(environmentsInput(), {
      target: { value: "production, " },
    });

    // The next environment can still be typed after the comma.
    expect(environmentsInput().value).toBe("production, ");
  });

  test("a saved monitor loads its environments back into the form and preview", () => {
    renderForm({ environments: ["production", "staging"] });

    expect(environmentsInput().value).toBe("production, staging");
    expect(latestPreviewQuery()["environment"]).toEqual({
      _type: "Includes",
      value: ["production", "staging"],
    });
  });

  test("clearing the field goes back to every environment", async () => {
    const recorder: Recorder = renderForm({ environments: ["production"] });

    fireEvent.change(environmentsInput(), { target: { value: "" } });

    expect(recorder.latest?.environments).toEqual([]);

    await waitFor(
      () => {
        expect(latestPreviewQuery()["environment"]).toBeUndefined();
      },
      { timeout: 3000 },
    );
  });
});
