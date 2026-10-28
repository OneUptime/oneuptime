import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getWatchlistCreateFields,
  getWatchlistEditFields,
  getWatchlistFormFeedId,
  getWatchlistHoldsDropdownOptions,
  getWatchlistSourceChoices,
  isNewWatchlistFollowingFeed,
  prepareNewWatchlist,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistFormFields";
import {
  DESCRIPTION_FIELD_TITLE,
  FEED_FIELD_TITLE,
  HOLDS_FIELD_TITLE,
  NAME_FIELD_PLACEHOLDER,
  NAME_FIELD_TITLE,
  SOURCE_FEED_TITLE,
  SOURCE_FIELD_TITLE,
  SOURCE_VALUES_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import { getWatchlistHoldsKey } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsModel";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * THE CREATE WATCHLIST FORM, AND A LIST'S EDIT. Creating asks for a name
 * and what the list holds; a description and, for a kind a feed carries,
 * following a threat intel feed wait folded under More fields. Edit
 * changes a list's name, its description and the feed it follows - never
 * what it holds or where its values come from. Every field shows the
 * shared rules' problem with it, in the reader's language.
 */

const FEED_ID: string = "33333333-3333-4333-8333-333333333333";

const ENGLISH: Translator = createTranslator(undefined, "en");

const GERMAN_WORDS: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

const GERMAN: Translator = createTranslator((key: string) => {
  return GERMAN_WORDS[key];
}, "de");

type Field = ModelField<SecurityWatchlist>;

function column(field: Field): string {
  return Object.keys(field.field || {})[0] || "";
}

function byColumn(list: Array<Field>, name: string): Field {
  const field: Field | undefined = list.find((candidate: Field): boolean => {
    return column(candidate) === name;
  });

  expect(field).toBeDefined();

  return field!;
}

function values(data: Record<string, unknown>): FormValues<SecurityWatchlist> {
  return data as FormValues<SecurityWatchlist>;
}

function problem(field: Field, data: Record<string, unknown>): string | null {
  expect(field.customValidation).toBeDefined();
  return field.customValidation!(values(data)) as string | null;
}

function showIf(field: Field, data: Record<string, unknown>): boolean {
  expect(field.showIf).toBeDefined();
  return field.showIf!(values(data));
}

describe("Create Watchlist", () => {
  const fields: Array<Field> = getWatchlistCreateFields({
    translator: ENGLISH,
  });

  test("asks for a name and what it holds; the rest waits under More fields", () => {
    expect(fields.map(column)).toEqual([
      "name",
      "entityType",
      "description",
      "source",
      "threatIntelFeed",
    ]);
    expect(
      fields.map((field: Field): string | undefined => {
        return field.title;
      }),
    ).toEqual([
      NAME_FIELD_TITLE,
      HOLDS_FIELD_TITLE,
      DESCRIPTION_FIELD_TITLE,
      SOURCE_FIELD_TITLE,
      FEED_FIELD_TITLE,
    ]);

    // The two the form asks in the open; the three a list rarely needs, folded.
    expect(byColumn(fields, "name").collapsibleSection).toBeUndefined();
    expect(byColumn(fields, "entityType").collapsibleSection).toBeUndefined();

    const folded: Array<Field> = [
      byColumn(fields, "description"),
      byColumn(fields, "source"),
      byColumn(fields, "threatIntelFeed"),
    ];

    for (const field of folded) {
      expect(field.collapsibleSection).toBeDefined();
      // One section, handed to every field that goes in it.
      expect(field.collapsibleSection).toBe(folded[0]!.collapsibleSection);
    }
  });

  test("the name is what rules write, with an example of one", () => {
    const name: Field = byColumn(fields, "name");

    expect(name).toMatchObject({
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: NAME_FIELD_PLACEHOLDER,
      disableSpellCheck: true,
    });
    expect(NAME_FIELD_PLACEHOLDER).toBe("vip_users");
    expect(problem(name, { name: "vip_users" })).toBeNull();
    expect(problem(name, { name: "" })).toBe(
      "Enter a name, such as vip_users.",
    );
    expect(problem(name, { name: "vip users" })).toBe(
      "Use letters, digits and underscores, starting with a letter, such as vip_users.",
    );
    expect(problem(name, { name: "n".repeat(51) })).toBe(
      "A name is at most 50 characters.",
    );
  });

  test("a field's problem is in the reader's language", () => {
    const name: Field = byColumn(
      getWatchlistCreateFields({ translator: GERMAN }),
      "name",
    );

    expect(problem(name, { name: "1st" })).toBe(
      GERMAN_WORDS[
        "Use letters, digits and underscores, starting with a letter, such as vip_users."
      ],
    );
    expect(problem(name, { name: "1st" })).toContain("vip_users");
    expect(problem(name, { name: "1st" })).not.toContain("Use letters");
  });

  test("Holds offers every kind, and asks for one", () => {
    const holds: Field = byColumn(fields, "entityType");

    expect(holds.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(holds.required).toBe(true);
    expect(holds.dropdownOptions).toEqual(getWatchlistHoldsDropdownOptions());
    expect(getWatchlistHoldsDropdownOptions()).toEqual(
      SECURITY_WATCHLIST_ENTITY_TYPES.map((type: SecurityEntityType) => {
        return { label: getWatchlistHoldsKey(type), value: type };
      }),
    );
    expect(problem(holds, { name: "x" })).toBe(
      "Choose what the watchlist holds.",
    );
    expect(
      problem(holds, { name: "x", entityType: SecurityEntityType.Host }),
    ).toBeNull();
  });

  test("a description is at most 500 characters", () => {
    const description: Field = byColumn(fields, "description");

    expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(description.required).toBe(false);
    expect(
      problem(description, {
        entityType: SecurityEntityType.User,
        description: "d".repeat(501),
      }),
    ).toBe("A description is at most 500 characters.");
    expect(
      problem(description, {
        entityType: SecurityEntityType.User,
        description: "d".repeat(500),
      }),
    ).toBeNull();
  });

  test("where values come from is offered only for a kind a feed carries, keeping values by default", () => {
    const source: Field = byColumn(fields, "source");

    expect(source.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(source.defaultValue).toBe(SecurityWatchlistSource.Values);
    expect(source.radioButtonOptions).toEqual(getWatchlistSourceChoices());
    expect(
      getWatchlistSourceChoices().map((choice: { title: string }) => {
        return choice.title;
      }),
    ).toEqual([SOURCE_VALUES_TITLE, SOURCE_FEED_TITLE]);

    for (const type of SECURITY_WATCHLIST_ENTITY_TYPES) {
      expect({ type, shown: showIf(source, { entityType: type }) }).toEqual({
        type,
        shown: [
          SecurityEntityType.IpAddress,
          SecurityEntityType.FileHash,
          SecurityEntityType.Domain,
          SecurityEntityType.Url,
        ].includes(type),
      });
    }

    // Folded, it says nothing while a list keeps its own values.
    expect(source.isAtDefault).toBeDefined();
    expect(
      source.isAtDefault!(values({ source: SecurityWatchlistSource.Values })),
    ).toBe(true);
    expect(
      source.isAtDefault!(
        values({ source: SecurityWatchlistSource.ThreatIntelFeed }),
      ),
    ).toBe(false);
  });

  test("the feed is asked only of a list that follows one", () => {
    const feed: Field = byColumn(fields, "threatIntelFeed");

    expect(feed.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(feed.dropdownModal).toMatchObject({
      type: ThreatIntelFeed,
      labelField: "name",
      valueField: "_id",
    });

    const following: Record<string, unknown> = {
      entityType: SecurityEntityType.Domain,
      source: SecurityWatchlistSource.ThreatIntelFeed,
    };

    expect(showIf(feed, following)).toBe(true);
    expect(
      showIf(feed, { ...following, source: SecurityWatchlistSource.Values }),
    ).toBe(false);
    // A kind no feed carries follows none, whatever the hidden choice says.
    expect(
      showIf(feed, { ...following, entityType: SecurityEntityType.User }),
    ).toBe(false);

    // Required while it is asked.
    expect(typeof feed.required).toBe("function");
    expect(
      (feed.required as (item: FormValues<SecurityWatchlist>) => boolean)(
        values(following),
      ),
    ).toBe(true);

    expect(problem(feed, { name: "bad_domains", ...following })).toBe(
      "Choose the threat intel feed to follow.",
    );
    expect(
      problem(feed, {
        name: "bad_domains",
        ...following,
        threatIntelFeed: FEED_ID,
      }),
    ).toBeNull();
  });

  test("the feed is read under either of its names", () => {
    expect(getWatchlistFormFeedId(values({ threatIntelFeed: FEED_ID }))).toBe(
      FEED_ID,
    );
    expect(
      getWatchlistFormFeedId(values({ threatIntelFeed: { _id: FEED_ID } })),
    ).toBe(FEED_ID);
    expect(getWatchlistFormFeedId(values({ threatIntelFeedId: FEED_ID }))).toBe(
      FEED_ID,
    );
    expect(getWatchlistFormFeedId(values({}))).toBeNull();
    expect(getWatchlistFormFeedId(values({ threatIntelFeed: {} }))).toBeNull();
  });

  test("a new list follows a feed only when chosen, for a kind a feed carries", () => {
    expect(
      isNewWatchlistFollowingFeed(
        values({
          entityType: SecurityEntityType.IpAddress,
          source: SecurityWatchlistSource.ThreatIntelFeed,
        }),
      ),
    ).toBe(true);
    expect(
      isNewWatchlistFollowingFeed(
        values({
          entityType: SecurityEntityType.Process,
          source: SecurityWatchlistSource.ThreatIntelFeed,
        }),
      ),
    ).toBe(false);
    expect(
      isNewWatchlistFollowingFeed(
        values({ entityType: SecurityEntityType.IpAddress }),
      ),
    ).toBe(false);
  });
});

describe("a new list as it is saved", () => {
  function newList(data: Partial<SecurityWatchlist>): SecurityWatchlist {
    const watchlist: SecurityWatchlist = new SecurityWatchlist();
    watchlist.name = "bad_addresses";
    Object.assign(watchlist, data);
    return watchlist;
  }

  test("a list that follows a feed keeps it", () => {
    const watchlist: SecurityWatchlist = prepareNewWatchlist(
      newList({
        entityType: SecurityEntityType.IpAddress,
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: new ObjectID(FEED_ID),
      }),
    );

    expect(watchlist.source).toBe(SecurityWatchlistSource.ThreatIntelFeed);
    expect(watchlist.threatIntelFeedId?.toString()).toBe(FEED_ID);
  });

  test("a feed chosen before the kind changed to one no feed carries is not sent", () => {
    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    feed._id = FEED_ID;

    const watchlist: SecurityWatchlist = prepareNewWatchlist(
      newList({
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeed: feed,
        threatIntelFeedId: new ObjectID(FEED_ID),
      }),
    );

    expect(watchlist.source).toBe(SecurityWatchlistSource.Values);
    expect(watchlist.threatIntelFeed).toBeUndefined();
    expect(watchlist.threatIntelFeedId).toBeUndefined();
    expect(watchlist.entityType).toBe(SecurityEntityType.User);
    expect(watchlist.name).toBe("bad_addresses");
  });

  test("a list that keeps its values sends no feed, and says it keeps values", () => {
    const watchlist: SecurityWatchlist = prepareNewWatchlist(
      newList({
        entityType: SecurityEntityType.IpAddress,
        threatIntelFeedId: new ObjectID(FEED_ID),
      }),
    );

    expect(watchlist.source).toBe(SecurityWatchlistSource.Values);
    expect(watchlist.threatIntelFeedId).toBeUndefined();
  });
});

describe("a list's Edit", () => {
  test("a list kept by hand: its name and description, nothing it chose once", () => {
    const fields: Array<Field> = getWatchlistEditFields({
      translator: ENGLISH,
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.Values,
    });

    expect(fields.map(column)).toEqual(["name", "description"]);
  });

  test("a list that follows a feed: its feed too, asked in the open", () => {
    const fields: Array<Field> = getWatchlistEditFields({
      translator: ENGLISH,
      entityType: SecurityEntityType.Domain,
      source: SecurityWatchlistSource.ThreatIntelFeed,
    });

    expect(fields.map(column)).toEqual([
      "name",
      "threatIntelFeed",
      "description",
    ]);

    const feed: Field = byColumn(fields, "threatIntelFeed");

    expect(feed.collapsibleSection).toBeUndefined();
    expect(feed.showIf).toBeUndefined();
    expect(feed.required).toBe(true);
    // The saved list's kind and source are asked about: the form holds neither.
    expect(problem(feed, { name: "bad_domains" })).toBe(
      "Choose the threat intel feed to follow.",
    );
    expect(
      problem(feed, { name: "bad_domains", threatIntelFeed: FEED_ID }),
    ).toBeNull();
  });

  test("the name is checked against the saved list", () => {
    const name: Field = byColumn(
      getWatchlistEditFields({
        translator: ENGLISH,
        entityType: SecurityEntityType.Host,
        source: SecurityWatchlistSource.Values,
      }),
      "name",
    );

    expect(problem(name, { name: "critical hosts" })).toBe(
      "Use letters, digits and underscores, starting with a letter, such as vip_users.",
    );
    expect(problem(name, { name: "critical_hosts" })).toBeNull();
  });

  test("a list read without its kind or source is asked about as Other, kept by hand", () => {
    const fields: Array<Field> = getWatchlistEditFields({
      translator: ENGLISH,
      entityType: undefined,
      source: undefined,
    });

    expect(fields.map(column)).toEqual(["name", "description"]);
    expect(problem(byColumn(fields, "name"), { name: "ok_name" })).toBeNull();
  });
});
