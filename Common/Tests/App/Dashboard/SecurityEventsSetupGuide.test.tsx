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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventsSetupGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";

/*
 * The setup guide's whole job is to hand someone a command they can paste.
 * Two things make that command worthless without anything failing to
 * render: the wrong token (a placeholder left in when a real key was
 * available, or a stale secret from a key the user has since switched
 * away from), and the wrong endpoint. Both are string interpolation, so
 * neither a type nor a render error would catch them.
 *
 * The wiring around the page — route, tab, breadcrumb — and the contract
 * the snippets are written against are pinned in
 * App/Tests/Dashboard/SecurityEventsSetupGuide.test.ts. What is pinned
 * here is what actually reaches the screen.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");

function ingestionKey(data: {
  id: string;
  name: string;
  secret: string;
}): TelemetryIngestionKey {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(data.id);
  key.name = data.name;
  key.secretKey = new ObjectID(data.secret);
  return key;
}

const FIRST_KEY: TelemetryIngestionKey = ingestionKey({
  id: "key-1",
  name: "Production Key",
  secret: "secret-production",
});

/*
 * The rendered text of the whole card. CodeBlock runs the sample through
 * highlight.js, which shreds it into a span per token — so a query for a
 * line of the snippet finds whichever fragment happens to hold the match,
 * not the sample. Reading the container back is what lets an assertion be
 * about the command as the user sees it.
 */
type RenderGuideFunction = () => HTMLElement;

const renderGuide: RenderGuideFunction = (): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <SecurityEventsSetupGuide />
    </MemoryRouter>,
  );

  return container;
};

describe("Security Events setup guide", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [FIRST_KEY],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
    // No events yet: the guide should be waiting, not congratulating.
    jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(0 as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("renders the curl sample against the real ingest path", async () => {
    const container: HTMLElement = renderGuide();

    await waitFor(() => {
      expect(container.textContent).toContain("/security-events/v1/ingest");
    });

    expect(container.textContent).toContain("x-oneuptime-token");
    expect(container.textContent).toContain("class_uid");
  });

  test("interpolates the selected key's secret, not the placeholder", async () => {
    const container: HTMLElement = renderGuide();

    await waitFor(() => {
      expect(container.textContent).toContain(
        "x-oneuptime-token: secret-production",
      );
    });

    expect(container.textContent).not.toContain("<YOUR_ONEUPTIME_TOKEN>");
  });

  /*
   * With no key to show, the sample must still look pasteable rather than
   * carry an empty header — hence the placeholder, which is only correct
   * while there is genuinely nothing to interpolate.
   */
  test("falls back to the placeholder when the project has no keys", async () => {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 50,
    } as never);

    const container: HTMLElement = renderGuide();

    await waitFor(() => {
      expect(container.textContent).toContain(
        "x-oneuptime-token: <YOUR_ONEUPTIME_TOKEN>",
      );
    });

    expect(container.textContent).not.toContain("secret-production");
  });

  test("switching dialect switches the sample and its format", async () => {
    const container: HTMLElement = renderGuide();

    await waitFor(() => {
      expect(container.textContent).toContain("class_uid");
    });

    fireEvent.click(screen.getByRole("button", { name: "Google UDM" }));

    await waitFor(() => {
      expect(container.textContent).toContain("format=udm");
    });

    expect(container.textContent).toContain("USER_LOGIN");
    expect(container.textContent).not.toContain("class_uid");
  });

  test("switching source shows the Fluent Bit output config", async () => {
    const container: HTMLElement = renderGuide();

    await waitFor(() => {
      expect(container.textContent).toContain("x-oneuptime-token");
    });

    fireEvent.click(screen.getByRole("button", { name: /Fluent Bit/ }));

    await waitFor(() => {
      expect(container.textContent).toContain("Name             http");
    });

    expect(container.textContent).toContain(
      "URI              /security-events/v1/ingest",
    );
    expect(container.textContent).toContain(
      "Header           x-oneuptime-token secret-production",
    );
  });

  test("waits for the first event, then confirms when one arrives", async () => {
    renderGuide();

    expect(
      await screen.findByText(/Listening for your first security event/),
    ).toBeInTheDocument();

    cleanup();

    jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(7 as never);

    renderGuide();

    expect(
      await screen.findByText(/Security events are flowing! 7 events/),
    ).toBeInTheDocument();
    expect(screen.getByText("View Security Events")).toBeInTheDocument();
  });
});
