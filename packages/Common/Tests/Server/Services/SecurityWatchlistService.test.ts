import SecurityWatchlistService, {
  getWrittenThreatIntelFeedId,
} from "../../../Server/Services/SecurityWatchlistService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SecurityWatchlists from "../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import {
  WatchlistReader,
  WatchlistReaderKind,
} from "../../../Types/SecurityEvent/SecurityWatchlistFilter";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROJECT'S WATCHLISTS, AS THEY ARE SAVED: each checked with the rules
 * the form shows (getSecurityWatchlistProblems), its name stored trimmed,
 * a list that follows a feed naming one of the project's feeds, a list read
 * from an address naming a whole https address and a schedule, at most
 * SECURITY_WATCHLISTS_PER_PROJECT_MAX a project - and a list a rule, a
 * monitor or a hunt reads by its name neither renamed nor deleted, the
 * refusal naming what reads it.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityWatchlist>,
  ) => Promise<OnCreate<SecurityWatchlist>>;
  onCreatePermitted: (onCreate: OnCreate<SecurityWatchlist>) => Promise<void>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityWatchlist>,
  ) => Promise<OnUpdate<SecurityWatchlist>>;
  onUpdatePermitted: (updateBy: UpdateBy<SecurityWatchlist>) => Promise<void>;
  onBeforeUpdateUniqueCheck: (
    updateBy: UpdateBy<SecurityWatchlist>,
  ) => Promise<void>;
  onBeforeDelete: (
    deleteBy: DeleteBy<SecurityWatchlist>,
  ) => Promise<OnDelete<SecurityWatchlist>>;
};

const service: HookCaller = SecurityWatchlistService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ROW_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const OTHER_ROW_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const FEED_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

function newList(
  values: Partial<Record<string, unknown>> = {},
): SecurityWatchlist {
  const model: SecurityWatchlist = new SecurityWatchlist();
  model.projectId = PROJECT_ID;
  model.name = "vip_users";
  model.entityType = SecurityEntityType.User;
  model.source = SecurityWatchlistSource.Values;
  Object.assign(model, values);
  return model;
}

function storedRow(
  values: Partial<Record<string, unknown>> = {},
): SecurityWatchlist {
  const model: SecurityWatchlist = newList(values);

  if (!model._id) {
    model._id = ROW_ID.toString();
  }

  return model;
}

let count: Spy;
let findFeed: Spy;

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  count = getJestSpyOn(SecurityWatchlistService, "countBy").mockResolvedValue(
    new PositiveNumber(3) as never,
  );

  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = FEED_ID.toString();
  findFeed = getJestSpyOn(
    ThreatIntelFeedService,
    "findOneById",
  ).mockResolvedValue(feed as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function create(data: SecurityWatchlist): Promise<OnCreate<SecurityWatchlist>> {
  return service.onBeforeCreate({ data, props: { isRoot: true } });
}

function update(
  data: JSONObject,
  rows: Array<SecurityWatchlist> = [storedRow()],
): Promise<OnUpdate<SecurityWatchlist>> {
  getJestSpyOn(
    SecurityWatchlistService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue(rows as never);

  return service.onBeforeUpdate({
    query: { _id: ROW_ID },
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<SecurityWatchlist>);
}

function uniqueCheck(
  data: JSONObject,
  rows: Array<SecurityWatchlist> = [storedRow()],
): Promise<void> {
  getJestSpyOn(
    SecurityWatchlistService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue(rows as never);

  return service.onBeforeUpdateUniqueCheck({
    query: { _id: ROW_ID },
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<SecurityWatchlist>);
}

function readers(byKey: Record<string, Array<WatchlistReader>>): Spy {
  return getJestSpyOn(SecurityWatchlists, "findReaders").mockResolvedValue(
    new Map(Object.entries(byKey)) as never,
  );
}

function rule(name: string): WatchlistReader {
  return { kind: WatchlistReaderKind.DetectionRule, id: name, name };
}

function monitor(name: string): WatchlistReader {
  return { kind: WatchlistReaderKind.Monitor, id: name, name };
}

function hunt(name: string): WatchlistReader {
  return { kind: WatchlistReaderKind.Hunt, id: name, name };
}

describe("the feed a write names", () => {
  test("its id column, or the relation a form's dropdown sends", () => {
    expect(
      getWrittenThreatIntelFeedId({ threatIntelFeedId: FEED_ID.toString() }),
    ).toBe(FEED_ID.toString());
    expect(
      getWrittenThreatIntelFeedId({
        threatIntelFeed: { _id: FEED_ID.toString() },
      }),
    ).toBe(FEED_ID.toString());
    expect(getWrittenThreatIntelFeedId({})).toBeUndefined();
    expect(getWrittenThreatIntelFeedId({ threatIntelFeedId: null })).toBeNull();
  });
});

describe("creating a watchlist", () => {
  test("a list kept by hand: its name and description stored trimmed", async () => {
    const data: SecurityWatchlist = newList({
      name: "  vip_users ",
      description: "  Executives and their assistants. ",
    });

    await create(data);

    expect(data.name).toBe("vip_users");
    expect(data.description).toBe("Executives and their assistants.");
    expect(count).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("a name a rule cannot write is refused, saying how a name is written", async () => {
    await expect(create(newList({ name: "vip-users" }))).rejects.toThrow(
      "Use letters, digits and underscores, starting with a letter, such as vip_users.",
    );
    await expect(create(newList({ name: "" }))).rejects.toThrow(
      "Enter a name, such as vip_users.",
    );
  });

  test("what it holds must be said", async () => {
    await expect(create(newList({ entityType: undefined }))).rejects.toThrow(
      "Choose what the watchlist holds.",
    );
    await expect(create(newList({ entityType: "Email" }))).rejects.toThrow(
      BadDataException,
    );
  });

  test("a list that follows a feed: the feed by its id, one of the project's", async () => {
    const data: SecurityWatchlist = newList({
      name: "tor_exits",
      entityType: SecurityEntityType.IpAddress,
      source: SecurityWatchlistSource.ThreatIntelFeed,
    });
    (data as unknown as JSONObject)["threatIntelFeed"] = {
      _id: FEED_ID.toString(),
    };

    await create(data);

    expect(data.threatIntelFeedId?.toString()).toBe(FEED_ID.toString());
    expect((data as unknown as JSONObject)["threatIntelFeed"]).toBeUndefined();
    expect(findFeed).toHaveBeenCalledWith({
      id: FEED_ID,
      select: { _id: true },
      props: { isRoot: true },
    });
  });

  test("a feed that is gone is refused", async () => {
    findFeed.mockResolvedValue(null as never);

    await expect(
      create(
        newList({
          entityType: SecurityEntityType.IpAddress,
          source: SecurityWatchlistSource.ThreatIntelFeed,
          threatIntelFeedId: FEED_ID,
        }),
      ),
    ).rejects.toThrow("Choose the threat intel feed to follow.");
  });

  test("a feed list with no feed, or of a kind no feed carries, is refused", async () => {
    await expect(
      create(
        newList({
          entityType: SecurityEntityType.IpAddress,
          source: SecurityWatchlistSource.ThreatIntelFeed,
        }),
      ),
    ).rejects.toThrow("Choose the threat intel feed to follow.");

    await expect(
      create(
        newList({
          entityType: SecurityEntityType.User,
          source: SecurityWatchlistSource.ThreatIntelFeed,
          threatIntelFeedId: FEED_ID,
        }),
      ),
    ).rejects.toThrow(
      "A threat intel feed carries IP addresses, file hashes, domains and URLs. Keep a list of anything else by hand.",
    );
  });

  test("a list kept by hand follows no feed: a feed it was sent is not kept", async () => {
    const data: SecurityWatchlist = newList({ threatIntelFeedId: FEED_ID });

    await create(data);

    expect(data.threatIntelFeedId).toBeUndefined();
    expect(findFeed).not.toHaveBeenCalled();
  });

  test("a project keeps at most 200 lists", async () => {
    count.mockResolvedValue(
      new PositiveNumber(SECURITY_WATCHLISTS_PER_PROJECT_MAX) as never,
    );

    await expect(create(newList())).rejects.toThrow(
      "A project keeps at most 200 watchlists. Delete the ones no rule reads any more.",
    );
  });
});

describe("changing a watchlist", () => {
  test("a new name is checked and trimmed, a description trimmed", async () => {
    const data: JSONObject = { name: " vip_people ", description: " Why. " };

    await update(data);

    expect(data["name"]).toBe("vip_people");
    expect(data["description"]).toBe("Why.");

    await expect(update({ name: "vip people" })).rejects.toThrow(
      "Use letters, digits and underscores",
    );
  });

  test("a list kept by hand follows no feed", async () => {
    await expect(
      update({ threatIntelFeedId: FEED_ID.toString() }),
    ).rejects.toThrow(
      "This watchlist keeps its own values, so it follows no feed. To follow a feed, create a watchlist that does.",
    );
  });

  test("a list that follows a feed may follow another, never none", async () => {
    const feedRow: SecurityWatchlist = storedRow({
      source: SecurityWatchlistSource.ThreatIntelFeed,
      entityType: SecurityEntityType.IpAddress,
      threatIntelFeedId: FEED_ID,
    });

    await update({ threatIntelFeedId: FEED_ID.toString() }, [feedRow]);
    expect(findFeed).toHaveBeenCalled();

    await expect(
      update({ threatIntelFeedId: null }, [feedRow]),
    ).rejects.toThrow("Choose the threat intel feed to follow.");
  });

  test("what a list holds and where its values come from take no update", () => {
    const model: SecurityWatchlist = new SecurityWatchlist();

    for (const column of ["entityType", "source", "valueCount", "projectId"]) {
      expect(model.getColumnAccessControlFor(column)?.update || []).toEqual([]);
    }
  });
});

describe("renaming a watchlist", () => {
  test("the same name in another case is no rename", async () => {
    const reading: Spy = readers({ vip_users: [rule("VIP")] });

    await uniqueCheck({ name: "VIP_Users" });

    expect(reading).not.toHaveBeenCalled();
  });

  test("a name another list of the project has is refused, whatever its case", async () => {
    readers({});
    const clash: SecurityWatchlist = storedRow({
      _id: OTHER_ROW_ID.toString(),
      name: "admins",
    });
    getJestSpyOn(SecurityWatchlistService, "findOneBy").mockResolvedValue(
      clash as never,
    );

    await expect(uniqueCheck({ name: "Admins" })).rejects.toThrow(
      "This project already has a watchlist named Admins.",
    );
  });

  test("a list rules, monitors or hunts read by its name keeps it: the refusal names each and what it is", async () => {
    getJestSpyOn(SecurityWatchlistService, "findOneBy").mockResolvedValue(
      null as never,
    );
    const reading: Spy = readers({
      vip_users: [
        rule("VIP sign-in"),
        monitor("VIP failures"),
        hunt("Weekly VIP review"),
      ],
    });

    await expect(uniqueCheck({ name: "vip_people" })).rejects.toThrow(
      "This watchlist is read by its name in: VIP sign-in (rule), VIP failures (monitor), Weekly VIP review (hunt). Change the name there first, then rename the list.",
    );
    expect(reading).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a list only a monitor reads keeps its name too", async () => {
    getJestSpyOn(SecurityWatchlistService, "findOneBy").mockResolvedValue(
      null as never,
    );
    readers({ vip_users: [monitor("VIP failures")] });

    await expect(uniqueCheck({ name: "vip_people" })).rejects.toThrow(
      "This watchlist is read by its name in: VIP failures (monitor).",
    );
  });

  test("a list nothing reads is renamed", async () => {
    getJestSpyOn(SecurityWatchlistService, "findOneBy").mockResolvedValue(
      null as never,
    );
    readers({ other_list: [rule("Other")] });

    await expect(uniqueCheck({ name: "vip_people" })).resolves.toBeUndefined();
  });

  test("two lists are never given one name in one update", async () => {
    await expect(
      uniqueCheck({ name: "same" }, [
        storedRow(),
        storedRow({ _id: OTHER_ROW_ID.toString(), name: "admins" }),
      ]),
    ).rejects.toThrow(
      "Two watchlists cannot have the same name. Rename one at a time.",
    );
  });

  test("an update that does not name it checks nothing", async () => {
    const rows: Spy = getJestSpyOn(
      SecurityWatchlistService,
      "findRowsAndHoldUpdateToThem",
    );

    await service.onBeforeUpdateUniqueCheck({
      query: { _id: ROW_ID },
      data: { description: "x" },
      props: { isRoot: true },
    } as unknown as UpdateBy<SecurityWatchlist>);

    expect(rows).not.toHaveBeenCalled();
  });
});

describe("deleting a watchlist", () => {
  function remove(
    rows: Array<SecurityWatchlist>,
  ): Promise<OnDelete<SecurityWatchlist>> {
    getJestSpyOn(
      SecurityWatchlistService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue(rows as never);

    return service.onBeforeDelete({
      query: { _id: ROW_ID },
      props: { isRoot: true },
    } as unknown as DeleteBy<SecurityWatchlist>);
  }

  test("a list still read is kept, and the refusal says what reads it", async () => {
    readers({
      vip_users: [rule("A"), monitor("B"), hunt("C"), rule("D")],
    });

    await expect(remove([storedRow()])).rejects.toThrow(
      "vip_users is still read by its name in: A (rule), B (monitor), C (hunt) and 1 more. Take it out of them first, then delete the list.",
    );
  });

  test("a list a hunt alone reads is kept", async () => {
    readers({ vip_users: [hunt("Weekly VIP review")] });

    await expect(remove([storedRow()])).rejects.toThrow(
      "vip_users is still read by its name in: Weekly VIP review (hunt).",
    );
  });

  test("a list nothing reads is deleted; each project's readers are found once", async () => {
    const reading: Spy = readers({ other: [rule("Other")] });

    await expect(
      remove([
        storedRow(),
        storedRow({ _id: OTHER_ROW_ID.toString(), name: "admins" }),
      ]),
    ).resolves.toMatchObject({ carryForward: null });
    expect(reading).toHaveBeenCalledTimes(1);
    expect(reading).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("a watchlist read from an address", () => {
  const ADDRESS: string = "https://example.com/vip-users.csv";

  function urlList(
    values: Partial<Record<string, unknown>> = {},
  ): SecurityWatchlist {
    return newList({
      source: SecurityWatchlistSource.Url,
      importUrl: ADDRESS,
      ...values,
    });
  }

  async function createAndPermit(
    data: SecurityWatchlist,
  ): Promise<OnCreate<SecurityWatchlist>> {
    const onCreate: OnCreate<SecurityWatchlist> = await create(data);
    await service.onCreatePermitted(onCreate);
    return onCreate;
  }

  test("is created with its address trimmed, read every hour unless it says otherwise, and read within a minute", async () => {
    const before: number = Date.now();
    const data: SecurityWatchlist = urlList({ importUrl: `  ${ADDRESS} ` });

    await createAndPermit(data);

    expect(data.importUrl).toBe(ADDRESS);
    expect(data.importSchedule).toBe(SecurityWatchlistImportSchedule.EveryHour);
    expect(data.nextImportAt).toBeInstanceOf(Date);
    expect(data.nextImportAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.nextImportAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("keeps the schedule it is given", async () => {
    const data: SecurityWatchlist = urlList({
      importSchedule: SecurityWatchlistImportSchedule.EveryDay,
    });

    await createAndPermit(data);

    expect(data.importSchedule).toBe(SecurityWatchlistImportSchedule.EveryDay);
  });

  test("an address that is not a whole https one, or carries a sign-in, is refused in the form's words", async () => {
    await expect(create(urlList({ importUrl: "" }))).rejects.toThrow(
      SECURITY_WATCHLIST_MESSAGES.enterUrl.message,
    );
    await expect(
      create(urlList({ importUrl: "http://example.com/vip.csv" })),
    ).rejects.toThrow(SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message);
    await expect(
      create(urlList({ importUrl: "https://me:secret@example.com/vip.csv" })),
    ).rejects.toThrow(SECURITY_WATCHLIST_MESSAGES.urlHasCredentials.message);
    await expect(
      create(urlList({ importSchedule: "Every Minute" })),
    ).rejects.toThrow(SECURITY_WATCHLIST_MESSAGES.chooseSchedule.message);
  });

  test("any other list reads no address, whatever its create named, and is never read", async () => {
    const data: SecurityWatchlist = newList({
      importUrl: ADDRESS,
      importSchedule: SecurityWatchlistImportSchedule.EveryDay,
    });

    await createAndPermit(data);

    expect(data.importUrl).toBeUndefined();
    expect(data.importSchedule).toBeUndefined();
    expect(data.nextImportAt).toBeUndefined();
  });

  test("a create a check refused starts no read", async () => {
    const data: SecurityWatchlist = urlList({ importUrl: "ftp://example.com" });
    const createBy: CreateBy<SecurityWatchlist> = {
      data,
      props: { isRoot: true },
    };

    await expect(service.onBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
    await service.onCreatePermitted({ createBy, carryForward: null });

    expect(data.nextImportAt).toBeUndefined();
  });

  test("when it is next read, and what its reads did, are OneUptime's to write", () => {
    const model: SecurityWatchlist = new SecurityWatchlist();

    for (const column of [
      "nextImportAt",
      "lastImportAt",
      "lastImportSucceededAt",
      "lastImportError",
      "lastImportErrorDetail",
      "lastImportLinesLeftOut",
    ]) {
      expect({
        column,
        create: model.getColumnAccessControlFor(column)?.create || [],
        update: model.getColumnAccessControlFor(column)?.update || [],
      }).toEqual({ column, create: [], update: [] });
    }

    // Its address and schedule are the list's to change, as its name is.
    for (const column of ["importUrl", "importSchedule"]) {
      expect(model.getColumnAccessControlFor(column)?.update).toEqual(
        model.getColumnAccessControlFor("name")?.update,
      );
    }
  });

  test("a new address or schedule is checked, and the list read again within a minute", async () => {
    const urlRow: SecurityWatchlist = storedRow({
      source: SecurityWatchlistSource.Url,
      importUrl: ADDRESS,
    });
    const data: JSONObject = {
      importUrl: " https://example.com/new.csv ",
      importSchedule: SecurityWatchlistImportSchedule.EverySixHours,
    };
    const rows: Spy = getJestSpyOn(
      SecurityWatchlistService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([urlRow] as never);
    const updateBy: UpdateBy<SecurityWatchlist> = {
      query: { _id: ROW_ID },
      data,
      props: { isRoot: true },
    } as unknown as UpdateBy<SecurityWatchlist>;

    await service.onBeforeUpdate(updateBy);
    await service.onUpdatePermitted(updateBy);

    expect(data["importUrl"]).toBe("https://example.com/new.csv");
    expect(data["nextImportAt"]).toBeInstanceOf(Date);
    expect(rows).toHaveBeenCalledWith(updateBy, { _id: true, source: true });
  });

  test("an update that leaves the address and schedule alone does not read the list again", async () => {
    getJestSpyOn(
      SecurityWatchlistService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      storedRow({ source: SecurityWatchlistSource.Url, importUrl: ADDRESS }),
    ] as never);
    const data: JSONObject = { description: "Read from HR." };
    const updateBy: UpdateBy<SecurityWatchlist> = {
      query: { _id: ROW_ID },
      data,
      props: { isRoot: true },
    } as unknown as UpdateBy<SecurityWatchlist>;

    await service.onBeforeUpdate(updateBy);
    await service.onUpdatePermitted(updateBy);

    expect(data["nextImportAt"]).toBeUndefined();
  });

  test("a bad address or schedule in an update is refused", async () => {
    const urlRow: SecurityWatchlist = storedRow({
      source: SecurityWatchlistSource.Url,
      importUrl: ADDRESS,
    });

    await expect(
      update({ importUrl: "http://example.com/x.csv" }, [urlRow]),
    ).rejects.toThrow(SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message);
    await expect(update({ importUrl: "" }, [urlRow])).rejects.toThrow(
      SECURITY_WATCHLIST_MESSAGES.enterUrl.message,
    );
    await expect(
      update({ importSchedule: "Every Minute" }, [urlRow]),
    ).rejects.toThrow(SECURITY_WATCHLIST_MESSAGES.chooseSchedule.message);
  });

  test("a list kept by hand, or following a feed, is given no address", async () => {
    await expect(update({ importUrl: ADDRESS }, [storedRow()])).rejects.toThrow(
      "Only a watchlist read from an address reads one. To read a list from an address, create a watchlist that does.",
    );
    await expect(
      update({ importSchedule: SecurityWatchlistImportSchedule.EveryDay }, [
        storedRow({
          source: SecurityWatchlistSource.ThreatIntelFeed,
          entityType: SecurityEntityType.IpAddress,
          threatIntelFeedId: FEED_ID,
        }),
      ]),
    ).rejects.toThrow("Only a watchlist read from an address reads one.");
  });

  test("a list read from an address follows no feed", async () => {
    await expect(
      update({ threatIntelFeedId: FEED_ID.toString() }, [
        storedRow({ source: SecurityWatchlistSource.Url, importUrl: ADDRESS }),
      ]),
    ).rejects.toThrow(
      "This watchlist is read from an address, so it follows no feed. To follow a feed, create a watchlist that does.",
    );
  });
});
