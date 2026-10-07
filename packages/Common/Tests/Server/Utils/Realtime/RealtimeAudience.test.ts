import RealtimeAudience from "../../../../Server/Utils/Realtime/RealtimeAudience";
import RealtimeReaders, {
  RealtimeReaderIdentity,
} from "../../../../Server/Utils/Realtime/RealtimeReaders";
import {
  RealtimeReadAccess,
  RealtimeReader,
} from "../../../../Server/Utils/Realtime/RealtimeReadAccess";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Which of a batch's records each listener may read. Never throws: a
 * listener whose answer cannot be worked out reads none of them, so nobody
 * hears about a record nobody checked.
 */

const PROJECT: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECORD_A: string = "a0000000-0000-4000-8000-00000000000a";
const RECORD_B: string = "b0000000-0000-4000-8000-00000000000b";

function identity(userId: string): RealtimeReaderIdentity {
  return { userId: userId, isMasterAdmin: false };
}

function keyOf(userId: string): string {
  return RealtimeReaders.getKey(identity(userId), PROJECT);
}

// An access whose answers a test writes per person.
function accessWith(answers: {
  readsEveryRecord?: (userId: string) => Promise<boolean>;
  getReadableIds?: (
    userId: string,
    modelIds: Array<string>,
  ) => Promise<Array<string>>;
}): RealtimeReadAccess {
  return {
    readsEveryRecord: (reader: RealtimeReader): Promise<boolean> => {
      return (
        answers.readsEveryRecord ||
        (async (): Promise<boolean> => {
          return false;
        })
      )(reader.props.userId!.toString());
    },
    getReadableIds: (
      reader: RealtimeReader,
      modelIds: Array<ObjectID>,
    ): Promise<Array<string>> => {
      return (
        answers.getReadableIds ||
        (async (): Promise<Array<string>> => {
          return [];
        })
      )(
        reader.props.userId!.toString(),
        modelIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
    },
  };
}

describe("RealtimeAudience.getReadableIds", () => {
  beforeEach(() => {
    RealtimeReaders.clear();
    jest
      .spyOn(RealtimeReaders, "buildProps")
      .mockImplementation(
        async (
          reader: RealtimeReaderIdentity,
          projectId: string,
        ): Promise<DatabaseCommonInteractionProps | null> => {
          return {
            userId: new ObjectID(reader.userId),
            tenantId: new ObjectID(projectId),
          };
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    RealtimeReaders.clear();
  });

  test("a reader of every record reads the whole batch without a read", async () => {
    const reads: Array<string> = [];
    const user: string = ObjectID.generate().toString();

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        readsEveryRecord: async (): Promise<boolean> => {
          return true;
        },
        getReadableIds: async (userId: string): Promise<Array<string>> => {
          reads.push(userId);
          return [];
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A, RECORD_B, RECORD_A],
    });

    expect(Array.from(readable.get(keyOf(user))!).sort()).toEqual([
      RECORD_A,
      RECORD_B,
    ]);
    expect(reads).toEqual([]);
  });

  test("anyone else reads what their read finds, asked once for the distinct records", async () => {
    const user: string = ObjectID.generate().toString();
    const asked: Array<Array<string>> = [];

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        getReadableIds: async (
          _userId: string,
          modelIds: Array<string>,
        ): Promise<Array<string>> => {
          asked.push(modelIds);
          return [RECORD_B];
        },
      }),
      readers: [identity(user), identity(user)],
      modelIds: [RECORD_A, RECORD_B, RECORD_B],
    });

    expect(asked).toEqual([[RECORD_A, RECORD_B]]);
    expect(Array.from(readable.get(keyOf(user))!)).toEqual([RECORD_B]);
  });

  test("an answer that names records it was not asked about only counts the ones asked", async () => {
    const user: string = ObjectID.generate().toString();
    const stranger: string = ObjectID.generate().toString();

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        getReadableIds: async (): Promise<Array<string>> => {
          return [RECORD_A.toUpperCase(), stranger];
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A],
    });

    expect(Array.from(readable.get(keyOf(user))!)).toEqual([RECORD_A]);
  });

  test("whether someone reads every record failing to be known: they are asked record by record", async () => {
    const user: string = ObjectID.generate().toString();

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        readsEveryRecord: async (): Promise<boolean> => {
          throw new Error("Could not work it out");
        },
        getReadableIds: async (): Promise<Array<string>> => {
          return [RECORD_A];
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A, RECORD_B],
    });

    expect(Array.from(readable.get(keyOf(user))!)).toEqual([RECORD_A]);
  });

  test.each([
    ["a refused read", new NotAuthorizedException("No")],
    ["an expired session", new NotAuthenticatedException("No")],
    ["a plan that does not include it", new PaymentRequiredException("No")],
  ])("%s reads nothing, quietly", async (_case: string, error: Error) => {
    const user: string = ObjectID.generate().toString();
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        getReadableIds: async (): Promise<Array<string>> => {
          throw error;
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A],
    });

    expect(readable.get(keyOf(user))!.size).toBe(0);
    expect(logged).not.toHaveBeenCalled();
  });

  test("a full check queue reads nothing and says so", async () => {
    const user: string = ObjectID.generate().toString();
    const warned: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        getReadableIds: async (): Promise<Array<string>> => {
          throw new TooManyRequestsException("Busy");
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A],
    });

    expect(readable.get(keyOf(user))!.size).toBe(0);
    expect(warned).toHaveBeenCalledTimes(1);
  });

  test("any other failure reads nothing and is logged as an error", async () => {
    const user: string = ObjectID.generate().toString();
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        getReadableIds: async (): Promise<Array<string>> => {
          throw new Error("connection reset");
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A],
    });

    expect(readable.get(keyOf(user))!.size).toBe(0);
    expect(logged).toHaveBeenCalled();
  });

  test("someone who is no longer a member reads nothing, and their records are not read", async () => {
    const user: string = ObjectID.generate().toString();
    const reads: Array<string> = [];

    (RealtimeReaders.buildProps as unknown as jest.Mock).mockResolvedValue(
      null,
    );

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        readsEveryRecord: async (userId: string): Promise<boolean> => {
          reads.push(userId);
          return true;
        },
      }),
      readers: [identity(user)],
      modelIds: [RECORD_A],
    });

    expect(readable.get(keyOf(user))!.size).toBe(0);
    expect(reads).toEqual([]);
  });

  test(`at most READERS_AT_A_TIME people of a batch are worked out at once`, async () => {
    let inFlight: number = 0;
    let mostAtOnce: number = 0;

    const users: Array<string> = [];

    for (let i: number = 0; i < 12; i++) {
      users.push(ObjectID.generate().toString());
    }

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        getReadableIds: async (): Promise<Array<string>> => {
          inFlight++;
          mostAtOnce = Math.max(mostAtOnce, inFlight);
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 5);
          });
          inFlight--;
          return [RECORD_A];
        },
      }),
      readers: users.map(identity),
      modelIds: [RECORD_A],
    });

    expect(readable.size).toBe(12);
    expect(mostAtOnce).toBeLessThanOrEqual(RealtimeAudience.READERS_AT_A_TIME);
    expect(mostAtOnce).toBeGreaterThan(1);
  });

  test("an empty batch reads nothing for anyone", async () => {
    const user: string = ObjectID.generate().toString();
    const reads: Array<string> = [];

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: PROJECT,
      access: accessWith({
        readsEveryRecord: async (userId: string): Promise<boolean> => {
          reads.push(userId);
          return true;
        },
      }),
      readers: [identity(user)],
      modelIds: [],
    });

    expect(readable.get(keyOf(user))!.size).toBe(0);
    expect(reads).toEqual([]);
  });
});
