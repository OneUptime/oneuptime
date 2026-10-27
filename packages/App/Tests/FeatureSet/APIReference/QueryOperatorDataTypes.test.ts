import DataTypeDetailServiceHandler from "../../../FeatureSet/APIReference/Service/DataTypeDetail";
import DataTypeUtil, {
  DataTypeDocumentation,
} from "../../../FeatureSet/APIReference/Utils/DataTypes";
import ResourceUtil, {
  ModelDocumentation,
} from "../../../FeatureSet/APIReference/Utils/Resources";
import { renderPage } from "./ReferenceFixtures";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OwnedBy, {
  MAX_OWNED_BY_IDS,
  OWNED_BY_QUERY_KEY,
  OwnedByMatch,
} from "Common/Types/BaseDatabase/OwnedBy";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import SerializableObjectDictionary from "Common/Types/SerializableObjectDictionary";
import { describe, expect, it, jest } from "@jest/globals";
import type * as Path from "path";

/*
 * The query filters the reference documents as data types, each held to the
 * class the API deserializes it into (#5191's follow-ups):
 *
 *   - OwnedBy, the owners filter, had no page at all: a list could be
 *     narrowed to the records some people or teams own, and nothing in the
 *     reference said how;
 *   - InBetween's example wrapped its bounds in "value", which InBetween
 *     never reads, so a filter copied from it compared against nothing;
 *   - every page said its JSON format was {"_type": ..., "value": ...},
 *     which is not InBetween's shape, nor OwnedBy's.
 */

jest.mock("../../../FeatureSet/APIReference/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(
    __dirname,
    "../../../FeatureSet/APIReference",
  );
  return {
    ViewsPath: path.join(root, "views"),
    StaticPath: path.join(root, "Static"),
    CodeExamplesPath: path.join(root, "CodeExamples"),
  };
});

// The query filters of the reference, each the name of the class it reads into.
const QUERY_FILTERS: ReadonlyArray<string> = [
  "EqualTo",
  "EqualToOrNull",
  "NotEqual",
  "Search",
  "GreaterThan",
  "GreaterThanOrEqual",
  "GreaterThanOrNull",
  "LessThan",
  "LessThanOrEqual",
  "LessThanOrNull",
  "InBetween",
  "NotNull",
  "IsNull",
  "Includes",
  "OwnedBy",
];

interface DataTypePage {
  title: string;
  description: string;
  properties: Array<{ name: string; type: string; required: boolean }>;
  jsonExample: string;
  jsonWrapperType: string | null;
  jsonWrapperKeys: Array<string>;
}

async function dataTypePage(path: string): Promise<DataTypePage> {
  let locals: Record<string, unknown> = {};

  const req: ExpressRequest = {
    params: { lang: "en", page: path },
    originalUrl: `/reference/en/${path}`,
    headers: {},
  } as unknown as ExpressRequest;

  const res: unknown = {
    status: (): unknown => {
      return res;
    },
    render: (_view: string, renderLocals: Record<string, unknown>): void => {
      locals = renderLocals;
    },
  };

  await DataTypeDetailServiceHandler.executeResponse(
    req,
    res as ExpressResponse,
  );

  return locals["pageData"] as DataTypePage;
}

function dataType(name: string): DataTypeDocumentation {
  const found: DataTypeDocumentation | undefined =
    DataTypeUtil.getDataTypes().find((candidate: DataTypeDocumentation) => {
      return candidate.name === name;
    });

  if (!found) {
    throw new Error(`No data type ${name}`);
  }

  return found;
}

describe("every query filter's page", () => {
  it.each(
    QUERY_FILTERS.map((name: string): [string] => {
      return [name];
    }),
  )(
    "%s: its example reads into the class the API makes of it, with nothing left over",
    async (name: string) => {
      const page: DataTypePage = await dataTypePage(dataType(name).path);
      const example: JSONObject = JSON.parse(page.jsonExample) as JSONObject;
      const read: unknown = JSONFunctions.deserializeValue(example);
      const type: unknown = (
        SerializableObjectDictionary as unknown as Record<string, unknown>
      )[name];

      expect(example["_type"]).toBe(name);
      expect(read).toBeInstanceOf(type as never);

      // Written back, the filter has the example's keys: none it never read.
      const written: JSONObject = (
        read as { toJSON: () => JSONObject }
      ).toJSON();

      expect(Object.keys(written).sort()).toEqual(Object.keys(example).sort());

      // The JSON format line names those keys, beside _type.
      expect(page.jsonWrapperType).toBe(name);
      expect([...page.jsonWrapperKeys].sort()).toEqual(
        Object.keys(example)
          .filter((key: string): boolean => {
            return key !== "_type";
          })
          .sort(),
      );
    },
  );
});

describe("InBetween", () => {
  it("puts its bounds beside _type, where InBetween reads them", async () => {
    const page: DataTypePage = await dataTypePage("in-between");
    const range: InBetween<string> = JSONFunctions.deserializeValue(
      JSON.parse(page.jsonExample) as JSONObject,
    ) as InBetween<string>;

    expect(range.startValue).toBe("2024-01-01T00:00:00.000Z");
    expect(range.endValue).toBe("2024-12-31T23:59:59.999Z");
    expect(page.jsonWrapperKeys).toEqual(["startValue", "endValue"]);
  });
});

describe("OwnedBy", () => {
  it("is a data type of its own, at a path no resource uses", () => {
    const ownedBy: DataTypeDocumentation = dataType("OwnedBy");

    expect(ownedBy.path).toBe("owned-by");
    expect(
      ResourceUtil.getResources().map((resource: ModelDocumentation) => {
        return resource.path;
      }),
    ).not.toContain(ownedBy.path);
  });

  it("names its three keys, none of which every filter needs", async () => {
    const page: DataTypePage = await dataTypePage("owned-by");

    expect(
      page.properties.map((property: { name: string }) => {
        return property.name;
      }),
    ).toEqual(["userIds", "teamIds", "match"]);
    expect(
      page.properties.every((property: { required: boolean }) => {
        return !property.required;
      }),
    ).toBe(true);
  });

  it("says how it is sent and what it matches, as OwnedBy does", async () => {
    const page: DataTypePage = await dataTypePage("owned-by");
    const matchDescription: string =
      (
        page.properties.find((property: { name: string }) => {
          return property.name === "match";
        }) as unknown as { description: string }
      ).description || "";

    expect(OWNED_BY_QUERY_KEY).toBe("owners");
    expect(page.description).toContain("It goes under the query's owners key");

    // Every match, AnyOf the default.
    for (const match of Object.values(OwnedByMatch)) {
      expect(matchDescription).toContain(match);
    }
    expect(matchDescription).toContain("AnyOf, the default");
    expect(
      new OwnedBy({
        userIds: [],
        teamIds: ["7c9e6679-7425-40de-944b-e07fc1f90ae7"],
      }).match,
    ).toBe(OwnedByMatch.AnyOf);

    expect(MAX_OWNED_BY_IDS).toBe(1000);
    expect(page.description).toContain(
      "One filter names at most 1,000 people and teams together.",
    );
  });

  it("keeps its lead to what it is, where it goes and its limits (fu-platform's review)", async () => {
    const page: DataTypePage = await dataTypePage("owned-by");
    const teamIds: string =
      (
        page.properties.find((property: { name: string }) => {
          return property.name === "teamIds";
        }) as unknown as { description: string }
      ).description || "";

    // The shape is the JSON format line's and the example's, not the lead's.
    expect(page.description).not.toContain("{");
    expect(page.description).not.toContain('"_type"');
    // How a team owns is said where teams are named.
    expect(page.description).not.toContain("Ownership is direct");
    expect(teamIds).toContain(
      "Ownership is direct: a team's members are not owners of what the team owns.",
    );
  });

  it("has an example the API reads", async () => {
    const page: DataTypePage = await dataTypePage("owned-by");
    const ownedBy: OwnedBy = JSONFunctions.deserializeValue(
      JSON.parse(page.jsonExample) as JSONObject,
    ) as OwnedBy;

    expect(ownedBy).toBeInstanceOf(OwnedBy);
    expect(ownedBy.match).toBe(OwnedByMatch.AnyOf);
    expect(ownedBy.userIds).toEqual(["550e8400-e29b-41d4-a716-446655440000"]);
    expect(ownedBy.teamIds).toEqual(["7c9e6679-7425-40de-944b-e07fc1f90ae7"]);
  });

  it("draws its page with its own JSON format", async () => {
    const pageData: DataTypePage = await dataTypePage("owned-by");
    const html: string = await renderPage({
      page: "data-type",
      slug: "owned-by",
      pageData: pageData as unknown as Record<string, unknown>,
    });

    expect(html).toContain(
      '{"_type": "OwnedBy", "match": ..., "userIds": ..., "teamIds": ...}',
    );
    expect(html).not.toContain('{"_type": "OwnedBy", "value": ...}');
  });
});

describe("the JSON format line of the other data types", () => {
  it("names a dashboard config's own keys, never a value it is not wrapped in (#4571)", async () => {
    const pageData: DataTypePage = await dataTypePage("dashboard-view-config");
    const html: string = await renderPage({
      page: "data-type",
      slug: "dashboard-view-config",
      pageData: pageData as unknown as Record<string, unknown>,
    });

    expect(pageData.jsonWrapperType).toBe("DashboardViewConfig");
    expect(pageData.jsonWrapperKeys).toContain("components");
    expect(pageData.jsonWrapperKeys).not.toContain("value");
    expect(html).toContain(
      '{"_type": "DashboardViewConfig", "components": ...',
    );
    expect(html).not.toContain('{"_type": "DashboardViewConfig", "value"');
  });

  it("is left out when the example has no _type: it is sent as it is shown", async () => {
    let unwrapped: { path: string; pageData: DataTypePage } | null = null;

    for (const candidate of DataTypeUtil.getDataTypes()) {
      const pageData: DataTypePage = await dataTypePage(candidate.path);
      let parsed: unknown = null;

      try {
        parsed = JSON.parse(pageData.jsonExample);
      } catch {
        parsed = null;
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        !("_type" in (parsed as JSONObject))
      ) {
        unwrapped = { path: candidate.path, pageData };
        break;
      }
    }

    expect(unwrapped).not.toBeNull();
    expect(unwrapped!.pageData.jsonWrapperType).toBeNull();

    const html: string = await renderPage({
      page: "data-type",
      slug: unwrapped!.path,
      pageData: unwrapped!.pageData as unknown as Record<string, unknown>,
    });

    expect(html).not.toContain('{"_type": "');
  });
});
