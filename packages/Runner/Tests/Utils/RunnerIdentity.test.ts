/*
 * ---------------------------------------------------------------------------
 * Unit tests for RunnerIdentity.getRunnerId().
 *
 * The Runner's id has two sources and a strict precedence: the cluster-scoped
 * flow registers with the server and caches the assigned id in LocalCache,
 * while the project-scoped flow reads the ONEUPTIME_RUNNER_ID the dashboard
 * issued. The cache must win when both are present (a freshly registered id
 * supersedes a stale env value), and the absence of both must fail loudly
 * rather than silently minting an empty ObjectID — every code-fix request is
 * authenticated with this id.
 *
 * LocalCache is process-global module state, so each test resets the RUNNER
 * namespace key to empty (there is no delete) and restores process.env.
 * ---------------------------------------------------------------------------
 */

import RunnerIdentity from "../../Utils/RunnerIdentity";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";

const CACHE_NAMESPACE: string = "RUNNER";
const CACHE_KEY: string = "RUNNER_ID";

const ENV_ID: string = "11111111-1111-4111-8111-111111111111";
const CACHED_ID: string = "22222222-2222-4222-8222-222222222222";

let originalEnvId: string | undefined;

beforeEach(() => {
  originalEnvId = process.env["ONEUPTIME_RUNNER_ID"];
  // Clear any cached id (LocalCache has no delete; empty string is falsy).
  LocalCache.setString(CACHE_NAMESPACE, CACHE_KEY, "");
});

afterEach(() => {
  LocalCache.setString(CACHE_NAMESPACE, CACHE_KEY, "");
  if (originalEnvId === undefined) {
    delete process.env["ONEUPTIME_RUNNER_ID"];
  } else {
    process.env["ONEUPTIME_RUNNER_ID"] = originalEnvId;
  }
});

describe("RunnerIdentity.getRunnerId", () => {
  test("returns the id from ONEUPTIME_RUNNER_ID when nothing is cached", () => {
    process.env["ONEUPTIME_RUNNER_ID"] = ENV_ID;

    const id: ObjectID = RunnerIdentity.getRunnerId();

    expect(id).toBeInstanceOf(ObjectID);
    expect(id.toString()).toBe(ENV_ID);
  });

  test("returns the server-assigned id from LocalCache when it is set", () => {
    delete process.env["ONEUPTIME_RUNNER_ID"];
    LocalCache.setString(CACHE_NAMESPACE, CACHE_KEY, CACHED_ID);

    expect(RunnerIdentity.getRunnerId().toString()).toBe(CACHED_ID);
  });

  test("the cached (registered) id takes precedence over the env id", () => {
    process.env["ONEUPTIME_RUNNER_ID"] = ENV_ID;
    LocalCache.setString(CACHE_NAMESPACE, CACHE_KEY, CACHED_ID);

    expect(RunnerIdentity.getRunnerId().toString()).toBe(CACHED_ID);
  });

  test("throws BadDataException when neither cache nor env has an id", () => {
    delete process.env["ONEUPTIME_RUNNER_ID"];

    expect(() => {
      return RunnerIdentity.getRunnerId();
    }).toThrow(BadDataException);
  });

  test("the not-registered error message points the operator at registration", () => {
    delete process.env["ONEUPTIME_RUNNER_ID"];

    expect(() => {
      return RunnerIdentity.getRunnerId();
    }).toThrow(/has not finished registering/);
  });
});
