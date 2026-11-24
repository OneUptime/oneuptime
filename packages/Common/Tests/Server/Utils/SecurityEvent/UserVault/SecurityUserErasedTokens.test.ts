import SecurityUserErasureRequestService from "../../../../../Server/Services/SecurityUserErasureRequestService";
import SecurityUserErasedTokens, {
  ERASED_TOKENS_CACHE_TTL_MS,
  ERASED_TOKENS_FAILURE_TTL_MS,
  ErasedTokens,
  isTokenErased,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasedTokens";
import { SUPPRESSION_SETTLE_MS } from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * THE TOKENS THE USER VAULT REFUSES (#10908): every token of a project's
 * erasure requests, read once a minute a project, and - when they cannot be
 * read - every token at all, for a few seconds, so nobody is kept or named
 * while nobody knows who was erased.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000c1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000c2",
);
const TOKEN: string = "[HASHED:5e29db14e508e09a]";

let reads: number;
let answer: () => Promise<Set<string>>;

beforeEach(() => {
  reads = 0;
  answer = async (): Promise<Set<string>> => {
    return new Set<string>([TOKEN]);
  };
  SecurityUserErasedTokens.clearCache();
  jest
    .spyOn(SecurityUserErasureRequestService, "getErasedTokensOfProject")
    .mockImplementation(async (projectId: ObjectID): Promise<Set<string>> => {
      reads++;

      return projectId.toString() === PROJECT_ID.toString()
        ? await answer()
        : new Set<string>();
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a project's refused tokens", () => {
  test("are its erasure requests' tokens, and only its", async () => {
    expect(
      Array.from(
        (await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID)) || [],
      ),
    ).toEqual([TOKEN]);
    expect(
      Array.from(
        (await SecurityUserErasedTokens.getErasedTokens(OTHER_PROJECT_ID)) ||
          [],
      ),
    ).toEqual([]);
  });

  test("are read once a minute a project, then again", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-24T10:00:00.000Z") });

    await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);
    await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);
    expect(reads).toBe(1);

    jest.setSystemTime(
      new Date(
        new Date("2026-11-24T10:00:00.000Z").getTime() +
          ERASED_TOKENS_CACHE_TTL_MS +
          1,
      ),
    );
    await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);
    expect(reads).toBe(2);
  });

  test("batches that miss the cache together wait for one read", async () => {
    const answers: Array<ErasedTokens> = await Promise.all(
      Array.from({ length: 20 }, (): Promise<ErasedTokens> => {
        return SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);
      }),
    );

    expect(reads).toBe(1);
    expect(
      answers.every((answer: ErasedTokens): boolean => {
        return answer !== null && answer.has(TOKEN);
      }),
    ).toBe(true);
  });

  test("are read again at once when the project is forgotten: a request was just filed", async () => {
    await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);
    SecurityUserErasedTokens.forgetProject(PROJECT_ID);
    await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);

    expect(reads).toBe(2);
  });

  test("when they cannot be read, every token is refused - for a few seconds, then they are read again", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-24T10:00:00.000Z") });
    answer = async (): Promise<Set<string>> => {
      throw new Error("Postgres is down");
    };

    const erased: ErasedTokens =
      await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID);

    expect(erased).toBeNull();
    expect(isTokenErased("[HASHED:aaaaaaaaaaaaaaab]", erased)).toBe(true);

    // Within the failure's wait: still refused, not read again.
    expect(
      await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID),
    ).toBeNull();
    expect(reads).toBe(1);

    answer = async (): Promise<Set<string>> => {
      return new Set<string>();
    };
    jest.setSystemTime(
      new Date(
        new Date("2026-11-24T10:00:00.000Z").getTime() +
          ERASED_TOKENS_FAILURE_TTL_MS +
          1,
      ),
    );

    expect(
      Array.from(
        (await SecurityUserErasedTokens.getErasedTokens(PROJECT_ID)) || ["?"],
      ),
    ).toEqual([]);
    expect(reads).toBe(2);
  });
});

describe("whether a token is refused", () => {
  test("one of the refused tokens is; any other is not", () => {
    const erased: ErasedTokens = new Set<string>([TOKEN]);

    expect(isTokenErased(TOKEN, erased)).toBe(true);
    expect(isTokenErased("[HASHED:aaaaaaaaaaaaaaab]", erased)).toBe(false);
  });

  test("every token is, when the refused tokens could not be read", () => {
    expect(isTokenErased(TOKEN, null)).toBe(true);
  });

  test("the worker waits for every process to have heard: twice the time one takes", () => {
    expect(SUPPRESSION_SETTLE_MS).toBe(2 * ERASED_TOKENS_CACHE_TTL_MS);
    expect(ERASED_TOKENS_FAILURE_TTL_MS).toBeLessThan(
      ERASED_TOKENS_CACHE_TTL_MS,
    );
  });
});
