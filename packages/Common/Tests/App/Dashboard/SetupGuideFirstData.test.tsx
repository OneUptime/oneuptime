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
import { MemoryRouter } from "react-router-dom";

/*
 * Every telemetry product's Setup Guide tab notices the first data (issue
 * #6806): it ends with the wait the first-run dialog has, watching for the
 * first service to report and linking to that service's page for the
 * signal - and, for data that names no service (#7754), for the first data
 * of the key the snippets carry, linking to the product's explorer.
 * Profiles listen for their first profile in the guide itself, and the
 * bare guide (in a dialog or a guided setup) draws its own wait, so
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
        ingestionKey?: { name?: string } | null;
        dataPage?: string;
      }) => {
        return (
          <div
            data-testid="first-data-watch"
            data-model={props.modelType.name}
            data-view-page={props.viewPage}
            data-key={props.ingestionKey?.name || ""}
            data-data-page={props.dataPage || ""}
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
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
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
  // The project's one key, which the guide picks for its snippets.
  jest.spyOn(ModelAPI, "getList").mockImplementation(((data: {
    modelType: { new (): BaseModel };
  }): Promise<ListResult<BaseModel>> => {
    const rows: Array<BaseModel> = [];

    if (data.modelType === TelemetryIngestionKey) {
      const key: TelemetryIngestionKey = new TelemetryIngestionKey();
      key.id = new ObjectID("key-1");
      key.name = "Production Key";
      key.secretKey = new ObjectID("secret-1");
      key.keyType = TelemetryIngestionKeyType.Server;
      rows.push(key);
    }

    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 10,
    } as ListResult<BaseModel>);
  }) as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Setup Guide tab's last step", () => {
  test.each([
    ["logs", PageMap.SERVICE_VIEW_LOGS, "View logs", PageMap.LOGS],
    ["metrics", PageMap.SERVICE_VIEW_METRICS, "View metrics", PageMap.METRICS],
    ["traces", PageMap.SERVICE_VIEW_TRACES, "View traces", PageMap.TRACES],
    [
      "exceptions",
      PageMap.SERVICE_VIEW_EXCEPTIONS,
      "View exceptions",
      PageMap.EXCEPTIONS,
    ],
  ])(
    "%s waits for the first service to report, linking to its %s (%s), or for the picked key's first data, linking to %s",
    async (
      telemetryType: string,
      viewPage: string,
      viewText: string,
      dataPage: string,
    ) => {
      renderGuide({ telemetryType: telemetryType as TelemetryType });

      const step: HTMLElement = screen.getByTestId(
        "telemetry-documentation-first-data",
      );
      expect(step).toHaveTextContent(SETUP_GUIDE_FIRST_DATA_TITLE);

      const watch: HTMLElement = screen.getByTestId("first-data-watch");
      expect(watch).toHaveAttribute("data-model", "Service");
      expect(watch).toHaveAttribute("data-view-page", viewPage);
      expect(watch).toHaveTextContent(viewText);
      expect(watch).toHaveAttribute("data-data-page", dataPage);
      // The key the snippets carry, once the picker has it.
      await waitFor(() => {
        expect(screen.getByTestId("first-data-watch")).toHaveAttribute(
          "data-key",
          "Production Key",
        );
      });
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
