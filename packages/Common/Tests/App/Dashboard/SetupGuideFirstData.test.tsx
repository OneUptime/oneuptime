import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Every telemetry product's Setup Guide tab notices the first data (issue
 * #6806): it ends with the wait the first-run dialog has, watching for the
 * first service to report and linking to that service's page for the
 * signal. Profiles listen for their first profile in the guide itself, and
 * the bare guide (in a dialog or a guided setup) draws its own wait, so
 * neither gets a second one.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceConnectionWatch",
  () => {
    return {
      __esModule: true,
      default: (props: {
        modelType: { name: string };
        viewPage: string;
        viewText: string;
      }) => {
        return (
          <div
            data-testid="first-data-watch"
            data-model={props.modelType.name}
            data-view-page={props.viewPage}
          >
            {props.viewText}
          </div>
        );
      },
    };
  },
);

import TelemetryDocumentation, {
  SETUP_GUIDE_FIRST_DATA_TITLE,
  TelemetryType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const renderGuide: (props: {
  telemetryType: TelemetryType;
  isBare?: boolean;
}) => void = (props: { telemetryType: TelemetryType; isBare?: boolean }) => {
  render(
    <MemoryRouter>
      <TelemetryDocumentation
        telemetryType={props.telemetryType}
        isBare={props.isBare}
      />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("project-1"));
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 10,
  } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Setup Guide tab's last step", () => {
  test.each([
    ["logs", PageMap.SERVICE_VIEW_LOGS, "View logs"],
    ["metrics", PageMap.SERVICE_VIEW_METRICS, "View metrics"],
    ["traces", PageMap.SERVICE_VIEW_TRACES, "View traces"],
    ["exceptions", PageMap.SERVICE_VIEW_EXCEPTIONS, "View exceptions"],
  ])(
    "%s waits for the first service to report, and links to its %s",
    (telemetryType: string, viewPage: string, viewText: string) => {
      renderGuide({ telemetryType: telemetryType as TelemetryType });

      const step: HTMLElement = screen.getByTestId(
        "telemetry-documentation-first-data",
      );
      expect(step).toHaveTextContent(SETUP_GUIDE_FIRST_DATA_TITLE);

      const watch: HTMLElement = screen.getByTestId("first-data-watch");
      expect(watch).toHaveAttribute("data-model", "Service");
      expect(watch).toHaveAttribute("data-view-page", viewPage);
      expect(watch).toHaveTextContent(viewText);
    },
  );

  test("profiles have none: their guide listens for the first profile itself", () => {
    renderGuide({ telemetryType: "profiles" });

    expect(
      screen.queryByTestId("telemetry-documentation-first-data"),
    ).not.toBeInTheDocument();
  });

  test("the bare guide has none: the dialog or setup around it draws its own", () => {
    renderGuide({ telemetryType: "logs", isBare: true });

    expect(screen.queryByTestId("first-data-watch")).not.toBeInTheDocument();
  });
});
