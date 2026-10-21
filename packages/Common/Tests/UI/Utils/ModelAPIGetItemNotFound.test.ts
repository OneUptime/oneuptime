import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The API answers a read by id of a record that does not exist, is in
 * another project or is one the caller may not read with 404. The pages
 * read that as no record - getItem resolves null, which every caller
 * already handles ("Cannot load this incident...") - rather than as an
 * error. Any other failure is still thrown, as before, and so is a 404 from
 * a route of the caller's own (overrideRequestUrl): a route that is not
 * there answers 404 too, and only the API's get-item route means "no such
 * record" by it.
 */

const PROJECT_ID: string = "019acd20-3333-4333-8333-333333333333";
const RECORD_ID: ObjectID = new ObjectID(
  "019acd20-4444-4444-8444-444444444444",
);
const OWN_ROUTE: URL = URL.fromString(
  "https://oneuptime.example/status-page-api/subscription/get-item",
);

function respondWith(response: HTTPResponse<JSONObject>): void {
  jest.spyOn(API, "fetch").mockResolvedValue(response as never);
}

async function thrownBy(request: Promise<unknown>): Promise<unknown> {
  try {
    await request;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the request to throw");
}

beforeEach(() => {
  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ModelAPI.getItem", () => {
  const getItem: () => Promise<IncidentState | null> =
    async (): Promise<IncidentState | null> => {
      return await ModelAPI.getItem<IncidentState>({
        modelType: IncidentState,
        id: RECORD_ID,
        select: { _id: true, name: true },
      });
    };

  test("a record the caller may read comes back as the model", async () => {
    respondWith(
      new HTTPResponse<JSONObject>(
        200,
        { _id: RECORD_ID.toString(), name: "Investigating" },
        {},
      ),
    );

    const state: IncidentState | null = await getItem();

    expect(state).toBeInstanceOf(IncidentState);
    expect(state?.name).toBe("Investigating");
  });

  test("a record that is missing or unreadable (404) is no record", async () => {
    respondWith(
      new HTTPErrorResponse(404, { message: "Incident State not found." }, {}),
    );

    expect(await getItem()).toBeNull();
  });

  test("a 404 from a route of the caller's own is still thrown", async () => {
    respondWith(new HTTPErrorResponse(404, { message: "Not found" }, {}));

    const error: unknown = await thrownBy(
      ModelAPI.getItem<IncidentState>({
        modelType: IncidentState,
        id: RECORD_ID,
        select: { _id: true, name: true },
        requestOptions: { overrideRequestUrl: OWN_ROUTE },
      }),
    );

    expect(error).toBeInstanceOf(HTTPErrorResponse);
    expect((error as HTTPErrorResponse).statusCode).toBe(404);
  });

  test("a refusal (422) is still thrown", async () => {
    respondWith(
      new HTTPErrorResponse(
        422,
        { message: "You do not have permissions to read Incident State." },
        {},
      ),
    );

    const error: unknown = await thrownBy(getItem());

    expect(error).toBeInstanceOf(HTTPErrorResponse);
    expect((error as HTTPErrorResponse).statusCode).toBe(422);
  });

  test("a server error is still thrown", async () => {
    respondWith(new HTTPErrorResponse(500, { message: "Server error" }, {}));

    expect(await thrownBy(getItem())).toBeInstanceOf(HTTPErrorResponse);
  });

  test("tells a not-found answer from any other", () => {
    expect(
      ModelAPI.isNotFound(new HTTPErrorResponse(404, { message: "" }, {})),
    ).toBe(true);
    expect(
      ModelAPI.isNotFound(new HTTPErrorResponse(422, { message: "" }, {})),
    ).toBe(false);
    expect(ModelAPI.isNotFound(new Error("not found"))).toBe(false);
  });
});

describe("AnalyticsModelAPI.getItem", () => {
  test("a row that is missing or unreadable (404) is no row", async () => {
    respondWith(
      new HTTPErrorResponse(404, { message: "Monitor Log not found." }, {}),
    );

    expect(
      await AnalyticsModelAPI.getItem<MonitorLog>({
        modelType: MonitorLog,
        id: RECORD_ID,
        select: { _id: true },
      }),
    ).toBeNull();
  });

  test("a 404 from a route of the caller's own is still thrown", async () => {
    respondWith(new HTTPErrorResponse(404, { message: "Not found" }, {}));

    const error: unknown = await thrownBy(
      AnalyticsModelAPI.getItem<MonitorLog>({
        modelType: MonitorLog,
        id: RECORD_ID,
        select: { _id: true },
        requestOptions: { overrideRequestUrl: OWN_ROUTE },
      }),
    );

    expect(error).toBeInstanceOf(HTTPErrorResponse);
    expect((error as HTTPErrorResponse).statusCode).toBe(404);
  });

  test("a refusal is still thrown", async () => {
    respondWith(new HTTPErrorResponse(422, { message: "Refused" }, {}));

    expect(
      await thrownBy(
        AnalyticsModelAPI.getItem<MonitorLog>({
          modelType: MonitorLog,
          id: RECORD_ID,
          select: { _id: true },
        }),
      ),
    ).toBeInstanceOf(HTTPErrorResponse);
  });
});
