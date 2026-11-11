import DataTypeDetailServiceHandler from "../../../FeatureSet/APIReference/Service/DataTypeDetail";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import CriteriaFilterValues from "Common/Types/Monitor/CriteriaFilterValues";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * WHAT THE API REFERENCE SAYS A MONITOR STEP'S VALUES ARE, AND WHAT THE
 * SERVER STORES.
 *
 * A Metrics monitor an AI created through the MCP server was stored with
 * its rolling time as "15 minutes" and its conditions as "GreaterThan" and
 * "LessThanOrEqual"; its checks read a window of no length and matched no
 * value. The reference listed the rolling times by hand - five of them
 * missing - and nothing said what became of any other value.
 *
 * The server now stores a value written another way as the one it means,
 * and refuses one that means none (MonitorStepsValuesUtil). The reference
 * must say only what the server does: every value it lists or offers as an
 * example is one the server reads, and the rolling time's list is every
 * rolling time there is.
 */

interface DataTypePage {
  title: string;
  description: string;
  properties: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
  }>;
  values: Array<{ value: string; description: string }>;
  jsonExample: string;
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

async function rollingTimeDescription(): Promise<string> {
  const page: DataTypePage = await dataTypePage("monitor-step-metric-monitor");
  const property: DataTypePage["properties"][number] | undefined =
    page.properties.find(
      (candidate: DataTypePage["properties"][number]): boolean => {
        return candidate.name === "rollingTime";
      },
    );

  if (!property) {
    throw new Error("The Metric monitor step's page has no rollingTime");
  }

  return property.description;
}

// Every text a sentence quotes: "Past 1 Minute", "15 minutes", ...
function quotedIn(text: string): Array<string> {
  return Array.from(text.matchAll(/"([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the Metric monitor step's rolling time, in the API reference", () => {
  it("names every rolling time the server stores", async () => {
    const quoted: Array<string> = quotedIn(await rollingTimeDescription());

    for (const rollingTime of Object.values(RollingTime)) {
      expect(quoted).toContain(rollingTime);
    }
  });

  it("offers as another way to write one only what the server reads as that one", async () => {
    const quoted: Array<string> = quotedIn(await rollingTimeDescription());
    const otherWays: Array<string> = quoted.filter((text: string): boolean => {
      return !RollingTimeUtil.isRollingTime(text);
    });

    // "15 minutes", "1h", "PT15M": at least one example, or the claim is bare.
    expect(otherWays.length).toBeGreaterThan(0);

    for (const text of otherWays) {
      expect([text, RollingTimeUtil.fromValue(text)]).toEqual([
        text,
        expect.any(String),
      ]);
    }
  });

  it("has an example the server stores as written", async () => {
    const page: DataTypePage = await dataTypePage(
      "monitor-step-metric-monitor",
    );
    const example: { rollingTime?: unknown } = JSON.parse(page.jsonExample) as {
      rollingTime?: unknown;
    };

    expect(RollingTimeUtil.isRollingTime(example.rollingTime)).toBe(true);
  });
});

describe("a criteria filter's values, in the API reference", () => {
  const pages: Array<{
    path: string;
    read: (value: unknown) => string | null;
  }> = [
    {
      path: "filter-type",
      read: (value: unknown): string | null => {
        return CriteriaFilterValues.readFilterType(value);
      },
    },
    {
      path: "check-on",
      read: (value: unknown): string | null => {
        return CriteriaFilterValues.readCheckOn(value);
      },
    },
    {
      path: "filter-condition",
      read: (value: unknown): string | null => {
        return CriteriaFilterValues.readFilterCondition(value);
      },
    },
  ];

  it.each(
    pages.map(
      (page: {
        path: string;
        read: (value: unknown) => string | null;
      }): [string, (value: unknown) => string | null] => {
        return [page.path, page.read];
      },
    ),
  )(
    "%s: every value it lists is one the server stores as written",
    async (path: string, read: (value: unknown) => string | null) => {
      const page: DataTypePage = await dataTypePage(path);

      expect(page.values.length).toBeGreaterThan(0);

      for (const listed of page.values) {
        expect([listed.value, read(listed.value)]).toEqual([
          listed.value,
          listed.value,
        ]);
      }
    },
  );
});
