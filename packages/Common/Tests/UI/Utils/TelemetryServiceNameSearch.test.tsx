import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../App/Dashboard/CappedListServer";
import Service from "../../../Models/DatabaseModels/Service";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  SearchValueOperator,
  SearchValuePredicate,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  SERVICE_NAME_SEARCH_LIMIT,
  ServiceNameSearch,
  findServiceIdByName,
  getGlobLiteral,
  getServiceNameSearchTexts,
  searchServicesForNamePredicates,
  useServiceNameSearch,
} from "../../../UI/Utils/TelemetryServiceNameSearch";

/*
 * A TYPED `service:` TOKEN, RESOLVED ON THE SERVER (#10921).
 *
 * The explorers matched a typed service name against the project's first
 * 10,000 services by name. The token's services are searched for on the
 * server now, by a text every name it matches contains; the explorer's own
 * matcher keeps exactly the ones it means. These pin the texts, the reads
 * and the hook's waiting.
 */

const predicate: (
  operator: SearchValueOperator,
  value: string,
  values?: Array<string>,
) => SearchValuePredicate = (
  operator: SearchValueOperator,
  value: string,
  values?: Array<string>,
): SearchValuePredicate => {
  return { operator: operator, value: value, values: values || [] };
};

describe("getGlobLiteral", () => {
  test.each([
    ["api-*", "api-"],
    ["*-prod", "-prod"],
    ["api-*-prod", "-prod"],
    ["checkout-*-eu", "checkout-"],
    ["a*checkout*b", "checkout"],
    ["pay?ments", "ments"],
    ["*", ""],
    ["*?*", ""],
    ["\\*literal", "*literal"],
    ["a\\?b*", "a?b"],
    ["checkout", "checkout"],
  ])("the longest literal run of %s is %s", (glob: string, literal: string) => {
    expect(getGlobLiteral(glob)).toBe(literal);
  });
});

describe("getServiceNameSearchTexts", () => {
  test.each([
    [SearchValueOperator.Equals, "checkout"],
    [SearchValueOperator.NotEquals, "checkout"],
    [SearchValueOperator.Contains, "checkout"],
    [SearchValueOperator.NotContains, "checkout"],
    [SearchValueOperator.StartsWith, "checkout"],
    [SearchValueOperator.EndsWith, "checkout"],
  ])("%s narrows by its value", (operator: SearchValueOperator) => {
    expect(getServiceNameSearchTexts(predicate(operator, "checkout"))).toEqual([
      "checkout",
    ]);
  });

  test("an any-of list narrows by each value, each once whatever its case", () => {
    expect(
      getServiceNameSearchTexts(
        predicate(SearchValueOperator.In, "", ["api", "Web", "web"]),
      ),
    ).toEqual(["api", "Web"]);
    expect(
      getServiceNameSearchTexts(
        predicate(SearchValueOperator.NotIn, "", ["api"]),
      ),
    ).toEqual(["api"]);
  });

  test("a glob narrows by its longest literal run, each of its globs", () => {
    expect(
      getServiceNameSearchTexts(
        predicate(SearchValueOperator.Wildcard, "api-*"),
      ),
    ).toEqual(["api-"]);
    expect(
      getServiceNameSearchTexts(
        predicate(SearchValueOperator.Wildcard, "", ["*-prod", "web-*"]),
      ),
    ).toEqual(["-prod", "web-"]);
  });

  test("a glob of wildcards alone, a blank value, or Exists narrows nothing", () => {
    expect(
      getServiceNameSearchTexts(predicate(SearchValueOperator.Wildcard, "*")),
    ).toBeNull();
    expect(
      getServiceNameSearchTexts(
        predicate(SearchValueOperator.Wildcard, "", ["api-*", "*"]),
      ),
    ).toBeNull();
    expect(
      getServiceNameSearchTexts(predicate(SearchValueOperator.Equals, "  ")),
    ).toBeNull();
    expect(
      getServiceNameSearchTexts(predicate(SearchValueOperator.Exists, "")),
    ).toBeNull();
  });

  test("the text is trimmed, as the server's search trims it", () => {
    expect(
      getServiceNameSearchTexts(
        predicate(SearchValueOperator.Contains, " pay "),
      ),
    ).toEqual(["pay"]);
  });
});

describe("searchServicesForNamePredicates", () => {
  const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
  const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
  let server: CappedListServer;

  beforeEach(() => {
    server = new CappedListServer();
    server.add(
      Service,
      namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );
    server.add(Service, [
      { _id: LATE_ID, name: "wbkiosk-payments" },
      { _id: OTHER_LATE_ID, name: "wbkiosk-login" },
    ]);
    server.install();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("finds services past the project's first 10,000 by the text they contain", async () => {
    const services: Array<Service> = await searchServicesForNamePredicates({
      predicates: [predicate(SearchValueOperator.Equals, "WBKIOSK")],
    });

    expect(
      services
        .map((service: Service): string => {
          return service.name || "";
        })
        .sort(),
    ).toEqual(["wbkiosk-login", "wbkiosk-payments"]);

    const calls: Array<CappedListCall> = server.callsFor(Service);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.query["name"]).toBeInstanceOf(Search);
    expect(calls[0]!.limit).toBe(SERVICE_NAME_SEARCH_LIMIT);
  });

  test("one read per distinct text; each service once", async () => {
    const services: Array<Service> = await searchServicesForNamePredicates({
      predicates: [
        predicate(SearchValueOperator.In, "", ["payments", "PAYMENTS"]),
        predicate(SearchValueOperator.Contains, "wbkiosk"),
      ],
    });

    expect(server.callsFor(Service)).toHaveLength(2);
    expect(services).toHaveLength(2);
  });

  test("a predicate no text narrows reads the services by name from the first; Exists reads none", async () => {
    await searchServicesForNamePredicates({
      predicates: [predicate(SearchValueOperator.Exists, "")],
    });

    expect(server.callsFor(Service)).toHaveLength(0);

    await searchServicesForNamePredicates({
      predicates: [predicate(SearchValueOperator.Wildcard, "*")],
    });

    expect(server.callsFor(Service)).toHaveLength(1);
    expect(server.callsFor(Service)[0]!.query).toEqual({});
  });

  test("a failed read fails the search", async () => {
    jest.spyOn(server, "list").mockImplementation((() => {
      throw new Error("The server is unavailable.");
    }) as never);

    await expect(
      searchServicesForNamePredicates({
        predicates: [predicate(SearchValueOperator.Equals, "wbkiosk")],
      }),
    ).rejects.toThrow("The server is unavailable.");
  });
});

/*
 * A typed name to the id of the service it names (#11072): the logs
 * explorer's `service:` name, which it matched against the project's
 * first 10,000 services.
 */
describe("findServiceIdByName", () => {
  const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
  const TWIN_ID: string = "a1000000-0000-4000-8000-0000000000ac";
  let server: CappedListServer;

  beforeEach(() => {
    server = new CappedListServer();
    server.add(
      Service,
      namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );
    server.add(Service, [
      { _id: LATE_ID, name: "wbkiosk-payments" },
      { _id: "a1000000-0000-4000-8000-0000000000ab", name: "wbkiosk-login" },
    ]);
    server.install();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("finds a service past the project's first 10,000, by one search of its name", async () => {
    expect(await findServiceIdByName({ name: "wbkiosk-payments" })).toBe(
      LATE_ID,
    );

    const reads: Array<CappedListCall> = server.callsFor(Service);
    expect(reads).toHaveLength(1);
    expect((reads[0]!.query["name"] as Search<string>).value).toBe(
      "wbkiosk-payments",
    );
  });

  test("its case aside, and the spaces around it", async () => {
    expect(await findServiceIdByName({ name: "  WBKIOSK-Payments " })).toBe(
      LATE_ID,
    );
  });

  test("a name that is only part of a service's is no service's", async () => {
    expect(await findServiceIdByName({ name: "wbkiosk" })).toBeUndefined();
  });

  test("of services sharing a name, the first by name order", async () => {
    server.add(Service, [{ _id: TWIN_ID, name: "WBKIOSK-PAYMENTS" }]);

    expect([LATE_ID, TWIN_ID]).toContain(
      await findServiceIdByName({ name: "wbkiosk-payments" }),
    );
  });

  test("no name, no read", async () => {
    expect(await findServiceIdByName({ name: "  " })).toBeUndefined();
    expect(server.callsFor(Service)).toHaveLength(0);
  });

  test("a failed search throws, rather than say no service has the name", async () => {
    jest.restoreAllMocks();
    const failing: typeof ModelAPI = {
      getList: async (): Promise<never> => {
        throw new Error("refused");
      },
    } as unknown as typeof ModelAPI;

    await expect(
      findServiceIdByName({ name: "wbkiosk-payments", modelAPI: failing }),
    ).rejects.toThrow("refused");
  });
});

describe("useServiceNameSearch", () => {
  let server: CappedListServer;

  beforeEach(() => {
    server = new CappedListServer();
    server.add(Service, [
      { _id: "a1000000-0000-4000-8000-0000000000aa", name: "wbkiosk-payments" },
    ]);
    server.install();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no token, no read, nothing to wait for", () => {
    const { result } = renderHook(() => {
      return useServiceNameSearch([]);
    });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.services).toEqual([]);
    expect(server.callsFor(Service)).toHaveLength(0);
  });

  test("a token waits for its search, then holds its services", async () => {
    const { result } = renderHook(() => {
      return useServiceNameSearch([
        predicate(SearchValueOperator.Equals, "wbkiosk"),
      ]);
    });

    expect(result.current.isSearching).toBe(true);

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
    });

    expect(
      result.current.services.map((service: Service) => {
        return service.name;
      }),
    ).toEqual(["wbkiosk-payments"]);
    expect(result.current.hasFailed).toBe(false);
  });

  test("the same token read again is not searched again; the services hold still", async () => {
    const { result, rerender } = renderHook(
      (props: { value: string }) => {
        return useServiceNameSearch([
          predicate(SearchValueOperator.Equals, props.value),
        ]);
      },
      { initialProps: { value: "wbkiosk" } },
    );

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
    });

    const first: ServiceNameSearch = result.current;

    rerender({ value: "wbkiosk" });

    expect(result.current.services).toBe(first.services);
    expect(server.callsFor(Service)).toHaveLength(1);

    await act(async () => {
      rerender({ value: "payments" });
    });

    await waitFor(() => {
      expect(server.callsFor(Service)).toHaveLength(2);
    });
  });

  test("a failed search says so, with no services", async () => {
    jest.spyOn(server, "list").mockImplementation((() => {
      throw new Error("The server is unavailable.");
    }) as never);

    const { result } = renderHook(() => {
      return useServiceNameSearch([
        predicate(SearchValueOperator.Equals, "wbkiosk"),
      ]);
    });

    await waitFor(() => {
      expect(result.current.hasFailed).toBe(true);
    });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.services).toEqual([]);
  });
});
