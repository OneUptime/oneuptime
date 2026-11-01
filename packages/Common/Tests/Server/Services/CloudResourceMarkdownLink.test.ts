import DatabaseConfig from "../../../Server/DatabaseConfig";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import URL from "../../../Types/API/URL";
import {
  CloudResourceKind,
  getCloudResourceDashboardPath,
  getCloudResourceKindNoun,
} from "../../../Types/Cloud/CloudResourceKind";
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
 * Every feed entry about a CloudResource row - created, labelled, owned,
 * archived - names it as "[Cloud Environment checkout](…)" or "[Cloud
 * Resource vm-1](…)", and the same markdown is posted to Slack and
 * Microsoft Teams. Since Cloud and App Platforms became two products, an
 * environment's link opens its page in App Platforms and a resource's in
 * Cloud: the one read of the row's name says which it is.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const ROW_ID: ObjectID = new ObjectID("0193c0de-cccc-4aaa-8bbb-000000000002");

function row(data: {
  name: string;
  kind?: CloudResourceKind | null | undefined;
}): CloudResource {
  const resource: CloudResource = new CloudResource();
  resource._id = ROW_ID.toString();
  resource.name = data.name;
  if (data.kind !== undefined) {
    resource.cloudResourceKind = data.kind as CloudResourceKind;
  }
  return resource;
}

let findOneById: jest.SpiedFunction<typeof CloudResourceService.findOneById>;

beforeEach(() => {
  // A fresh URL per call: URL.addRoute mutates.
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation(async (): Promise<URL> => {
      return URL.fromString(DASHBOARD);
    });
  findOneById = jest.spyOn(CloudResourceService, "findOneById");
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function linkOf(found: CloudResource | null): Promise<string> {
  findOneById.mockResolvedValue(found);

  return (
    await CloudResourceService.getCloudResourceMarkdownLink(PROJECT_ID, ROW_ID)
  ).toString();
}

describe("a cloud row's link in a feed entry", () => {
  test("an environment is a Cloud Environment, linked to its page in App Platforms", async () => {
    expect(
      await linkOf(
        row({
          name: "checkout · us-east-1",
          kind: CloudResourceKind.Environment,
        }),
      ),
    ).toBe(
      `[Cloud Environment checkout · us-east-1](${DASHBOARD}/${PROJECT_ID.toString()}/app-platforms/${ROW_ID.toString()})`,
    );
  });

  test("a resource is a Cloud Resource, linked to its page in Cloud", async () => {
    expect(
      await linkOf(
        row({ name: "vm-prod-01", kind: CloudResourceKind.Resource }),
      ),
    ).toBe(
      `[Cloud Resource vm-prod-01](${DASHBOARD}/${PROJECT_ID.toString()}/cloud/${ROW_ID.toString()})`,
    );
  });

  test("a row that names no kind is the environment it has always been", async () => {
    expect(await linkOf(row({ name: "legacy", kind: null }))).toBe(
      `[Cloud Environment legacy](${DASHBOARD}/${PROJECT_ID.toString()}/app-platforms/${ROW_ID.toString()})`,
    );
  });

  test("a row that is gone links to Cloud, which says it was not found", async () => {
    expect(await linkOf(null)).toBe(
      `[Cloud Resource ](${DASHBOARD}/${PROJECT_ID.toString()}/cloud/${ROW_ID.toString()})`,
    );
  });

  test("reads the row's name and kind, once, as root", async () => {
    await linkOf(row({ name: "api", kind: CloudResourceKind.Environment }));

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById.mock.calls[0]![0]).toMatchObject({
      id: ROW_ID,
      select: { name: true, cloudResourceKind: true },
      props: { isRoot: true },
    });
  });

  test("a name that is markdown is written as text, not as a link of its own", async () => {
    const link: string = await linkOf(
      row({
        name: "[click me](https://evil.example)",
        kind: CloudResourceKind.Resource,
      }),
    );

    expect(link).not.toContain("](https://evil.example)");
    expect(link.endsWith(`/cloud/${ROW_ID.toString()})`)).toBe(true);
  });
});

describe("where a row's page is, after the project", () => {
  test.each([
    [CloudResourceKind.Environment, "app-platforms"],
    [CloudResourceKind.Resource, "cloud"],
    [null, "app-platforms"],
    ["", "app-platforms"],
    // A writer that cannot tell goes through Cloud, which forwards.
    [undefined, "cloud"],
  ])(
    "a row of kind %j is under %s",
    (kind: string | null | undefined, product: string) => {
      expect(
        getCloudResourceDashboardPath({
          cloudResourceId: ROW_ID.toString(),
          cloudResourceKind: kind,
        }),
      ).toBe(`${product}/${ROW_ID.toString()}`);
    },
  );

  test("the noun follows the kind", () => {
    expect(getCloudResourceKindNoun(CloudResourceKind.Resource)).toBe(
      "Cloud Resource",
    );
    expect(getCloudResourceKindNoun(CloudResourceKind.Environment)).toBe(
      "Cloud Environment",
    );
    expect(getCloudResourceKindNoun(undefined)).toBe("Cloud Environment");
  });
});
