/*
 * Scripts/OpenAPI/GenerateSpec.ts is the generator's first step: it builds
 * the OpenAPI spec from Common's models, writes it, and validates it with
 * @readme/openapi-parser before the provider is generated from it.
 *
 * validate() returns a union on `valid`: only an invalid result has
 * `errors`. GenerateSpec threw that bare `errors` array, and
 * GenerateProvider.ts prints `error.message` for an Error and "Unknown error"
 * for anything else - so a spec that failed validation stopped generation
 * without saying why. Under this suite's old tsconfig (strict: false) the
 * `errors` access did not even type-check: narrowing a union on a boolean
 * needs strictNullChecks.
 *
 * Common's spec builder and Logger are replaced here (the real builder loads
 * every model); the validator is the real one, reading real files.
 *
 * @readme/openapi-parser resolves from Scripts/node_modules, for this file
 * as for GenerateSpec.ts - one module, so a spy on it is what GenerateSpec
 * calls. It is deliberately not a dependency of the generator itself: a copy
 * in Scripts/TerraformProvider/node_modules would be a second module.
 */

import fs from "fs";
import os from "os";
import path from "path";
import * as OpenAPIParser from "@readme/openapi-parser";
import OpenAPI from "Common/Server/Utils/OpenAPI";
import Logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import {
  assertValidOpenAPISpec,
  generateOpenAPISpec,
  ValidOpenAPISpecResult,
} from "../../OpenAPI/GenerateSpec";

jest.mock("Common/Server/Utils/OpenAPI", () => {
  return {
    __esModule: true,
    default: { generateOpenAPISpec: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

const SPEC_PATH: string = "/specs/openapi.json";

const VALID_SPEC: JSONObject = {
  openapi: "3.0.0",
  info: { title: "OneUptime", version: "1.0.0" },
  paths: {
    "/monitor": {
      get: {
        summary: "List monitors",
        responses: { 200: { description: "The monitors." } },
      },
    },
  },
};

function invalidResult(
  overrides: Partial<{
    errors: Array<OpenAPIParser.ErrorDetails>;
    warnings: Array<OpenAPIParser.WarningDetails>;
    additionalErrors: number;
    specification: "OpenAPI" | "Swagger" | null;
  }> = {},
): OpenAPIParser.ValidationResult {
  return {
    valid: false,
    errors: overrides.errors || [
      { message: "REQUIRED must have required property 'info'" },
    ],
    warnings: overrides.warnings || [],
    additionalErrors: overrides.additionalErrors || 0,
    specification:
      overrides.specification === undefined
        ? "OpenAPI"
        : overrides.specification,
  };
}

function validResult(
  warnings: Array<OpenAPIParser.WarningDetails> = [],
): OpenAPIParser.ValidationResult {
  return { valid: true, warnings: warnings, specification: "OpenAPI" };
}

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw, and it did not.");
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject, and it resolved.");
}

describe("assertValidOpenAPISpec", () => {
  test("lets a valid result through", () => {
    expect(() => {
      assertValidOpenAPISpec(validResult(), SPEC_PATH);
    }).not.toThrow();
  });

  test("lets a valid result with warnings through: warnings do not stop generation", () => {
    expect(() => {
      assertValidOpenAPISpec(
        validResult([{ message: "Schema has no description." }]),
        SPEC_PATH,
      );
    }).not.toThrow();
  });

  test("throws an Error - not the errors array - for an invalid result", () => {
    const thrown: unknown = thrownBy(() => {
      assertValidOpenAPISpec(invalidResult(), SPEC_PATH);
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(Array.isArray(thrown)).toBe(false);
  });

  test("reads as the reason in the generator's log, not 'Unknown error'", () => {
    const thrown: unknown = thrownBy(() => {
      assertValidOpenAPISpec(invalidResult(), SPEC_PATH);
    });

    // GenerateProvider.ts's catch, word for word.
    const logged: string = `Failed to generate Terraform provider: ${
      thrown instanceof Error ? thrown.message : "Unknown error"
    }`;

    expect(logged).not.toContain("Unknown error");
    expect(logged).toContain("must have required property 'info'");
  });

  test("names every problem the parser found, and the file to look at", () => {
    const thrown: unknown = thrownBy(() => {
      assertValidOpenAPISpec(
        invalidResult({
          errors: [
            { message: "REQUIRED must have required property 'info'" },
            {
              message:
                'Missing $ref pointer "#/components/schemas/Monitor". Token "Monitor" does not exist.',
            },
          ],
        }),
        SPEC_PATH,
      );
    });
    const message: string = (thrown as Error).message;

    expect(message.startsWith("OpenAPI schema validation failed.")).toBe(true);
    expect(message).toContain("REQUIRED must have required property 'info'");
    expect(message).toContain(
      'Missing $ref pointer "#/components/schemas/Monitor".',
    );
    expect(message.endsWith(`The spec is at ${SPEC_PATH}.`)).toBe(true);
  });

  test("says how many more errors the parser stopped listing", () => {
    const thrown: unknown = thrownBy(() => {
      assertValidOpenAPISpec(invalidResult({ additionalErrors: 3 }), SPEC_PATH);
    });

    expect((thrown as Error).message).toContain("Plus an additional 3 errors.");
  });

  test("carries an invalid result's warnings too, after its errors", () => {
    const thrown: unknown = thrownBy(() => {
      assertValidOpenAPISpec(
        invalidResult({ warnings: [{ message: "Path has no operations." }] }),
        SPEC_PATH,
      );
    });
    const message: string = (thrown as Error).message;

    expect(message).toContain("We have also found some additional warnings:");
    expect(message.indexOf("Path has no operations.")).toBeGreaterThan(
      message.indexOf("must have required property 'info'"),
    );
  });

  test("calls a spec of no known kind an API definition", () => {
    const thrown: unknown = thrownBy(() => {
      assertValidOpenAPISpec(invalidResult({ specification: null }), SPEC_PATH);
    });

    expect(
      (thrown as Error).message.startsWith(
        "API definition schema validation failed.",
      ),
    ).toBe(true);
  });

  /*
   * Type-level: these compile only if the result narrows. `npm run compile`
   * and ts-jest both type-check this file, so losing strictNullChecks (or
   * the assertion signature) fails them, not just a runtime expectation.
   */
  test("narrows the result to its valid variant once it returns", () => {
    const result: OpenAPIParser.ValidationResult = validResult();

    assertValidOpenAPISpec(result, SPEC_PATH);

    const valid: ValidOpenAPISpecResult = result;
    const isValid: true = result.valid;

    expect(valid.warnings).toEqual([]);
    expect(isValid).toBe(true);
  });

  test("an invalid result's errors are reachable once `valid` is false", () => {
    const result: OpenAPIParser.ValidationResult = invalidResult();
    let messages: Array<string> = [];

    if (!result.valid) {
      messages = result.errors.map(
        (error: OpenAPIParser.ErrorDetails): string => {
          return error.message;
        },
      );
    }

    expect(messages).toEqual(["REQUIRED must have required property 'info'"]);
  });
});

describe("generateOpenAPISpec", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-openapi-"));
    jest.mocked(OpenAPI.generateOpenAPISpec).mockReset();
    jest.mocked(Logger.info).mockClear();
    jest.mocked(Logger.warn).mockClear();
    jest.mocked(Logger.error).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  test("writes the spec it builds, formatted, creating the directory, and says it is valid", async () => {
    jest.mocked(OpenAPI.generateOpenAPISpec).mockReturnValue(VALID_SPEC);
    const outputPath: string = path.join(workDir, "nested", "openapi.json");

    await generateOpenAPISpec(outputPath);

    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      JSON.stringify(VALID_SPEC, null, 2),
    );
    expect(Logger.info).toHaveBeenCalledWith("OpenAPI spec is valid.");
    expect(Logger.info).toHaveBeenCalledWith(
      `OpenAPI spec generated and saved to ${outputPath}`,
    );
    // compileErrors() says "but with warnings" even with none.
    expect(Logger.warn).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "no info",
      spec: { openapi: "3.0.0", paths: {} },
      problem: "must have required property 'info'",
    },
    {
      name: "an operation that has no responses",
      spec: {
        openapi: "3.0.0",
        info: { title: "OneUptime", version: "1.0.0" },
        paths: { "/monitor": { get: { summary: "List monitors" } } },
      },
      problem: "must have required property 'responses'",
    },
    {
      name: "a $ref to a schema that is not there",
      spec: {
        openapi: "3.0.0",
        info: { title: "OneUptime", version: "1.0.0" },
        paths: {
          "/monitor": {
            get: {
              responses: {
                200: {
                  description: "The monitors.",
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/Monitor" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      problem: 'Missing $ref pointer "#/components/schemas/Monitor"',
    },
  ])(
    "rejects a spec with $name, with an Error that names the problem",
    async ({ spec, problem }: { spec: JSONObject; problem: string }) => {
      jest.mocked(OpenAPI.generateOpenAPISpec).mockReturnValue(spec);
      const outputPath: string = path.join(workDir, "openapi.json");

      const rejection: unknown = await rejectionOf(
        generateOpenAPISpec(outputPath),
      );

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toContain(problem);
      expect((rejection as Error).message).toContain(
        `The spec is at ${outputPath}.`,
      );
      expect(Logger.info).not.toHaveBeenCalledWith("OpenAPI spec is valid.");
    },
  );

  test("leaves an invalid spec on disk, where the error says it is", async () => {
    const spec: JSONObject = { openapi: "3.0.0", paths: {} };
    jest.mocked(OpenAPI.generateOpenAPISpec).mockReturnValue(spec);
    const outputPath: string = path.join(workDir, "openapi.json");

    await rejectionOf(generateOpenAPISpec(outputPath));

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual(spec);
  });

  test("logs a valid spec's warnings and still succeeds", async () => {
    jest.mocked(OpenAPI.generateOpenAPISpec).mockReturnValue(VALID_SPEC);
    jest
      .spyOn(OpenAPIParser, "validate")
      .mockResolvedValueOnce(
        validResult([{ message: "Schema Monitor has no description." }]),
      );
    const outputPath: string = path.join(workDir, "openapi.json");

    await generateOpenAPISpec(outputPath);

    expect(Logger.warn).toHaveBeenCalledTimes(1);
    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Schema Monitor has no description."),
    );
    expect(Logger.info).toHaveBeenCalledWith("OpenAPI spec is valid.");
  });

  test("validates the file it wrote, not some other path", async () => {
    jest.mocked(OpenAPI.generateOpenAPISpec).mockReturnValue(VALID_SPEC);
    const validateSpy: jest.SpyInstance = jest.spyOn(OpenAPIParser, "validate");
    const outputPath: string = path.join(workDir, "openapi.json");

    await generateOpenAPISpec(outputPath);

    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledWith(outputPath);
  });
});
