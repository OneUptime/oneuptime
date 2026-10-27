import OpenSourceDeploymentService from "../../../Server/Services/OpenSourceDeploymentService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import OpenSourceDeployment from "../../../Models/DatabaseModels/OpenSourceDeployment";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * oneuptime.com keeps one record per self-hosted instance, found by its URL:
 * a sign-up or a daily check-in from a URL already on record updates that
 * record, and only a new URL adds one.
 */

const INSTANCE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

let findOneBy: ReturnType<typeof jest.spyOn>;
let create: ReturnType<typeof jest.spyOn>;
let updateOneById: ReturnType<typeof jest.spyOn>;
let any: ReturnType<typeof jest.spyOn>;

function checkIn(instanceUrl: string): OpenSourceDeployment {
  const deployment: OpenSourceDeployment = new OpenSourceDeployment();

  deployment.instanceUrl = instanceUrl;
  deployment.oneuptimeVersion = "10.0.6";

  return deployment;
}

function signUp(): OpenSourceDeployment {
  const deployment: OpenSourceDeployment = checkIn(
    "https://oneuptime.acme.io/",
  );

  deployment.email = "jane@acme.io";
  deployment.name = "Jane Doe";
  deployment.companyName = "Acme";
  deployment.companyPhoneNumber = "+15555550123";

  return deployment;
}

function onRecord(): void {
  const existing: OpenSourceDeployment = new OpenSourceDeployment();
  existing.id = INSTANCE_ID;

  findOneBy.mockResolvedValue(existing as never);
}

function updated(): JSONObject {
  expect(updateOneById).toHaveBeenCalledTimes(1);

  const { id, data, props } = updateOneById.mock.calls[0]![0] as {
    id: ObjectID;
    data: JSONObject;
    props: JSONObject;
  };

  expect(id.toString()).toBe(INSTANCE_ID.toString());
  expect(props).toEqual({ isRoot: true });

  return data;
}

describe("OpenSourceDeploymentService.isInstallUrl", () => {
  test.each([
    "https://oneuptime.acme.io/",
    "https://oneuptime.acme.io",
    "http://oneuptime.acme.io:8080/",
    "http://10.0.0.5/",
    "http://oneuptime/",
    "https://status.example.com.au/",
  ])("an install can run at %p", (instanceUrl: string) => {
    expect(OpenSourceDeploymentService.isInstallUrl(instanceUrl)).toBe(true);
  });

  test.each([
    "http://localhost/",
    "http://localhost",
    "http://LOCALHOST:3000/",
    "http://oneuptime.localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://0.0.0.0/",
    "https://oneuptime.test/",
    "https://oneuptime.example.com/",
    "https://example.org/",
    "https://e2e.invalid/",
    "ftp://files.acme.io/",
    "not a url",
    "",
  ])("nobody else can reach an install at %p", (instanceUrl: string) => {
    expect(OpenSourceDeploymentService.isInstallUrl(instanceUrl)).toBe(false);
  });

  test("reads a value that is not text as no install", () => {
    expect(OpenSourceDeploymentService.isInstallUrl(undefined)).toBe(false);
    expect(
      OpenSourceDeploymentService.isInstallUrl({
        href: "https://oneuptime.acme.io/",
      } as unknown as string),
    ).toBe(false);
  });
});

describe("OpenSourceDeploymentService.recordInstance", () => {
  beforeEach(() => {
    findOneBy = jest
      .spyOn(OpenSourceDeploymentService, "findOneBy")
      .mockResolvedValue(null as never);

    create = jest
      .spyOn(OpenSourceDeploymentService, "create")
      .mockResolvedValue(new OpenSourceDeployment() as never);

    updateOneById = jest
      .spyOn(OpenSourceDeploymentService, "updateOneById")
      .mockResolvedValue(undefined as never);

    any = jest.spyOn(QueryHelper, "any");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds a record for a URL it has not seen, as seen now", async () => {
    const deployment: OpenSourceDeployment = signUp();
    const before: number = Date.now();

    await OpenSourceDeploymentService.recordInstance(deployment);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toEqual({
      data: deployment,
      props: { isRoot: true },
    });
    expect(updateOneById).not.toHaveBeenCalled();

    const lastSeenAt: number = deployment.lastSeenAt!.getTime();

    expect(lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(lastSeenAt).toBeLessThanOrEqual(Date.now());
  });

  test("looks the URL up with and without its trailing slash, newest record first", async () => {
    await OpenSourceDeploymentService.recordInstance(
      checkIn("https://oneuptime.acme.io/"),
    );
    await OpenSourceDeploymentService.recordInstance(
      checkIn("https://status.acme.io"),
    );

    expect(any.mock.calls).toEqual([
      [["https://oneuptime.acme.io/", "https://oneuptime.acme.io"]],
      [["https://status.acme.io", "https://status.acme.io/"]],
    ]);

    const { sort, props } = findOneBy.mock.calls[0]![0] as {
      sort: JSONObject;
      props: JSONObject;
    };

    expect(sort).toEqual({ createdAt: SortOrder.Descending });
    expect(props).toEqual({ isRoot: true });
  });

  test("updates the record for a URL it has seen instead of adding one", async () => {
    onRecord();

    const deployment: OpenSourceDeployment = signUp();

    await OpenSourceDeploymentService.recordInstance(deployment);

    expect(create).not.toHaveBeenCalled();
    expect(updated()).toEqual({
      oneuptimeVersion: "10.0.6",
      lastSeenAt: deployment.lastSeenAt,
      email: "jane@acme.io",
      name: "Jane Doe",
      companyName: "Acme",
      companyPhoneNumber: "+15555550123",
    });
  });

  test("keeps the contact details on record when a check-in carries none", async () => {
    onRecord();

    const deployment: OpenSourceDeployment = checkIn(
      "https://oneuptime.acme.io/",
    );

    await OpenSourceDeploymentService.recordInstance(deployment);

    expect(updated()).toEqual({
      oneuptimeVersion: "10.0.6",
      lastSeenAt: deployment.lastSeenAt,
    });
  });

  test("keeps the company and phone on record when a sign-up leaves them empty", async () => {
    onRecord();

    const deployment: OpenSourceDeployment = signUp();
    deployment.companyName = "";
    deployment.companyPhoneNumber = "";

    await OpenSourceDeploymentService.recordInstance(deployment);

    expect(Object.keys(updated()).sort()).toEqual([
      "email",
      "lastSeenAt",
      "name",
      "oneuptimeVersion",
    ]);
  });
});
