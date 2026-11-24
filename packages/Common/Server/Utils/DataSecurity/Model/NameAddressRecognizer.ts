import fs from "fs";
import path from "path";
import timers from "timers";
import { RecognizedEntity } from "../../../../Utils/DataSecurity/Model/RecognizedEntity";
import logger from "../../Logger";
import { EntityRecognizer } from "./EntityRecognizer";
import { ModelStoreBudget } from "./ModelBudget";
import {
  Chunk,
  decodeEntities,
  LABELS,
  planChunks,
  softmaxRows,
} from "./NameAddressDecoder";
import {
  checkModelFiles,
  ModelFilesCheck,
  MODEL_FILE_NAME,
  NAME_ADDRESS_MODEL,
  VOCABULARY_FILE_NAME,
} from "./NameAddressModelFiles";
import NameAddressModelThread, {
  ModelBatch,
  ModelBatchResult,
  ModelThreadOptions,
} from "./NameAddressModelThread";
import WordPieceTokenizer, { WordPieceToken } from "./WordPieceTokenizer";

/*
 * THE NAMES-AND-ADDRESSES MODEL, AS THE SCANNER RUNS IT.
 *
 * Each text is tokenized here (WordPieceTokenizer), cut into the chunks the
 * model reads (NameAddressDecoder.planChunks), and the chunks of consecutive
 * texts go to the model's thread in batches of at most MAX_BATCH_TOKENS
 * pieces. Before each batch the store's budget is asked whether it may start,
 * and after it the batch's time is charged; once it may not, the texts not
 * read whole are left out, and the budget knows how many. A text is read up
 * to MODEL_MAX_TEXT_LENGTH characters: the first of the scanner's windows,
 * and the most of one value a field keeps.
 *
 * The model loads once per process, lazily, on the first scan that needs it
 * (getNameAddressRecognizer), and its thread is released after ten minutes
 * without a batch. A server or probe without the model's files,
 * or one where they are not the pinned files, gets no recogniser and the
 * reason, and asks again after RETRY_AFTER_IN_MS; nothing is downloaded.
 * Nothing about a value - a token, an entity's text - is logged: a failure
 * is logged by what failed.
 */

export const MODEL_MAX_TEXT_LENGTH: number = 16_384;

// The most pieces in one batch (rows times the longest row), and the most rows.
export const MAX_BATCH_TOKENS: number = 1_024;
export const MAX_BATCH_ROWS: number = 16;

// How long a server waits before it tries to load a model that would not load.
export const RETRY_AFTER_IN_MS: number = 15 * 60 * 1000;

export type ModelRunner = (batch: ModelBatch) => Promise<ModelBatchResult>;

interface TextWork {
  text: string;
  tokens: Array<WordPieceToken>;
  probabilities: Float32Array;
  chunksLeft: number;
}

interface ChunkWork {
  work: TextWork;
  chunk: Chunk;
}

export class NameAddressRecognizer implements EntityRecognizer {
  private readonly tokenizer: WordPieceTokenizer;
  private readonly runner: ModelRunner;
  private readonly now: () => number;

  public constructor(data: {
    tokenizer: WordPieceTokenizer;
    runner: ModelRunner;
    now?: (() => number) | undefined;
  }) {
    this.tokenizer = data.tokenizer;
    this.runner = data.runner;
    this.now =
      data.now ||
      ((): number => {
        return performance.now();
      });
  }

  public async recognize(
    texts: ReadonlyArray<string>,
    budget: ModelStoreBudget,
  ): Promise<Map<string, Array<RecognizedEntity>>> {
    const found: Map<string, Array<RecognizedEntity>> = new Map();
    const works: Array<TextWork> = [];
    const chunks: Array<ChunkWork> = [];

    for (const text of new Set(texts)) {
      const bounded: string = text.slice(0, MODEL_MAX_TEXT_LENGTH);
      const tokens: Array<WordPieceToken> = this.tokenizer.tokenize(bounded);
      const planned: Array<Chunk> = planChunks(tokens);
      const work: TextWork = {
        text,
        tokens,
        probabilities: new Float32Array(tokens.length * LABELS.length),
        chunksLeft: planned.length,
      };

      works.push(work);

      if (planned.length === 0) {
        found.set(text, []);
        continue;
      }

      for (const chunk of planned) {
        chunks.push({ work, chunk });
      }
    }

    let next: number = 0;

    while (next < chunks.length) {
      if (!budget.canSpend()) {
        break;
      }

      const batch: Array<ChunkWork> = [chunks[next]!];
      let width: number = this.widthOf(chunks[next]!);

      next++;

      while (next < chunks.length && batch.length < MAX_BATCH_ROWS) {
        const nextWidth: number = Math.max(width, this.widthOf(chunks[next]!));

        if ((batch.length + 1) * nextWidth > MAX_BATCH_TOKENS) {
          break;
        }

        batch.push(chunks[next]!);
        width = nextWidth;
        next++;
      }

      const started: number = this.now();
      let result: ModelBatchResult | null = null;

      try {
        result = await this.runner(this.buildBatch(batch, width));
      } finally {
        // The time the model ran, as its thread measured it; else the wait for it.
        budget.charge(result?.elapsedInMs ?? this.now() - started);
      }

      this.takeProbabilities(batch, width, result);
    }

    for (const work of works) {
      if (work.chunksLeft === 0 && !found.has(work.text)) {
        found.set(
          work.text,
          decodeEntities({
            text: work.text.slice(0, MODEL_MAX_TEXT_LENGTH),
            tokens: work.tokens,
            probabilities: work.probabilities,
          }),
        );
      }
    }

    budget.noteValues({ toRead: works.length, read: found.size });

    return found;
  }

  // A chunk's row: its pieces with [CLS] before and [SEP] after.
  private widthOf(item: ChunkWork): number {
    return item.chunk.end - item.chunk.start + 2;
  }

  private buildBatch(batch: Array<ChunkWork>, width: number): ModelBatch {
    const rows: number = batch.length;
    const inputIds: BigInt64Array = new BigInt64Array(rows * width);
    const attentionMask: BigInt64Array = new BigInt64Array(rows * width);
    const pad: bigint = BigInt(this.tokenizer.padId);

    inputIds.fill(pad);

    batch.forEach((item: ChunkWork, row: number): void => {
      const base: number = row * width;
      const { start, end } = item.chunk;

      inputIds[base] = BigInt(this.tokenizer.clsId);
      attentionMask[base] = BigInt(1);

      for (let index: number = start; index < end; index++) {
        inputIds[base + 1 + index - start] = BigInt(
          item.work.tokens[index]!.id,
        );
        attentionMask[base + 1 + index - start] = BigInt(1);
      }

      inputIds[base + 1 + end - start] = BigInt(this.tokenizer.sepId);
      attentionMask[base + 1 + end - start] = BigInt(1);
    });

    return {
      inputIds,
      attentionMask,
      tokenTypeIds: new BigInt64Array(rows * width),
      rows,
      width,
    };
  }

  private takeProbabilities(
    batch: Array<ChunkWork>,
    width: number,
    result: ModelBatchResult,
  ): void {
    const labels: number = LABELS.length;

    if (result.labels !== labels) {
      throw new Error(
        `The model gave ${result.labels} labels for each piece; it has ${labels}.`,
      );
    }

    softmaxRows(result.logits, labels);

    batch.forEach((item: ChunkWork, row: number): void => {
      const { start, end, ownStart, ownEnd } = item.chunk;

      for (
        let index: number = Math.max(start, ownStart);
        index < Math.min(end, ownEnd);
        index++
      ) {
        const from: number = (row * width + 1 + index - start) * labels;

        item.work.probabilities.set(
          result.logits.subarray(from, from + labels),
          index * labels,
        );
      }

      item.work.chunksLeft--;
    });
  }
}

/*
 * ONCE PER PROCESS.
 *
 * The first scan that needs the model checks its files, reads its
 * vocabulary and starts its thread; every later scan of the process uses the
 * same. After IDLE_RELEASE_IN_MS without a batch the thread is ended, giving
 * its memory back, and the next batch starts it again - the files are not
 * checked twice.
 */
export type RecognizerAvailability =
  | { recognizer: EntityRecognizer }
  | {
      // Why there is none, in a sentence a scan's warning can carry.
      reason: string;
    };

// How long the model's thread stays after its last batch.
export const IDLE_RELEASE_IN_MS: number = 10 * 60 * 1000;

export interface LoadOptions {
  directory?: string | undefined;
  thread?: Partial<ModelThreadOptions> | undefined;
  idleReleaseInMs?: number | undefined;
}

interface ModelState {
  recognizer: NameAddressRecognizer;
  modelPath: string;
  options: LoadOptions;
  thread: NameAddressModelThread | null;
  starting: Promise<NameAddressModelThread> | null;
  idleTimer: NodeJS.Timeout | null;
}

export class ModelUnavailableError extends Error {}

let state: ModelState | null = null;
let loading: Promise<ModelState> | null = null;
let failure: { reason: string; at: number } | null = null;

async function ensureThread(
  current: ModelState,
): Promise<NameAddressModelThread> {
  if (current.thread && current.thread.isRunning) {
    return current.thread;
  }

  if (!current.starting) {
    current.starting = NameAddressModelThread.start({
      modelPath: current.modelPath,
      onNetworkAttempt: (api: string): void => {
        logger.error(
          `DataSecurity: the names-and-addresses model tried to reach the network (${api}); it was refused.`,
        );
      },
      ...(current.options.thread || {}),
    })
      .then((thread: NameAddressModelThread): NameAddressModelThread => {
        current.thread = thread;
        return thread;
      })
      .finally((): void => {
        current.starting = null;
      });
  }

  return await current.starting;
}

// Ends the thread once no batch has come for a while.
function touch(current: ModelState): void {
  if (current.idleTimer) {
    timers.clearTimeout(current.idleTimer);
  }

  current.idleTimer = timers.setTimeout((): void => {
    current.idleTimer = null;

    const thread: NameAddressModelThread | null = current.thread;

    current.thread = null;
    void thread?.close();
  }, current.options.idleReleaseInMs ?? IDLE_RELEASE_IN_MS);
  current.idleTimer.unref();
}

async function load(options: LoadOptions): Promise<ModelState> {
  const check: ModelFilesCheck = await checkModelFiles(options.directory);

  if (!check.isReady) {
    throw new ModelUnavailableError(check.reason);
  }

  const tokenizer: WordPieceTokenizer = new WordPieceTokenizer(
    await fs.promises.readFile(
      path.join(check.directory, VOCABULARY_FILE_NAME),
      "utf8",
    ),
  );
  const current: ModelState = {
    recognizer: null as unknown as NameAddressRecognizer,
    modelPath: path.join(check.directory, MODEL_FILE_NAME),
    options,
    thread: null,
    starting: null,
    idleTimer: null,
  };

  current.recognizer = new NameAddressRecognizer({
    tokenizer,
    runner: async (batch: ModelBatch): Promise<ModelBatchResult> => {
      const thread: NameAddressModelThread = await ensureThread(current);

      touch(current);

      try {
        return await thread.run(batch);
      } finally {
        touch(current);
      }
    },
  });

  // Started now, so a model that cannot run is known before a scan relies on it.
  await ensureThread(current);
  touch(current);

  logger.info(
    `DataSecurity: loaded the names-and-addresses model ${NAME_ADDRESS_MODEL.name} (${NAME_ADDRESS_MODEL.licence}).`,
  );

  return current;
}

/*
 * The process's recogniser, loaded on first use; or why there is none. A
 * failure is remembered for RETRY_AFTER_IN_MS, so a server without the model
 * does not look for it at every scan.
 */
export async function getNameAddressRecognizer(
  options: LoadOptions = {},
): Promise<RecognizerAvailability> {
  if (state) {
    return { recognizer: state.recognizer };
  }

  if (failure && Date.now() - failure.at < RETRY_AFTER_IN_MS) {
    return { reason: failure.reason };
  }

  if (!loading) {
    loading = load(options);
  }

  try {
    state = await loading;
    failure = null;
    return { recognizer: state.recognizer };
  } catch (error) {
    const reason: string =
      error instanceof ModelUnavailableError
        ? error.message
        : "the model could not start";

    if (!(error instanceof ModelUnavailableError)) {
      logger.error(
        `DataSecurity: the names-and-addresses model could not start: ${
          error instanceof Error ? error.message.slice(0, 300) : "unknown error"
        }`,
      );
    }

    failure = { reason, at: Date.now() };
    return { reason };
  } finally {
    loading = null;
  }
}

// Whether the process holds the model's thread now: tests, and diagnostics.
export function isNameAddressModelRunning(): boolean {
  return Boolean(state?.thread?.isRunning);
}

// Ends the model's thread and forgets everything: tests, and shutdown.
export async function closeNameAddressRecognizer(): Promise<void> {
  const current: ModelState | null = state;

  state = null;
  failure = null;
  loading = null;

  if (current) {
    if (current.idleTimer) {
      timers.clearTimeout(current.idleTimer);
    }

    const thread: NameAddressModelThread | null = current.thread;

    current.thread = null;
    await thread?.close();
  }
}
