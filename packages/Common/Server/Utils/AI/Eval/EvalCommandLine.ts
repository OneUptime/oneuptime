import LlmType from "../../../../Types/LLM/LlmType";
import type { PinnedModelOptions } from "./PinnedModel";
import fs from "fs";

/*
 * The command line of the AI evals (npm run ai-eval -- --replay, npm run
 * ai-benchmark): which model runs, which one judges, and where their keys
 * come from.
 *
 *   --llm-type=<type>        the model under test's provider: OpenAI,
 *                            AzureOpenAI, Anthropic, Groq, Mistral, Ollama or
 *                            OpenAICompatible (any case)
 *   --model=<name>           its model; the provider's default when left out
 *   --base-url=<url>         its endpoint, for a self-hosted or compatible one
 *                            (or AI_EVAL_LLM_BASE_URL)
 *   --judge-llm-type=<type>  a different model to grade with; the model under
 *   --judge-model=<name>     test grades its own answers when left out
 *   --judge-base-url=<url>   (or AI_EVAL_JUDGE_BASE_URL)
 *   --persona-file=<path>    a draft persona to try in place of the code's
 *
 * Keys come from the environment only - AI_EVAL_LLM_API_KEY and
 * AI_EVAL_JUDGE_API_KEY - never from an argument, which would sit in the
 * shell's history and in every process listing while the eval runs.
 */

export const MODEL_API_KEY_ENV: string = "AI_EVAL_LLM_API_KEY";
export const MODEL_BASE_URL_ENV: string = "AI_EVAL_LLM_BASE_URL";
export const JUDGE_API_KEY_ENV: string = "AI_EVAL_JUDGE_API_KEY";
export const JUDGE_BASE_URL_ENV: string = "AI_EVAL_JUDGE_BASE_URL";

// Arguments that would put a key on the command line.
const KEY_ARGUMENTS: ReadonlyArray<string> = [
  "api-key",
  "apikey",
  "key",
  "judge-api-key",
  "judge-apikey",
  "judge-key",
];

export type EvalEnvironment = Record<string, string | undefined>;

/*
 * A command line the eval cannot run with: the CLIs print its message
 * alone, with no stack, as a usage hint is read.
 */
export class EvalUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvalUsageError";
  }
}

// --name=value's value, the last one given, or undefined.
export function getArgValue(
  argv: ReadonlyArray<string>,
  name: string,
): string | undefined {
  const prefix: string = `--${name}=`;
  let value: string | undefined = undefined;

  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      value = arg.substring(prefix.length);
    }
  }

  return value;
}

// Whether --name was given, alone or with a value.
export function hasFlag(argv: ReadonlyArray<string>, name: string): boolean {
  return argv.some((arg: string): boolean => {
    return arg === `--${name}` || arg.startsWith(`--${name}=`);
  });
}

// Refuses a key given as an argument, before anything runs with it.
export function assertNoKeyArguments(argv: ReadonlyArray<string>): void {
  for (const name of KEY_ARGUMENTS) {
    if (hasFlag(argv, name)) {
      const variable: string = name.startsWith("judge-")
        ? JUDGE_API_KEY_ENV
        : MODEL_API_KEY_ENV;

      throw new EvalUsageError(
        `Pass the API key in the ${variable} environment variable, not as --${name}: an argument stays in the shell's history and shows in the process list.`,
      );
    }
  }
}

export function parseLlmType(value: string): LlmType {
  const wanted: string = value.trim().toLowerCase();
  const match: LlmType | undefined = (
    Object.values(LlmType) as Array<LlmType>
  ).find((type: LlmType): boolean => {
    return type.toLowerCase() === wanted;
  });

  if (!match) {
    throw new EvalUsageError(
      `Unknown LLM type "${value}". Use one of: ${Object.values(LlmType).join(", ")}.`,
    );
  }

  return match;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed: string | undefined = value?.trim();
  return trimmed ? trimmed : undefined;
}

// The model under test, from the command line and the environment.
export function readModelOptions(
  argv: ReadonlyArray<string>,
  env: EvalEnvironment,
): PinnedModelOptions {
  assertNoKeyArguments(argv);

  const llmType: string | undefined = nonEmpty(getArgValue(argv, "llm-type"));

  if (!llmType) {
    throw new EvalUsageError(
      `Name the model to run with --llm-type=<${Object.values(LlmType).join("|")}> (and --model=<name>), with its key in ${MODEL_API_KEY_ENV}.`,
    );
  }

  return {
    llmType: parseLlmType(llmType),
    modelName: nonEmpty(getArgValue(argv, "model")),
    baseUrl:
      nonEmpty(getArgValue(argv, "base-url")) ||
      nonEmpty(env[MODEL_BASE_URL_ENV]),
    apiKey: nonEmpty(env[MODEL_API_KEY_ENV]),
  };
}

/*
 * The judge: a model of its own when --judge-llm-type names one, else null
 * (the model under test grades).
 */
export function readJudgeOptions(
  argv: ReadonlyArray<string>,
  env: EvalEnvironment,
): PinnedModelOptions | null {
  assertNoKeyArguments(argv);

  const llmType: string | undefined = nonEmpty(
    getArgValue(argv, "judge-llm-type"),
  );

  if (!llmType) {
    if (
      nonEmpty(getArgValue(argv, "judge-model")) ||
      nonEmpty(getArgValue(argv, "judge-base-url"))
    ) {
      throw new EvalUsageError(
        "--judge-model and --judge-base-url need --judge-llm-type=<type> too.",
      );
    }

    return null;
  }

  return {
    llmType: parseLlmType(llmType),
    modelName: nonEmpty(getArgValue(argv, "judge-model")),
    baseUrl:
      nonEmpty(getArgValue(argv, "judge-base-url")) ||
      nonEmpty(env[JUDGE_BASE_URL_ENV]),
    apiKey: nonEmpty(env[JUDGE_API_KEY_ENV]),
  };
}

// "Anthropic claude-opus-5-5", never the key or the endpoint.
export function describeModelOptions(options: PinnedModelOptions): string {
  return options.modelName
    ? `${options.llmType} ${options.modelName}`
    : `${options.llmType} (its default model)`;
}

export interface PersonaFileOption {
  personaFile: string | undefined;
  // The file's text, trimmed; undefined without --persona-file.
  persona: string | undefined;
}

/*
 * --persona-file: a draft persona to run in place of the one in the code.
 * A file that cannot be read, or holds nothing, is a usage error: running
 * on with the code's persona would score the wrong prompt.
 */
export function readPersonaFile(
  argv: ReadonlyArray<string>,
  readFile: (path: string) => string = (path: string): string => {
    return fs.readFileSync(path, "utf8");
  },
): PersonaFileOption {
  const personaFile: string | undefined = nonEmpty(
    getArgValue(argv, "persona-file"),
  );

  if (!personaFile) {
    return { personaFile: undefined, persona: undefined };
  }

  let text: string;

  try {
    text = readFile(personaFile);
  } catch (error) {
    throw new EvalUsageError(
      `--persona-file ${personaFile} cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const persona: string = text.trim();

  if (!persona) {
    throw new EvalUsageError(`--persona-file ${personaFile} is empty.`);
  }

  return { personaFile, persona };
}

// A positive whole number from --name=, or the fallback.
export function readPositiveInteger(
  argv: ReadonlyArray<string>,
  name: string,
  fallback: number,
): number {
  const value: string | undefined = getArgValue(argv, name);

  if (value === undefined) {
    return fallback;
  }

  const parsed: number = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EvalUsageError(
      `--${name} must be a positive whole number, got "${value}".`,
    );
  }

  return parsed;
}
