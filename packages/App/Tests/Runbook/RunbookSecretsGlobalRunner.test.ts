import RunbookSecretService from "Common/Server/Services/RunbookSecretService";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The sandbox's own code is not under test: only which secrets are read for
 * which step.
 */
jest.mock("Common/Server/Utils/VM/VMAPI", () => {
  return {
    __esModule: true,
    default: { replaceValueInPlace: jest.fn() },
  };
});

// Import AFTER the jest.mock call above (it is hoisted by jest).
import RunbookSecretsUtil from "../../FeatureSet/Runbook/Utils/Secrets";
import {
  getSecretNamesInScript,
  getSecretNamesNotIn,
} from "../../FeatureSet/Runbook/Utils/SecretNames";

/*
 * ---------------------------------------------------------------------------
 * Contract under test - which runbook secrets a step's script gets.
 *
 *   - On a project's own Runner: the secrets assigned to that Runner, of the
 *     Runner's own project only.
 *   - On a global Runner (one OneUptime runs for every project): the
 *     secrets of the STEP's own project that its people let global Runners
 *     use - read per step from the step's project, never from the Runner,
 *     which belongs to none. So a step of one project can never be handed
 *     another project's secret.
 *   - Which secrets a script names is read with the placeholder reader the
 *     sandbox fills them with, in time in line with the script's length.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000a1",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000b1",
);

type FindByArgs = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: { isRoot?: boolean };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("loading a step's secrets", () => {
  test("for a project's own Runner: the Runner's secrets, held to its own project", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(RunbookSecretService, "findBy")
      .mockResolvedValue([]);

    await RunbookSecretsUtil.loadForAgent({
      agentId: RUNNER_ID,
      projectId: PROJECT_ID,
    });

    const args: FindByArgs = findBy.mock.calls[0]![0] as FindByArgs;

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect(args.query).toHaveProperty("runners");
    expect(args.query).not.toHaveProperty("isAvailableToGlobalRunners");
    expect(args.select).toEqual({ secretValue: true, name: true });
    expect(args.props.isRoot).toBe(true);
  });

  test("for a global Runner: the step's project's secrets that global Runners may use, never read by Runner", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(RunbookSecretService, "findBy")
      .mockResolvedValue([]);

    await RunbookSecretsUtil.loadForGlobalRunnerJob({ projectId: PROJECT_ID });

    const args: FindByArgs = findBy.mock.calls[0]![0] as FindByArgs;

    expect(args.query).toEqual({
      projectId: PROJECT_ID,
      isAvailableToGlobalRunners: true,
    });
    expect(args.query).not.toHaveProperty("runners");
    expect(args.select).toEqual({ secretValue: true, name: true });
    expect(args.props.isRoot).toBe(true);
  });

  test("hands back exactly the rows it was given", async () => {
    const row: RunbookSecret = new RunbookSecret();
    row.name = "API_TOKEN";
    row.secretValue = "tok";
    jest.spyOn(RunbookSecretService, "findBy").mockResolvedValue([row]);

    await expect(
      RunbookSecretsUtil.loadForGlobalRunnerJob({ projectId: PROJECT_ID }),
    ).resolves.toEqual([row]);
  });
});

describe("getSecretNamesInScript", () => {
  test("reads each secret a script names, once, in order", () => {
    expect(
      getSecretNamesInScript(
        [
          "curl -H 'Authorization: {{runbookSecrets.API_TOKEN}}' $URL",
          "echo {{runbookSecrets.DB_PASSWORD}}",
          "echo {{runbookSecrets.API_TOKEN}} again",
        ].join("\n"),
      ),
    ).toEqual(["API_TOKEN", "DB_PASSWORD"]);
  });

  test("reads a placeholder written with spaces inside its braces", () => {
    expect(
      getSecretNamesInScript(
        "{{ runbookSecrets.API_TOKEN }} {{runbookSecrets. B }}",
      ),
    ).toEqual(["API_TOKEN", "B"]);
  });

  test("leaves every other placeholder alone", () => {
    expect(
      getSecretNamesInScript(
        "{{trigger}} {{inputs.host}} {{runbookSecrets}} {{runbookSecrets.}} {{secrets.X}}",
      ),
    ).toEqual([]);
  });

  test("reads nothing from nothing", () => {
    expect(getSecretNamesInScript("")).toEqual([]);
    expect(getSecretNamesInScript("return 1;")).toEqual([]);
    expect(getSecretNamesInScript(undefined as unknown as string)).toEqual([]);
  });

  test("never reads across a line: a placeholder left open is not one", () => {
    expect(getSecretNamesInScript("{{runbookSecrets.API_TOKEN\n}}")).toEqual(
      [],
    );
  });

  test.each([
    ["an unclosed opening, repeated", "{{".repeat(200_000)],
    [
      "an unclosed secret placeholder, repeated",
      "{{runbookSecrets.A".repeat(25_000),
    ],
    [
      "closed placeholders, back to back",
      "{{runbookSecrets.A}}".repeat(20_000),
    ],
    ["braces and dots", "{.{".repeat(140_000)],
    [
      "twenty thousand different secrets",
      Array.from({ length: 20_000 }, (_value: unknown, index: number) => {
        return `{{runbookSecrets.S${index}}}`;
      }).join(""),
    ],
  ])(
    "reads 400,000 characters of %s in time in line with their length",
    (_label: string, text: string) => {
      expect(text.length).toBeGreaterThanOrEqual(400_000);

      const started: number = Date.now();
      getSecretNamesInScript(text);

      expect(Date.now() - started).toBeLessThan(2000);
    },
  );
});

describe("getSecretNamesNotIn", () => {
  test("names the secrets a script uses that it may not have", () => {
    expect(
      getSecretNamesNotIn({
        script:
          "{{runbookSecrets.A}} {{runbookSecrets.B}} {{runbookSecrets.C}}",
        available: ["B"],
      }),
    ).toEqual(["A", "C"]);
  });

  test("names nothing when every secret it uses is there", () => {
    expect(
      getSecretNamesNotIn({
        script: "{{runbookSecrets.A}} {{runbookSecrets.A}}",
        available: ["A", "Z"],
      }),
    ).toEqual([]);
  });

  test("compares names exactly, as the substitution does", () => {
    expect(
      getSecretNamesNotIn({
        script: "{{runbookSecrets.api_token}}",
        available: ["API_TOKEN"],
      }),
    ).toEqual(["api_token"]);
  });
});
