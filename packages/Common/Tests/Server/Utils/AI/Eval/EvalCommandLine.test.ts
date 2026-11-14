import {
  EvalEnvironment,
  EvalUsageError,
  JUDGE_API_KEY_ENV,
  JUDGE_BASE_URL_ENV,
  MODEL_API_KEY_ENV,
  MODEL_BASE_URL_ENV,
  assertNoKeyArguments,
  describeModelOptions,
  getArgValue,
  hasFlag,
  parseLlmType,
  readJudgeOptions,
  readModelOptions,
  readPersonaFile,
  readPositiveInteger,
} from "../../../../../Server/Utils/AI/Eval/EvalCommandLine";
import { PinnedModelOptions } from "../../../../../Server/Utils/AI/Eval/PinnedModel";
import LlmType from "../../../../../Types/LLM/LlmType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * THE AI EVALS' COMMAND LINE (issue #6800): npm run ai-eval -- --replay and
 * npm run ai-benchmark name the model under test and, optionally, a judge of
 * its own, with --llm-type, --model and --base-url (and --judge-...). Keys
 * come from the environment only - an argument would sit in the shell's
 * history and in every process listing while the eval runs.
 *
 * Under test: how an argument is read (the last one given wins), the key
 * arguments refused before anything runs, the provider type read in any
 * case and an unknown one refused, the judge's options and their rules, the
 * description printed (never the key or the endpoint), and the positive
 * whole numbers --limit-style options take.
 */

const NO_ENV: EvalEnvironment = {};

describe("the environment variables a key and an endpoint come from", () => {
  test("are named once, and never change under the people who script them", () => {
    expect({
      MODEL_API_KEY_ENV,
      MODEL_BASE_URL_ENV,
      JUDGE_API_KEY_ENV,
      JUDGE_BASE_URL_ENV,
    }).toEqual({
      MODEL_API_KEY_ENV: "AI_EVAL_LLM_API_KEY",
      MODEL_BASE_URL_ENV: "AI_EVAL_LLM_BASE_URL",
      JUDGE_API_KEY_ENV: "AI_EVAL_JUDGE_API_KEY",
      JUDGE_BASE_URL_ENV: "AI_EVAL_JUDGE_BASE_URL",
    });
  });
});

describe("getArgValue and hasFlag", () => {
  test("reads --name=value, the last one given, or nothing", () => {
    expect(getArgValue(["--model=a"], "model")).toBe("a");
    expect(getArgValue(["--model=a", "--model=b"], "model")).toBe("b");
    expect(getArgValue(["--replay"], "model")).toBeUndefined();
    expect(getArgValue([], "model")).toBeUndefined();
  });

  test("keeps everything after the first '=': a URL with a query, an empty value", () => {
    expect(
      getArgValue(
        ["--base-url=https://llm.example/v1?api-version=2"],
        "base-url",
      ),
    ).toBe("https://llm.example/v1?api-version=2");
    expect(getArgValue(["--model="], "model")).toBe("");
  });

  test("never reads a longer argument that starts with the same name", () => {
    expect(getArgValue(["--model-name=x"], "model")).toBeUndefined();
    expect(getArgValue(["--judge-model=x"], "model")).toBeUndefined();
    expect(hasFlag(["--keys"], "key")).toBe(false);
    expect(hasFlag(["--judge-key=x"], "key")).toBe(false);
  });

  test("a flag is given alone or with a value", () => {
    expect(hasFlag(["--replay"], "replay")).toBe(true);
    expect(hasFlag(["--replay=yes"], "replay")).toBe(true);
    expect(hasFlag(["replay"], "replay")).toBe(false);
    expect(hasFlag([], "replay")).toBe(false);
  });
});

describe("assertNoKeyArguments", () => {
  test.each([
    ["--api-key=sk-123", MODEL_API_KEY_ENV, "--api-key"],
    ["--apikey=sk-123", MODEL_API_KEY_ENV, "--apikey"],
    ["--key=sk-123", MODEL_API_KEY_ENV, "--key"],
    ["--api-key", MODEL_API_KEY_ENV, "--api-key"],
    ["--judge-api-key=sk-456", JUDGE_API_KEY_ENV, "--judge-api-key"],
    ["--judge-apikey=sk-456", JUDGE_API_KEY_ENV, "--judge-apikey"],
    ["--judge-key=sk-456", JUDGE_API_KEY_ENV, "--judge-key"],
  ])(
    "refuses %p and names %p instead",
    (argument: string, variable: string, flag: string) => {
      expect(() => {
        return assertNoKeyArguments(["--replay", argument]);
      }).toThrow(
        `Pass the API key in the ${variable} environment variable, not as ${flag}: an argument stays in the shell's history and shows in the process list.`,
      );
    },
  );

  test("the refusal never repeats the key it was given", () => {
    let message: string = "";

    try {
      assertNoKeyArguments(["--api-key=sk-live-SECRET"]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("sk-live-SECRET");
  });

  test("lets every other argument through", () => {
    expect(() => {
      return assertNoKeyArguments([
        "--replay",
        "--llm-type=Anthropic",
        "--model=claude-opus-5-5",
        "--base-url=http://localhost:8000",
        "--judge-llm-type=OpenAI",
        "--limit=5",
      ]);
    }).not.toThrow();
  });

  test("reading the model or the judge refuses a key argument too, before anything else", () => {
    expect(() => {
      return readModelOptions(
        ["--llm-type=Anthropic", "--api-key=sk-123"],
        NO_ENV,
      );
    }).toThrow(MODEL_API_KEY_ENV);
    expect(() => {
      return readJudgeOptions(["--judge-key=sk-456"], NO_ENV);
    }).toThrow(JUDGE_API_KEY_ENV);
  });
});

describe("parseLlmType", () => {
  test("reads every provider type in any case, with spaces around it", () => {
    for (const llmType of Object.values(LlmType)) {
      expect(parseLlmType(llmType)).toBe(llmType);
      expect(parseLlmType(llmType.toUpperCase())).toBe(llmType);
      expect(parseLlmType(` ${llmType.toLowerCase()} `)).toBe(llmType);
    }

    expect(parseLlmType("anthropic")).toBe(LlmType.Anthropic);
    expect(parseLlmType("openaicompatible")).toBe(LlmType.OpenAICompatible);
  });

  test("refuses one it does not know, and names the ones it does", () => {
    expect(() => {
      return parseLlmType("Claude");
    }).toThrow(
      `Unknown LLM type "Claude". Use one of: ${Object.values(LlmType).join(", ")}.`,
    );
    expect(() => {
      return parseLlmType("");
    }).toThrow("Unknown LLM type");
  });
});

describe("readModelOptions", () => {
  test("the model under test, from the arguments and the environment", () => {
    expect(
      readModelOptions(
        [
          "--replay",
          "--llm-type=anthropic",
          "--model=claude-opus-5-5",
          "--base-url=https://llm.example/v1",
        ],
        { [MODEL_API_KEY_ENV]: "sk-ant-eval" },
      ),
    ).toEqual({
      llmType: LlmType.Anthropic,
      modelName: "claude-opus-5-5",
      baseUrl: "https://llm.example/v1",
      apiKey: "sk-ant-eval",
    });
  });

  test("names nothing it was not given: the provider's default model and endpoint, no key", () => {
    expect(readModelOptions(["--llm-type=OpenAI"], NO_ENV)).toEqual({
      llmType: LlmType.OpenAI,
      modelName: undefined,
      baseUrl: undefined,
      apiKey: undefined,
    });
  });

  test("the endpoint argument wins over the environment's, which stands in when there is none", () => {
    const env: EvalEnvironment = {
      [MODEL_BASE_URL_ENV]: "http://env.example:11434",
    };

    expect(
      readModelOptions(
        ["--llm-type=Ollama", "--base-url=http://arg.example:11434"],
        env,
      ).baseUrl,
    ).toBe("http://arg.example:11434");
    expect(readModelOptions(["--llm-type=Ollama"], env).baseUrl).toBe(
      "http://env.example:11434",
    );
    expect(
      readModelOptions(["--llm-type=Ollama", "--base-url=  "], env).baseUrl,
    ).toBe("http://env.example:11434");
  });

  test("blank values are left out, and values are trimmed", () => {
    const options: PinnedModelOptions = readModelOptions(
      ["--llm-type= Mistral ", "--model=  mistral-large  ", "--base-url="],
      { [MODEL_API_KEY_ENV]: "   ", [MODEL_BASE_URL_ENV]: "" },
    );

    expect(options).toEqual({
      llmType: LlmType.Mistral,
      modelName: "mistral-large",
      baseUrl: undefined,
      apiKey: undefined,
    });
  });

  test("never reads the judge's key or endpoint for the model under test", () => {
    const options: PinnedModelOptions = readModelOptions(
      ["--llm-type=OpenAI", "--judge-base-url=http://judge.example"],
      {
        [JUDGE_API_KEY_ENV]: "sk-judge",
        [JUDGE_BASE_URL_ENV]: "http://judge-env.example",
      },
    );

    expect(options.apiKey).toBeUndefined();
    expect(options.baseUrl).toBeUndefined();
  });

  test("without --llm-type, says how to name the model and where its key goes", () => {
    for (const argv of [
      [],
      ["--llm-type="],
      ["--llm-type=   "],
      ["--model=x"],
    ]) {
      expect(() => {
        return readModelOptions(argv, { [MODEL_API_KEY_ENV]: "sk-123" });
      }).toThrow(
        `Name the model to run with --llm-type=<${Object.values(LlmType).join("|")}> (and --model=<name>), with its key in ${MODEL_API_KEY_ENV}.`,
      );
    }
  });

  test("an unknown provider is refused", () => {
    expect(() => {
      return readModelOptions(["--llm-type=Gemini"], NO_ENV);
    }).toThrow('Unknown LLM type "Gemini"');
  });
});

describe("readJudgeOptions", () => {
  test("no judge named: the model under test grades its own answers", () => {
    expect(readJudgeOptions(["--llm-type=Anthropic"], NO_ENV)).toBeNull();
    expect(readJudgeOptions([], NO_ENV)).toBeNull();
    expect(readJudgeOptions(["--judge-llm-type=  "], NO_ENV)).toBeNull();
  });

  test("a judge of its own, from its own arguments and its own environment", () => {
    expect(
      readJudgeOptions(
        [
          "--llm-type=Ollama",
          "--model=qwen3",
          "--base-url=http://localhost:11434",
          "--judge-llm-type=anthropic",
          "--judge-model=claude-opus-5-5",
          "--judge-base-url=https://judge.example/v1",
        ],
        {
          [MODEL_API_KEY_ENV]: "sk-model",
          [JUDGE_API_KEY_ENV]: "sk-judge",
        },
      ),
    ).toEqual({
      llmType: LlmType.Anthropic,
      modelName: "claude-opus-5-5",
      baseUrl: "https://judge.example/v1",
      apiKey: "sk-judge",
    });
  });

  test("never borrows the model under test's model, endpoint or key", () => {
    expect(
      readJudgeOptions(
        [
          "--llm-type=OpenAI",
          "--model=gpt-5.6",
          "--base-url=https://model.example",
          "--judge-llm-type=OpenAI",
        ],
        {
          [MODEL_API_KEY_ENV]: "sk-model",
          [MODEL_BASE_URL_ENV]: "https://model-env.example",
        },
      ),
    ).toEqual({
      llmType: LlmType.OpenAI,
      modelName: undefined,
      baseUrl: undefined,
      apiKey: undefined,
    });
  });

  test("the judge's endpoint argument wins over its environment's", () => {
    const env: EvalEnvironment = {
      [JUDGE_BASE_URL_ENV]: "http://judge-env.example",
    };

    expect(
      readJudgeOptions(
        [
          "--judge-llm-type=Ollama",
          "--judge-base-url=http://judge-arg.example",
        ],
        env,
      )!.baseUrl,
    ).toBe("http://judge-arg.example");
    expect(readJudgeOptions(["--judge-llm-type=Ollama"], env)!.baseUrl).toBe(
      "http://judge-env.example",
    );
  });

  test("a judge's model or endpoint without its type is refused, not ignored", () => {
    for (const argv of [
      ["--judge-model=claude-opus-5-5"],
      ["--judge-base-url=https://judge.example"],
      ["--judge-llm-type=", "--judge-model=gpt-5.6"],
    ]) {
      expect(() => {
        return readJudgeOptions(argv, NO_ENV);
      }).toThrow(
        "--judge-model and --judge-base-url need --judge-llm-type=<type> too.",
      );
    }
  });

  test("a blank judge model or endpoint alone is nothing to refuse", () => {
    expect(
      readJudgeOptions(["--judge-model=", "--judge-base-url=  "], NO_ENV),
    ).toBeNull();
  });

  test("an unknown judge provider is refused", () => {
    expect(() => {
      return readJudgeOptions(["--judge-llm-type=Bard"], NO_ENV);
    }).toThrow('Unknown LLM type "Bard"');
  });
});

describe("describeModelOptions", () => {
  test("names the provider and the model, or the provider's default", () => {
    expect(
      describeModelOptions({
        llmType: LlmType.Anthropic,
        modelName: "claude-opus-5-5",
      }),
    ).toBe("Anthropic claude-opus-5-5");
    expect(describeModelOptions({ llmType: LlmType.Ollama })).toBe(
      "Ollama (its default model)",
    );
  });

  test("never prints the key or the endpoint", () => {
    const description: string = describeModelOptions({
      llmType: LlmType.OpenAICompatible,
      modelName: "qwen3-32b",
      apiKey: "sk-live-SECRET",
      baseUrl: "http://10.0.0.5:8000/v1",
    });

    expect(description).not.toContain("sk-live-SECRET");
    expect(description).not.toContain("10.0.0.5");
  });
});

describe("readPositiveInteger", () => {
  test("the fallback when the argument is not given", () => {
    expect(readPositiveInteger(["--replay"], "limit", 20)).toBe(20);
  });

  test("a positive whole number, the last one given", () => {
    expect(readPositiveInteger(["--limit=5"], "limit", 20)).toBe(5);
    expect(readPositiveInteger(["--limit=5", "--limit=7"], "limit", 20)).toBe(
      7,
    );
    expect(readPositiveInteger(["--limit=1e3"], "limit", 20)).toBe(1000);
  });

  test.each(["0", "-3", "2.5", "ten", "", "Infinity", "NaN"])(
    "refuses %p, and says what it got",
    (value: string) => {
      expect(() => {
        return readPositiveInteger([`--limit=${value}`], "limit", 20);
      }).toThrow(`--limit must be a positive whole number, got "${value}".`);
    },
  );
});

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  return undefined;
}

function unreadable(): string {
  throw new Error("ENOENT: no such file or directory");
}

describe("EvalUsageError", () => {
  test("is an Error, named for what it is, with the message as given", () => {
    const error: EvalUsageError = new EvalUsageError("Name the model.");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EvalUsageError);
    expect(error.name).toBe("EvalUsageError");
    expect(error.message).toBe("Name the model.");
  });

  /*
   * The command lines print a usage error's message alone, with no stack:
   * every refusal of a command line must be one.
   */
  test.each([
    [
      "a key given as an argument",
      (): unknown => {
        return assertNoKeyArguments(["--api-key=sk-x"]);
      },
    ],
    [
      "an unknown provider type",
      (): unknown => {
        return parseLlmType("Nope");
      },
    ],
    [
      "no model named",
      (): unknown => {
        return readModelOptions(["--replay"], NO_ENV);
      },
    ],
    [
      "a judge's model with no judge type",
      (): unknown => {
        return readJudgeOptions(["--judge-model=claude-opus-5-5"], NO_ENV);
      },
    ],
    [
      "a limit that is not a positive whole number",
      (): unknown => {
        return readPositiveInteger(["--limit=0"], "limit", 20);
      },
    ],
    [
      "a persona file that cannot be read",
      (): unknown => {
        return readPersonaFile(
          ["--persona-file=/drafts/missing.md"],
          unreadable,
        );
      },
    ],
    [
      "an empty persona file",
      (): unknown => {
        return readPersonaFile(["--persona-file=/drafts/empty.md"], () => {
          return "  \n\t ";
        });
      },
    ],
  ])("is what is thrown for %s", (_case: string, run: () => unknown) => {
    expect(thrownBy(run)).toBeInstanceOf(EvalUsageError);
  });
});

describe("readPersonaFile", () => {
  test("without --persona-file there is no file and no persona, and nothing is read", () => {
    let reads: number = 0;
    const read: (path: string) => string = (): string => {
      reads++;
      return "a persona";
    };

    expect(readPersonaFile(["--replay"], read)).toEqual({
      personaFile: undefined,
      persona: undefined,
    });
    expect(readPersonaFile(["--persona-file="], read)).toEqual({
      personaFile: undefined,
      persona: undefined,
    });
    expect(reads).toBe(0);
  });

  test("reads the file it names, the last one given, and trims what it holds", () => {
    const paths: Array<string> = [];

    expect(
      readPersonaFile(
        ["--persona-file=/drafts/first.md", "--persona-file=/drafts/second.md"],
        (path: string): string => {
          paths.push(path);
          return "\n  You are a careful SRE.\n\n";
        },
      ),
    ).toEqual({
      personaFile: "/drafts/second.md",
      persona: "You are a careful SRE.",
    });
    expect(paths).toEqual(["/drafts/second.md"]);
  });

  test("a file that cannot be read is named, with why", () => {
    expect(() => {
      return readPersonaFile(["--persona-file=/drafts/missing.md"], unreadable);
    }).toThrow(
      "--persona-file /drafts/missing.md cannot be read: ENOENT: no such file or directory",
    );
  });

  test("a file holding only spaces is refused: running on would score the code's persona instead", () => {
    expect(() => {
      return readPersonaFile(["--persona-file=/drafts/empty.md"], () => {
        return " \n ";
      });
    }).toThrow("--persona-file /drafts/empty.md is empty.");
  });

  test("reads from disk when given no reader", () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "persona-file-"),
    );
    const file: string = path.join(directory, "persona.md");

    try {
      fs.writeFileSync(file, "  Draft persona.  \n", "utf8");

      expect(readPersonaFile([`--persona-file=${file}`])).toEqual({
        personaFile: file,
        persona: "Draft persona.",
      });
      expect(
        thrownBy(() => {
          return readPersonaFile([
            `--persona-file=${path.join(directory, "missing.md")}`,
          ]);
        }),
      ).toBeInstanceOf(EvalUsageError);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
