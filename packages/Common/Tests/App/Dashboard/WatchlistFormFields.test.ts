import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getWatchlistCreateFields,
  getWatchlistEditFields,
  getNewWatchlistSource,
  getWatchlistFormFeedId,
  getWatchlistHoldsDropdownOptions,
  getWatchlistImportScheduleOptions,
  getWatchlistSourceChoices,
  isNewWatchlistFollowingFeed,
  isNewWatchlistReadFromUrl,
  prepareNewWatchlist,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistFormFields";
import {
  DESCRIPTION_FIELD_TITLE,
  FEED_FIELD_TITLE,
  HOLDS_FIELD_PLACEHOLDER,
  HOLDS_FIELD_TITLE,
  IMPORT_SCHEDULE_FIELD_TITLE,
  IMPORT_URL_FIELD_PLACEHOLDER,
  IMPORT_URL_FIELD_TITLE,
  NAME_FIELD_PLACEHOLDER,
  NAME_FIELD_TITLE,
  SOURCE_FEED_TITLE,
  SOURCE_FIELD_TITLE,
  SOURCE_URL_TITLE,
  SOURCE_VALUES_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import WatchlistSourceRadio, {
  renderWatchlistSourceChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistSourceRadio";
import { getWatchlistHoldsKey } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsModel";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SECURITY_WATCHLIST_IMPORT_SCHEDULES,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";
import { ReactElement } from "react";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * THE CREATE WATCHLIST FORM, AND A LIST'S EDIT. Creating asks for a name
 * and what the list holds; a description and where the values come from -
 * a file at an address read on a schedule, or, for a kind a feed carries,
 * a threat intel feed - wait folded under More fields. Edit changes a
 * list's name, its description, the feed it follows and the address it is
 * read from - never what it holds or where its values come from. Every
 * field shows the shared rules' problem with it, in the reader's language.
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
    renderSourceChoice: renderWatchlistSourceChoice,
  });

  test("asks for a name and what it holds; the rest waits under More fields", () => {
    expect(fields.map(column)).toEqual([
      "name",
      "entityType",
      "description",
      "source",
      "threatIntelFeed",
      "importUrl",
      "importSchedule",
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
      IMPORT_URL_FIELD_TITLE,
      IMPORT_SCHEDULE_FIELD_TITLE,
    ]);

    // The two the form asks in the open; the rest a list rarely needs, folded.
    expect(byColumn(fields, "name").collapsibleSection).toBeUndefined();
    expect(byColumn(fields, "entityType").collapsibleSection).toBeUndefined();

    const folded: Array<Field> = [
      byColumn(fields, "description"),
      byColumn(fields, "source"),
      byColumn(fields, "threatIntelFeed"),
      byColumn(fields, "importUrl"),
      byColumn(fields, "importSchedule"),
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
      getWatchlistCreateFields({
        translator: GERMAN,
        renderSourceChoice: renderWatchlistSourceChoice,
      }),
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
    // An empty dropdown asks for its choice, rather than looking unfinished.
    expect(holds.placeholder).toBe(HOLDS_FIELD_PLACEHOLDER);
    expect(HOLDS_FIELD_PLACEHOLDER).toBe("Choose what the list holds");
    expect(GERMAN.translateText(HOLDS_FIELD_PLACEHOLDER)).toBe(
      "Inhalt der Liste auswählen",
    );
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

  test("where values come from is asked of every kind - a feed offered only for a kind a feed carries - keeping values by default", () => {
    const source: Field = byColumn(fields, "source");

    // Its choices follow what the list holds: a radio of its own.
    expect(source.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(source.defaultValue).toBe(SecurityWatchlistSource.Values);
    // One is always chosen: never marked (Optional).
    expect(source.hideOptionalLabel).toBe(true);
    // Any list can be read from an address, so the choice is always asked.
    expect(source.showIf).toBeUndefined();

    for (const type of SECURITY_WATCHLIST_ENTITY_TYPES) {
      const feedKind: boolean = [
        SecurityEntityType.IpAddress,
        SecurityEntityType.FileHash,
        SecurityEntityType.Domain,
        SecurityEntityType.Url,
      ].includes(type);

      expect({
        type,
        titles: getWatchlistSourceChoices(type).map(
          (choice: { title: string }): string => {
            return choice.title;
          },
        ),
      }).toEqual({
        type,
        titles: feedKind
          ? [SOURCE_VALUES_TITLE, SOURCE_URL_TITLE, SOURCE_FEED_TITLE]
          : [SOURCE_VALUES_TITLE, SOURCE_URL_TITLE],
      });
    }

    // The radio it draws is told the kind and the choice, and hands changes back.
    const changes: Array<unknown> = [];
    const element: ReactElement = source.getCustomElement!(
      values({
        entityType: SecurityEntityType.Domain,
        source: SecurityWatchlistSource.Url,
      }),
      {
        onChange: (value: unknown): void => {
          changes.push(value);
        },
      } as unknown as CustomElementProps,
    ) as ReactElement;

    expect(element.type).toBe(WatchlistSourceRadio);
    expect(element.props).toMatchObject({
      entityType: SecurityEntityType.Domain,
      value: SecurityWatchlistSource.Url,
    });
    (element.props as { onChange: (value: string) => void }).onChange(
      SecurityWatchlistSource.Values,
    );
    expect(changes).toEqual([SecurityWatchlistSource.Values]);

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
    expect(
      source.isAtDefault!(values({ source: SecurityWatchlistSource.Url })),
    ).toBe(false);
  });

  test("the address is asked only of a list read from one: a whole https address", () => {
    const address: Field = byColumn(fields, "importUrl");
    const reading: Record<string, unknown> = {
      name: "vip_users",
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.Url,
    };

    expect(address).toMatchObject({
      fieldType: FormFieldSchemaType.URL,
      placeholder: IMPORT_URL_FIELD_PLACEHOLDER,
      disableSpellCheck: true,
    });
    expect(IMPORT_URL_FIELD_PLACEHOLDER).toBe(
      "https://example.com/vip-users.csv",
    );
    expect(showIf(address, reading)).toBe(true);
    expect(
      showIf(address, { ...reading, source: SecurityWatchlistSource.Values }),
    ).toBe(false);
    expect(showIf(address, { ...reading, source: undefined })).toBe(false);
    expect(
      (address.required as (item: FormValues<SecurityWatchlist>) => boolean)(
        values(reading),
      ),
    ).toBe(true);

    expect(problem(address, reading)).toBe(
      SECURITY_WATCHLIST_MESSAGES.enterUrl.message,
    );
    expect(
      problem(address, { ...reading, importUrl: "http://example.com/a.csv" }),
    ).toBe(SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message);
    expect(
      problem(address, {
        ...reading,
        importUrl: "https://example.com/vip-users.csv",
      }),
    ).toBeNull();
  });

  test("an address's problem is in the reader's language", () => {
    const address: Field = byColumn(
      getWatchlistCreateFields({
        translator: GERMAN,
        renderSourceChoice: renderWatchlistSourceChoice,
      }),
      "importUrl",
    );

    expect(
      problem(address, {
        name: "vip_users",
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.Url,
        importUrl: "http://example.com/a.csv",
      }),
    ).toBe(GERMAN_WORDS[SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message]);
    expect(
      GERMAN_WORDS[SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message],
    ).toBeTruthy();
  });

  test("how often it is read: every hour, 6 hours or day, every hour unless chosen", () => {
    const schedule: Field = byColumn(fields, "importSchedule");

    expect(schedule.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(schedule.defaultValue).toBe(
      SecurityWatchlistImportSchedule.EveryHour,
    );
    expect(schedule.dropdownOptions).toEqual(
      getWatchlistImportScheduleOptions(),
    );
    expect(getWatchlistImportScheduleOptions()).toEqual(
      SECURITY_WATCHLIST_IMPORT_SCHEDULES.map(
        (value: SecurityWatchlistImportSchedule) => {
          return { label: value, value };
        },
      ),
    );
    expect(
      showIf(schedule, {
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.Url,
      }),
    ).toBe(true);
    expect(
      showIf(schedule, {
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.Values,
      }),
    ).toBe(false);
    expect(
      problem(schedule, {
        name: "vip_users",
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.Url,
        importUrl: "https://example.com/a.csv",
        importSchedule: "Every Minute",
      }),
    ).toBe(SECURITY_WATCHLIST_MESSAGES.chooseSchedule.message);
  });

  test("a feed chosen before the kind changed to one no feed carries reads as a list kept by hand, never an error", () => {
    const source: Field = byColumn(fields, "source");
    const left: Record<string, unknown> = {
      name: "vip_users",
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.ThreatIntelFeed,
    };

    expect(getNewWatchlistSource(values(left))).toBe(
      SecurityWatchlistSource.Values,
    );
    expect(problem(source, left)).toBeNull();

    const element: ReactElement = source.getCustomElement!(values(left), {
      onChange: (): void => {},
    } as unknown as CustomElementProps) as ReactElement;

    expect((element.props as { value: string }).value).toBe(
      SecurityWatchlistSource.Values,
    );

    // The same choice for a kind a feed carries is a feed, and asks for one.
    expect(
      getNewWatchlistSource(
        values({ ...left, entityType: SecurityEntityType.Domain }),
      ),
    ).toBe(SecurityWatchlistSource.ThreatIntelFeed);
    expect(
      getNewWatchlistSource(
        values({ ...left, source: SecurityWatchlistSource.Url }),
      ),
    ).toBe(SecurityWatchlistSource.Url);
  });

  test("a new list is read from an address only when chosen, for any kind", () => {
    for (const entityType of SECURITY_WATCHLIST_ENTITY_TYPES) {
      expect(
        isNewWatchlistReadFromUrl(
          values({ entityType, source: SecurityWatchlistSource.Url }),
        ),
      ).toBe(true);
    }

    expect(
      isNewWatchlistReadFromUrl(
        values({ entityType: SecurityEntityType.User }),
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

  test("a list that keeps its values sends no feed and no address, and says it keeps values", () => {
    const watchlist: SecurityWatchlist = prepareNewWatchlist(
      newList({
        entityType: SecurityEntityType.IpAddress,
        threatIntelFeedId: new ObjectID(FEED_ID),
        importUrl: "https://example.com/a.csv",
        importSchedule: SecurityWatchlistImportSchedule.EveryDay,
      }),
    );

    expect(watchlist.source).toBe(SecurityWatchlistSource.Values);
    expect(watchlist.threatIntelFeedId).toBeUndefined();
    expect(watchlist.importUrl).toBeUndefined();
    expect(watchlist.importSchedule).toBeUndefined();
  });

  test("a list read from an address keeps its address, every hour unless chosen, and no feed", () => {
    const watchlist: SecurityWatchlist = prepareNewWatchlist(
      newList({
        entityType: SecurityEntityType.IpAddress,
        source: SecurityWatchlistSource.Url,
        importUrl: "https://example.com/a.csv",
        threatIntelFeedId: new ObjectID(FEED_ID),
      }),
    );

    expect(watchlist.source).toBe(SecurityWatchlistSource.Url);
    expect(watchlist.importUrl).toBe("https://example.com/a.csv");
    expect(watchlist.importSchedule).toBe(
      SecurityWatchlistImportSchedule.EveryHour,
    );
    expect(watchlist.threatIntelFeedId).toBeUndefined();

    expect(
      prepareNewWatchlist(
        newList({
          entityType: SecurityEntityType.User,
          source: SecurityWatchlistSource.Url,
          importUrl: "https://example.com/a.csv",
          importSchedule: SecurityWatchlistImportSchedule.EveryDay,
        }),
      ).importSchedule,
    ).toBe(SecurityWatchlistImportSchedule.EveryDay);
  });

  test("a list that follows a feed sends no address", () => {
    const watchlist: SecurityWatchlist = prepareNewWatchlist(
      newList({
        entityType: SecurityEntityType.IpAddress,
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: new ObjectID(FEED_ID),
        importUrl: "https://example.com/a.csv",
        importSchedule: SecurityWatchlistImportSchedule.EveryDay,
      }),
    );

    expect(watchlist.importUrl).toBeUndefined();
    expect(watchlist.importSchedule).toBeUndefined();
    expect(watchlist.threatIntelFeedId?.toString()).toBe(FEED_ID);
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

  test("a list read from an address: its address and schedule too, asked in the open", () => {
    const fields: Array<Field> = getWatchlistEditFields({
      translator: ENGLISH,
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.Url,
    });

    expect(fields.map(column)).toEqual([
      "name",
      "importUrl",
      "importSchedule",
      "description",
    ]);

    const address: Field = byColumn(fields, "importUrl");

    expect(address.collapsibleSection).toBeUndefined();
    expect(address.showIf).toBeUndefined();
    expect(address.required).toBe(true);
    expect(
      byColumn(fields, "importSchedule").collapsibleSection,
    ).toBeUndefined();
    // The saved list's source is asked about: the form holds none.
    expect(problem(address, { name: "vip_users", importUrl: "nope" })).toBe(
      SECURITY_WATCHLIST_MESSAGES.urlNotAnAddress.message,
    );
    expect(
      problem(address, {
        name: "vip_users",
        importUrl: "https://example.com/a.csv",
      }),
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
