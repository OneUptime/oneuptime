import RelationIdUtil from "../../../../Server/Utils/Database/RelationIdUtil";
import ObjectID from "../../../../Types/ObjectID";

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
