/*
 * RunnerService.findByIdAndKey refuses a Runner key the repository ships.
 *
 * A Runner proves who it is to the runbook protocol (/runner-ingest: its
 * heartbeat, the jobs it claims with their secrets, the results it reports)
 * by its id and its key, and findByIdAndKey is the one lookup that protocol
 * makes (RunnerAuthorization). A key that is public in the repository -
 * blank, "secret", or a config.example.env placeholder - is refused there
 * before the table is read, whether or not a row holds it: a row from
 * before the write rule (ComponentKeyWrite) that was given one authenticates
 * nothing. A real key is looked up as before.
 *
 * The table is held in memory behind the real service, so the query the
 * lookup builds is the one that runs.
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

import RunnerService from "../../../Server/Services/RunnerService";
import Runner from "../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { afterEach, describe, expect, test } from "@jest/globals";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUNNER_ID: string = "22222222-2222-4222-8222-222222222222";
const REAL_KEY: string = "33333333-3333-4333-8333-333333333333";

const SHIPPED_KEYS: Array<[string, string]> = [
  ["the old fallback", "secret"],
  ["the placeholder", "please-change-this-to-random-value"],
  [
    "a bundled probe's placeholder",
    "probe-1-please-change-this-to-random-value",
  ],
  [
    "a placeholder with something added",
    "please-change-this-to-random-value-2",
  ],
  ["a padded placeholder", " please-change-this-to-random-value "],
  ["a padded fallback", " secret "],
  ["a key of spaces", "   "],
];

function runnerRow(key: string): StoredRow {
  return {
    _id: RUNNER_ID,
    projectId: PROJECT_ID,
    name: "Site A Runner",
    key: key,
    canRunRunbooks: true,
    canRunAiCommands: false,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("findByIdAndKey refuses a shipped key", () => {
  test.each(SHIPPED_KEYS)(
    "%s finds nothing, though a row holds exactly that key, and the table is not read",
    async (_label: string, key: string) => {
      const table: InMemoryTable = useInMemoryTable(RunnerService, [
        runnerRow(key),
      ]);

      const found: Runner | null = await RunnerService.findByIdAndKey({
        agentId: new ObjectID(RUNNER_ID),
        agentKey: key,
      });

      expect(found).toBeNull();
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  test("a real key finds its Runner, with what the protocol reads", async () => {
    const table: InMemoryTable = useInMemoryTable(RunnerService, [
      runnerRow(REAL_KEY),
    ]);

    const found: Runner | null = await RunnerService.findByIdAndKey({
      agentId: new ObjectID(RUNNER_ID),
      agentKey: REAL_KEY,
    });

    expect(found).not.toBeNull();
    expect(found!.id?.toString()).toBe(RUNNER_ID);
    expect(found!.projectId?.toString()).toBe(PROJECT_ID);
    expect(found!.canRunRunbooks).toBe(true);
    expect(table.repository.find).toHaveBeenCalled();
  });

  test("a real key that is not the Runner's finds nothing", async () => {
    useInMemoryTable(RunnerService, [runnerRow(REAL_KEY)]);

    const found: Runner | null = await RunnerService.findByIdAndKey({
      agentId: new ObjectID(RUNNER_ID),
      agentKey: "44444444-4444-4444-8444-444444444444",
    });

    expect(found).toBeNull();
  });

  test("an empty key finds nothing, as before", async () => {
    const table: InMemoryTable = useInMemoryTable(RunnerService, [
      runnerRow(REAL_KEY),
    ]);

    const found: Runner | null = await RunnerService.findByIdAndKey({
      agentId: new ObjectID(RUNNER_ID),
      agentKey: "",
    });

    expect(found).toBeNull();
    expect(table.repository.find).not.toHaveBeenCalled();
  });
});
