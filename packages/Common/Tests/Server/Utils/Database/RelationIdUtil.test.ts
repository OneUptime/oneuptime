import RelationIdUtil from "../../../../Server/Utils/Database/RelationIdUtil";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * Contract under test: a many-to-one reference reaches a service hook under
 * two spellings - the FK column (`siteId`, written by server-side callers)
 * and the serialised relation (`site`, which is what the dashboard's forms
 * post). Hooks that watched only one of them silently ignored every write
 * made through the other (OneUptime/oneuptime#2940).
 */

const SITE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SITE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SITE_KEYS: Array<string> = ["siteId", "site"];

describe("RelationIdUtil.isWritten", () => {
  it("sees the FK column", () => {
    expect(RelationIdUtil.isWritten(["siteId", "name"], SITE_KEYS)).toBe(true);
  });

  it("sees the relation key", () => {
    expect(RelationIdUtil.isWritten(["site", "name"], SITE_KEYS)).toBe(true);
  });

  it("sees a key even when its value clears the reference", () => {
    expect(RelationIdUtil.isWritten(["site"], SITE_KEYS)).toBe(true);
  });

  it("ignores payloads that touch neither", () => {
    expect(
      RelationIdUtil.isWritten(["name", "hostname", "sysName"], SITE_KEYS),
    ).toBe(false);
    expect(RelationIdUtil.isWritten([], SITE_KEYS)).toBe(false);
  });

  it("does not match a similarly named key", () => {
    expect(RelationIdUtil.isWritten(["parentSiteId"], SITE_KEYS)).toBe(false);
  });
});

describe("RelationIdUtil.read", () => {
  it("reads an ObjectID from the FK column", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { siteId: SITE_ID },
      SITE_KEYS,
    );
    expect(id?.toString()).toBe(SITE_ID.toString());
  });

  it("reads a plain id string from the FK column", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { siteId: SITE_ID.toString() },
      SITE_KEYS,
    );
    expect(id?.toString()).toBe(SITE_ID.toString());
  });

  it("reads _id out of a serialised relation", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { site: { _id: SITE_ID.toString(), name: "WB Unit 0664" } },
      SITE_KEYS,
    );
    expect(id?.toString()).toBe(SITE_ID.toString());
  });

  it("reads id out of a hydrated relation", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { site: { id: SITE_ID } },
      SITE_KEYS,
    );
    expect(id?.toString()).toBe(SITE_ID.toString());
  });

  it("prefers the FK column when a payload carries both", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { siteId: SITE_ID, site: { _id: OTHER_SITE_ID.toString() } },
      SITE_KEYS,
    );
    expect(id?.toString()).toBe(SITE_ID.toString());
  });

  it("falls through an empty FK column to the relation", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { siteId: null, site: { _id: OTHER_SITE_ID.toString() } },
      SITE_KEYS,
    );
    expect(id?.toString()).toBe(OTHER_SITE_ID.toString());
  });

  it("returns null when the reference is being cleared", () => {
    expect(RelationIdUtil.read({ siteId: null }, SITE_KEYS)).toBeNull();
    expect(RelationIdUtil.read({ site: null }, SITE_KEYS)).toBeNull();
    expect(RelationIdUtil.read({ siteId: "" }, SITE_KEYS)).toBeNull();
  });

  it("returns null for a relation object with no id in it", () => {
    expect(
      RelationIdUtil.read({ site: { name: "WB Unit 0664" } }, SITE_KEYS),
    ).toBeNull();
    expect(RelationIdUtil.read({ site: {} }, SITE_KEYS)).toBeNull();
  });

  it("returns null when the payload does not mention the reference", () => {
    expect(RelationIdUtil.read({ name: "Core Switch" }, SITE_KEYS)).toBeNull();
    expect(RelationIdUtil.read({}, SITE_KEYS)).toBeNull();
    expect(RelationIdUtil.read(null, SITE_KEYS)).toBeNull();
    expect(RelationIdUtil.read(undefined, SITE_KEYS)).toBeNull();
  });

  it("works for any reference, not just sites", () => {
    const id: ObjectID | null = RelationIdUtil.read(
      { parentSite: { _id: SITE_ID.toString() } },
      ["parentSiteId", "parentSite"],
    );
    expect(id?.toString()).toBe(SITE_ID.toString());
  });
});

/*
 * readConsistent is how a check or a decision reads a reference: both names,
 * and a write whose two names disagree is refused, because which of the two
 * TypeORM stores depends on the shape of the write.
 */
describe("RelationIdUtil.readConsistent", () => {
  const CONFLICT: string =
    "Conflicting Network Site references were provided. siteId and site are names for the same field and must hold the same value: send only one of them, or the same id in each.";

  function read(data: Record<string, unknown> | null): ObjectID | null {
    return RelationIdUtil.readConsistent(data, SITE_KEYS, "Network Site");
  }

  it("reads the ID column alone", () => {
    expect(read({ siteId: SITE_ID })?.toString()).toBe(SITE_ID.toString());
  });

  it("reads the relation alone, in every shape it arrives in", () => {
    expect(read({ site: { _id: SITE_ID.toString() } })?.toString()).toBe(
      SITE_ID.toString(),
    );
    expect(read({ site: SITE_ID.toString() })?.toString()).toBe(
      SITE_ID.toString(),
    );
    expect(read({ site: SITE_ID })?.toString()).toBe(SITE_ID.toString());
    expect(read({ site: { id: SITE_ID } })?.toString()).toBe(
      SITE_ID.toString(),
    );
  });

  it("reads the same id under both names as one id", () => {
    expect(
      read({ siteId: SITE_ID, site: { _id: SITE_ID.toString() } })?.toString(),
    ).toBe(SITE_ID.toString());
  });

  it("reads one id in two cases as one id", () => {
    expect(
      read({
        siteId: SITE_ID.toString().toUpperCase(),
        site: { _id: SITE_ID.toString() },
      })?.toString(),
    ).toBe(SITE_ID.toString().toUpperCase());
  });

  it("reads a padded id as the id the database holds, alone or beside a clean one", () => {
    const padded: string = `  ${SITE_ID.toString()} `;

    expect(read({ siteId: padded })?.toString()).toBe(SITE_ID.toString());
    expect(
      read({ siteId: padded, site: { _id: SITE_ID.toString() } })?.toString(),
    ).toBe(SITE_ID.toString());
    expect(read({ site: { _id: padded } })?.toString()).toBe(
      SITE_ID.toString(),
    );
  });

  it("refuses two different ids, naming both fields", () => {
    expect(() => {
      return read({
        siteId: SITE_ID,
        site: { _id: OTHER_SITE_ID.toString() },
      });
    }).toThrow(CONFLICT);
  });

  it("refuses two different ids whichever name holds which", () => {
    expect(() => {
      return read({ siteId: OTHER_SITE_ID, site: SITE_ID.toString() });
    }).toThrow(CONFLICT);
  });

  it("refuses an id beside a clear: which one is stored depends on the write", () => {
    expect(() => {
      return read({ siteId: SITE_ID, site: null });
    }).toThrow(CONFLICT);
    expect(() => {
      return read({ siteId: null, site: { _id: SITE_ID.toString() } });
    }).toThrow(CONFLICT);
    expect(() => {
      return read({ siteId: SITE_ID, site: {} });
    }).toThrow(CONFLICT);
    expect(() => {
      return read({ siteId: "", site: { _id: SITE_ID.toString() } });
    }).toThrow(CONFLICT);
  });

  it("refuses with a BadDataException, so the API answers 400", () => {
    let error: unknown = null;

    try {
      read({ siteId: SITE_ID, site: { _id: OTHER_SITE_ID.toString() } });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BadDataException);
  });

  it("reads a clear under both names as a clear", () => {
    expect(read({ siteId: null, site: null })).toBeNull();
    expect(read({ site: null })).toBeNull();
  });

  it("reads nothing when the write leaves the reference alone", () => {
    expect(read({ name: "Core Switch" })).toBeNull();
    expect(read({ siteId: undefined, site: undefined })).toBeNull();
    expect(read(null)).toBeNull();
  });
});

describe("RelationIdUtil.isPresent", () => {
  it("sees a value under either name, a clear included", () => {
    expect(RelationIdUtil.isPresent({ siteId: SITE_ID }, SITE_KEYS)).toBe(true);
    expect(RelationIdUtil.isPresent({ site: null }, SITE_KEYS)).toBe(true);
  });

  it("reads values, not keys: a model's unset columns are not written", () => {
    expect(
      RelationIdUtil.isPresent(
        { siteId: undefined, site: undefined, name: "x" },
        SITE_KEYS,
      ),
    ).toBe(false);
    expect(RelationIdUtil.isPresent(null, SITE_KEYS)).toBe(false);
  });
});

describe("RelationIdUtil.stamp", () => {
  it("writes the id under the ID column and removes the relation", () => {
    const data: Record<string, unknown> = {
      site: { _id: OTHER_SITE_ID.toString() },
      name: "Core Switch",
    };

    RelationIdUtil.stamp(data, SITE_KEYS, SITE_ID);

    expect(data["siteId"]).toBe(SITE_ID);
    expect("site" in data).toBe(false);
    expect(data["name"]).toBe("Core Switch");
  });

  it("leaves one value for the reference, so reading it is consistent", () => {
    const data: Record<string, unknown> = {
      siteId: OTHER_SITE_ID,
      site: OTHER_SITE_ID.toString(),
    };

    RelationIdUtil.stamp(data, SITE_KEYS, SITE_ID);

    expect(
      RelationIdUtil.readConsistent(
        data,
        SITE_KEYS,
        "Network Site",
      )?.toString(),
    ).toBe(SITE_ID.toString());
  });

  it("can stamp a clear", () => {
    const data: Record<string, unknown> = { site: SITE_ID.toString() };

    RelationIdUtil.stamp(data, SITE_KEYS, null);

    expect(data["siteId"]).toBeNull();
    expect("site" in data).toBe(false);
  });
});

describe("RelationIdUtil.getConflictMessage", () => {
  it("names the reference and the fields the write sent", () => {
    expect(
      RelationIdUtil.getConflictMessage("Monitor Status", [
        "changeMonitorStatusToId",
        "changeMonitorStatusTo",
      ]),
    ).toBe(
      "Conflicting Monitor Status references were provided. changeMonitorStatusToId and changeMonitorStatusTo are names for the same field and must hold the same value: send only one of them, or the same id in each.",
    );
  });

  it("lists more than two names", () => {
    expect(
      RelationIdUtil.getConflictMessage("Thing", ["a", "b", "c"]),
    ).toContain("a, b and c are names for the same field");
  });
});
