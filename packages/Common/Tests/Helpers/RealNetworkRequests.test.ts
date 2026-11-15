import { afterEach, describe, expect, jest, test } from "@jest/globals";
import axios from "axios";
import childProcess from "child_process";
import fs from "fs";
import path from "path";
import URL from "../../Types/API/URL";
import APIException from "../../Types/Exception/ApiException";
import API from "../../Utils/API";
import {
  RealRequest,
  SUITES_STILL_SENDING_REQUESTS,
  SUITES_THAT_TALK_TO_A_LOCAL_SERVER,
  failIfSent,
  failureFor,
  isLetThrough,
  isLocalServerUrl,
  isNetworkUrl,
  runningSuite,
  senderOf,
  takeRequestsSent,
} from "./RealNetworkRequests";

/*
 * The rule Tests/jest.setup.ts installs in every Common suite (#8403): a
 * request that would leave for the network through jsdom's XMLHttpRequest is
 * refused at once, as a refused connection, and the test that sent it fails,
 * naming it - unless the suite is on one of the two lists. These send real
 * requests on purpose, through the rule this suite runs under too, and take
 * what it recorded (takeRequestsSent) so its own afterEach has nothing left
 * to fail on.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const THIS_SUITE: string = "Tests/Helpers/RealNetworkRequests.test.ts";
// A Common test's path from packages/Common.
const A_COMMON_TEST: RegExp = /^Tests\/.+\.test\.tsx?$/;
const SENT_FROM_HERE: RegExp =
  /^packages\/Common\/Tests\/Helpers\/RealNetworkRequests\.test\.ts:\d+$/;

// Every event an XMLHttpRequest fires, with the state it was in.
function eventsOf(request: XMLHttpRequest): Array<string> {
  const events: Array<string> = [];

  for (const type of [
    "loadstart",
    "readystatechange",
    "load",
    "error",
    "abort",
    "timeout",
    "loadend",
  ]) {
    request.addEventListener(type, (): void => {
      events.push(`${type} ${request.readyState}`);
    });
  }

  return events;
}

// Lets the microtasks the refusal is queued on run.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

function aRequest(overrides: Partial<RealRequest> = {}): RealRequest {
  return {
    suite: "Tests/App/Dashboard/Some.test.tsx",
    test: "draws the page",
    method: "POST",
    url: "http://localhost/api/receiving-gaps",
    from: "packages/App/FeatureSet/Dashboard/src/Utils/ReceivingGaps.ts:42",
    letThrough: false,
    ...overrides,
  };
}

afterEach((): void => {
  jest.useRealTimers();
});

describe("a request that would leave for the network", () => {
  test("is refused at once, as a refused connection is: loadstart, then on the next microtask DONE with status 0, error and loadend", async () => {
    const request: XMLHttpRequest = new XMLHttpRequest();
    const events: Array<string> = eventsOf(request);

    request.open("POST", "http://localhost/api/receiving-gaps");
    request.setRequestHeader("Content-Type", "application/json");
    request.send(JSON.stringify({ startsAt: "a" }));

    expect(events).toEqual(["readystatechange 1", "loadstart 1"]);

    await settle();

    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1",
      "readystatechange 4",
      "error 4",
      "loadend 4",
    ]);
    expect(request.status).toBe(0);
    expect(request.statusText).toBe("");
    expect(request.responseText).toBe("");
    expect(request.getAllResponseHeaders()).toBe("");
    expect(takeRequestsSent()).toEqual([
      {
        suite: THIS_SUITE,
        test: expect.stringContaining("is refused at once"),
        method: "POST",
        url: "http://localhost/api/receiving-gaps",
        from: expect.stringMatching(SENT_FROM_HERE),
        letThrough: false,
      },
    ]);
  });

  test("never waits on the clock: refused with fake timers that are never advanced", async () => {
    jest.useFakeTimers();

    const request: XMLHttpRequest = new XMLHttpRequest();
    const events: Array<string> = eventsOf(request);

    request.open("GET", "https://oneuptime.example.com/api/status");
    request.send();
    await settle();

    expect(events).toContain("error 4");
    expect(takeRequestsSent()).toHaveLength(1);
  });

  test("an address relative to the page is the page's: jsdom's http://localhost/", async () => {
    const request: XMLHttpRequest = new XMLHttpRequest();

    request.open("get", "/api/user/me");
    request.send();
    await settle();

    expect(takeRequestsSent()).toEqual([
      expect.objectContaining({
        method: "GET",
        url: "http://localhost/api/user/me",
      }),
    ]);
  });

  test("axios rejects with the Network Error a refused connection gives it", async () => {
    await expect(
      axios.post("http://localhost/api/receiving-gaps", { a: 1 }),
    ).rejects.toMatchObject({
      name: "AxiosError",
      code: "ERR_NETWORK",
      message: "Network Error",
    });

    expect(takeRequestsSent()).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost/api/receiving-gaps",
        from: expect.stringMatching(SENT_FROM_HERE),
      }),
    ]);
  });

  test("Common's API throws what it throws for a refused connection, and the sender named is the caller, not the API", async () => {
    const thrown: unknown = await API.get({
      url: URL.fromString("http://localhost/api/project/list"),
    }).catch((error: unknown): unknown => {
      return error;
    });

    expect(thrown).toBeInstanceOf(APIException);
    expect((thrown as Error).message).toBe(
      "Request failed to http://localhost/api/project/list. Network Error",
    );

    const [sent] = takeRequestsSent();

    expect(sent).toEqual(
      expect.objectContaining({
        method: "GET",
        url: "http://localhost/api/project/list",
        from: expect.stringMatching(SENT_FROM_HERE),
      }),
    );
  });

  test("abort() before the refusal lands ends it as an abort, with no error after", async () => {
    const request: XMLHttpRequest = new XMLHttpRequest();
    const events: Array<string> = eventsOf(request);

    request.open("GET", "http://localhost/api/slow");
    request.send();
    request.abort();
    await settle();

    expect(events).toEqual([
      "readystatechange 1",
      "loadstart 1",
      "readystatechange 4",
      "abort 4",
      "loadend 4",
    ]);
    expect(request.readyState).toBe(0);
    expect(takeRequestsSent()).toHaveLength(1);
  });

  test("a synchronous request throws the NetworkError a refused one throws", () => {
    const request: XMLHttpRequest = new XMLHttpRequest();

    request.open("GET", "http://localhost/api/sync", false);

    let thrown: unknown = null;

    try {
      request.send();
    } catch (error: unknown) {
      thrown = error;
    }

    expect((thrown as DOMException).name).toBe("NetworkError");
    expect(request.readyState).toBe(4);
    expect(takeRequestsSent()).toHaveLength(1);
  });
});

describe("what never leaves for the network", () => {
  test("a data: address is answered by jsdom, as it always was, and recorded nowhere", async () => {
    const request: XMLHttpRequest = new XMLHttpRequest();
    const loaded: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        request.addEventListener("loadend", (): void => {
          resolve();
        });
      },
    );

    request.open("GET", "data:text/plain,hello");
    request.send();
    await loaded;

    expect(request.status).toBe(200);
    expect(request.responseText).toBe("hello");
    expect(takeRequestsSent()).toEqual([]);
  });

  test("only http: and https: addresses are the network", () => {
    expect(isNetworkUrl(new globalThis.URL("http://localhost/api"))).toBe(true);
    expect(isNetworkUrl(new globalThis.URL("https://a.example.com"))).toBe(
      true,
    );

    for (const address of [
      "data:text/plain,a",
      "blob:http://localhost/1234",
      "file:///etc/hosts",
      "about:blank",
    ]) {
      expect({
        address,
        network: isNetworkUrl(new globalThis.URL(address)),
      }).toEqual({ address, network: false });
    }
  });
});

describe("the test that sent one", () => {
  test("fails, naming each request and the code that sent it", () => {
    const requests: Array<RealRequest> = [
      aRequest(),
      aRequest({
        method: "GET",
        url: "http://localhost/api/resource-ai-access/status",
        from: "packages/Common/UI/Components/AI/Status.tsx:17",
      }),
    ];

    expect(() => {
      failIfSent("Tests/App/Dashboard/Some.test.tsx", requests, []);
    }).toThrow(failureFor(requests));
    expect(failureFor(requests)).toBe(
      [
        "This test sent 2 requests to the network, which Tests/jest.setup.ts refused at once:",
        "  POST http://localhost/api/receiving-gaps (from packages/App/FeatureSet/Dashboard/src/Utils/ReceivingGaps.ts:42)",
        "  GET http://localhost/api/resource-ai-access/status (from packages/Common/UI/Components/AI/Status.tsx:17)",
        'Stand in for what it reads - jest.spyOn(API, "get" / "post"), ModelAPI, AnalyticsModelAPI - as Tests/App/Dashboard/ContainerHostOverviewSlowLoads.test.tsx does (Tests/Helpers/RealNetworkRequests.ts).',
      ].join("\n"),
    );
    expect(failureFor([aRequest()])).toMatch(/^This test sent a request to/);
  });

  test("does not fail when its suite is on the list of those still sending them", () => {
    expect(() => {
      failIfSent(
        "Tests/App/Dashboard/Some.test.tsx",
        [aRequest()],
        ["Tests/App/Dashboard/Some.test.tsx"],
      );
    }).not.toThrow();
    // The list is by suite: another one still fails.
    expect(() => {
      failIfSent(
        "Tests/App/Dashboard/Other.test.tsx",
        [aRequest()],
        ["Tests/App/Dashboard/Some.test.tsx"],
      );
    }).toThrow("refused at once");
  });

  test("does not fail for a request that was let through, nor for none", () => {
    expect(() => {
      failIfSent(
        "Tests/Server/API/Some.test.ts",
        [aRequest({ url: "http://127.0.0.1:41234/api", letThrough: true })],
        [],
      );
    }).not.toThrow();
    expect(() => {
      failIfSent("Tests/Server/API/Some.test.ts", [], []);
    }).not.toThrow();
  });

  test("fails end to end: a suite that sends a request fails with its route named, and the rest of it passes", () => {
    const fixture: string = path.join(
      "Tests",
      "Helpers",
      "RealNetworkRequestsFixture",
      "SendsARequest.fixture.ts",
    );
    const run: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
      process.execPath,
      [
        path.join(COMMON_ROOT, "node_modules", "jest", "bin", "jest.js"),
        "--config",
        "jest.config.json",
        "--testRegex",
        "RealNetworkRequestsFixture/SendsARequest\\.fixture\\.ts$",
        "--runInBand",
        "--ci",
        "--coverage=false",
      ],
      {
        cwd: COMMON_ROOT,
        encoding: "utf8",
        env: { ...process.env, ONEUPTIME_NETWORK_CENSUS: "" },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 240000,
      },
    );
    const output: string = `${run.stdout}\n${run.stderr}`;

    expect(fs.existsSync(path.join(COMMON_ROOT, fixture))).toBe(true);
    expect(run.status).toBe(1);
    expect(output).toContain("✓ draws nothing and sends nothing");
    expect(output).toContain("✕ reads the user without standing in for API");
    expect(output).toContain(
      "This test sent a request to the network, which Tests/jest.setup.ts refused at once:",
    );
    expect(output).toMatch(
      /GET http:\/\/localhost\/api\/user\/me \(from packages\/Common\/Tests\/Helpers\/RealNetworkRequestsFixture\/SendsARequest\.fixture\.ts:\d+\)/,
    );
    expect(output).toMatch(/Tests:\s+1 failed, 1 passed, 2 total/);
  }, 300000);
});

describe("requests let through", () => {
  const localServerSuites: Array<string> = ["Tests/Server/API/Some.test.ts"];

  test("are a listed suite's, to a loopback address on a port of its own", () => {
    for (const address of [
      "http://127.0.0.1:41234/api/x",
      "http://localhost:3002/api",
      "http://[::1]:8080/",
    ]) {
      expect({
        address,
        letThrough: isLetThrough(
          "Tests/Server/API/Some.test.ts",
          new globalThis.URL(address),
          localServerSuites,
        ),
      }).toEqual({ address, letThrough: true });
    }
  });

  test("are never another address, nor another suite's", () => {
    for (const address of [
      "http://localhost/api/x",
      "http://127.0.0.1/api/x",
      "https://localhost/api",
      "http://app:3002/api/notification/sms/send",
      "https://oneuptime.com/api",
      "http://10.0.0.5:8080/",
    ]) {
      expect({
        address,
        letThrough: isLetThrough(
          "Tests/Server/API/Some.test.ts",
          new globalThis.URL(address),
          localServerSuites,
        ),
      }).toEqual({ address, letThrough: false });
    }

    expect(
      isLetThrough(
        "Tests/Server/API/Other.test.ts",
        new globalThis.URL("http://127.0.0.1:41234/api/x"),
        localServerSuites,
      ),
    ).toBe(false);
    expect(
      isLocalServerUrl(new globalThis.URL("http://127.0.0.1:41234/x")),
    ).toBe(true);
    expect(isLocalServerUrl(new globalThis.URL("http://127.0.0.1/x"))).toBe(
      false,
    );
  });
});

describe("the code named as the sender", () => {
  test("is the first frame in OneUptime's code past axios, Common's API and ModelAPI", () => {
    const stack: string = [
      "Error",
      "    at XMLHttpRequest.send (/repo/packages/Common/Tests/Helpers/RealNetworkRequests.ts:310:21)",
      "    at dispatchXhrRequest (/repo/packages/Common/node_modules/axios/lib/adapters/xhr.js:200:13)",
      "    at Axios.request (/repo/packages/Common/node_modules/axios/lib/core/Axios.js:40:14)",
      "    at async API.fetch (/repo/packages/Common/Utils/API.ts:680:42)",
      "    at async ModelAPI.getList (/repo/packages/Common/UI/Utils/ModelAPI/ModelAPI.ts:300:7)",
      "    at async fetchGaps (/repo/packages/App/FeatureSet/Dashboard/src/Utils/ReceivingGaps.ts:42:20)",
      "    at async Object.<anonymous> (/repo/packages/Common/Tests/App/Some.test.tsx:10:5)",
    ].join("\n");

    expect(senderOf(stack)).toBe(
      "packages/App/FeatureSet/Dashboard/src/Utils/ReceivingGaps.ts:42",
    );
  });

  test("is the transport itself when nothing else is on the stack, and says so when nothing in packages/ is", () => {
    expect(
      senderOf(
        [
          "Error",
          "    at dispatchXhrRequest (/repo/packages/Common/node_modules/axios/lib/adapters/xhr.js:200:13)",
          "    at API.fetch (/repo/packages/Common/Utils/API.ts:680:42)",
        ].join("\n"),
      ),
    ).toBe("packages/Common/Utils/API.ts:680");
    expect(
      senderOf("Error\n    at node:internal/process/task_queues:105:5"),
    ).toBe("(no frame in packages/)");
  });
});

describe("the lists", () => {
  test("this suite is itself under the rule, and on neither list", () => {
    expect(runningSuite()).toBe(THIS_SUITE);
    expect(SUITES_STILL_SENDING_REQUESTS).not.toContain(THIS_SUITE);
    expect(SUITES_THAT_TALK_TO_A_LOCAL_SERVER).not.toContain(THIS_SUITE);
  });

  test.each([
    ["SUITES_STILL_SENDING_REQUESTS", SUITES_STILL_SENDING_REQUESTS],
    ["SUITES_THAT_TALK_TO_A_LOCAL_SERVER", SUITES_THAT_TALK_TO_A_LOCAL_SERVER],
  ])(
    "%s names suites that exist, once each, in order",
    (_name: string, list: ReadonlyArray<string>) => {
      for (const suite of list) {
        expect({
          suite,
          exists: fs.existsSync(path.join(COMMON_ROOT, suite)),
          isATest: A_COMMON_TEST.test(suite),
        }).toEqual({ suite, exists: true, isATest: true });
      }

      expect(new Set(list).size).toBe(list.length);
      expect([...list]).toEqual([...list].sort());
    },
  );

  test("no suite is on both", () => {
    expect(
      SUITES_STILL_SENDING_REQUESTS.filter((suite: string): boolean => {
        return SUITES_THAT_TALK_TO_A_LOCAL_SERVER.includes(suite);
      }),
    ).toEqual([]);
  });

  test("jest.setup.ts installs the rule, a census only when ONEUPTIME_NETWORK_CENSUS=1", () => {
    const setup: string = fs.readFileSync(
      path.join(COMMON_ROOT, "Tests", "jest.setup.ts"),
      "utf8",
    );

    expect(setup).toContain(
      'import {\n  CENSUS_ENVIRONMENT_VARIABLE,\n  refuseRealRequests,\n} from "./Helpers/RealNetworkRequests";',
    );
    expect(setup).toContain(
      'refuseRealRequests({\n  census: process.env[CENSUS_ENVIRONMENT_VARIABLE] === "1",\n});',
    );
  });
});
