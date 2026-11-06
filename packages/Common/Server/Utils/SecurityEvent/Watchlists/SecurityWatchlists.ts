import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityWatchlist from "../../../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../../../Models/DatabaseModels/SecurityWatchlistItem";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { DetectionRuleDefinition } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import {
  SecurityWatchlistSource,
  SigmaWatchlist,
  SigmaWatchlists,
  getMissingSecurityWatchlistsMessage,
  getSecurityWatchlistFeedIndicatorTypes,
  getSecurityWatchlistNameKey,
  splitSecurityWatchlistValues,
} from "../../../../Types/SecurityEvent/SecurityWatchlist";
import {
  SigmaWatchlistReference,
  WatchlistReadingRule,
  bindSigmaWatchlists,
  getDetectionRuleWatchlistReferences,
  getMissingSigmaWatchlists,
  getRulesReadingWatchlists,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import DetectionRuleService from "../../../Services/DetectionRuleService";
import MonitorService from "../../../Services/MonitorService";
import SecurityHuntService from "../../../Services/SecurityHuntService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import SecurityHunt from "../../../../Models/DatabaseModels/SecurityHunt";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  WatchlistReader,
  WatchlistReaderKind,
} from "../../../../Types/SecurityEvent/SecurityWatchlistFilter";
import { getSecurityHuntWatchlistNames } from "../../../../Utils/SecurityEvent/SecurityHuntSearch";
import MonitorStepsReferenceExtractor from "../../Monitor/MonitorStepsReferenceExtractor";
import SecurityWatchlistItemService from "../../../Services/SecurityWatchlistItemService";
import SecurityWatchlistService from "../../../Services/SecurityWatchlistService";
import QueryHelper from "../../../Types/Database/QueryHelper";

/*
 * A PROJECT'S WATCHLISTS, AS ITS RULES READ THEM.
 *
 * A rule names a watchlist (`principalUser|expand: '%vip_users%'`); before
 * it is compiled - saved, run, run on past events, drafted by OneUptime AI -
 * the lists it names are read here and bound to it (bindSigmaWatchlists),
 * and the compiler turns each into the list's values (SecurityWatchlistMatch).
 *
 * Every read is the server's own (root): a rule's run is not a person's
 * request, and a person saving a rule may name a list without reading its
 * values. What reaches the rule is only what it names, in the rule's own
 * project.
 *
 * A reader remembers what it read, so one project's turn of the detection
 * engine reads each list once however many of its rules name it, and the
 * values it reads are the values of the turn: a list changed mid-turn
 * reaches the next turn's runs, a minute later.
 */

/*
 * A read, a save or a run that names a list the project does not have: the
 * words a rule's save uses, and a class of its own, so a hunt's run can say
 * so in its own.
 */
export class SecurityWatchlistMissingException extends BadDataException {
  public readonly names: Array<string>;

  public constructor(names: Array<string>) {
    super(getMissingSecurityWatchlistsMessage(names));
    this.names = names;
  }
}

export class SecurityWatchlistReader {
  private readonly byKey: Map<string, SigmaWatchlist | null> = new Map();

  public constructor(private readonly projectId: ObjectID) {}

  /*
   * The lists named, by name key: those the project has. A name the project
   * does not have is left out - getMissingSigmaWatchlists says which.
   */
  public async read(
    references: ReadonlyArray<SigmaWatchlistReference>,
  ): Promise<SigmaWatchlists> {
    const unread: Array<SigmaWatchlistReference> = references.filter(
      (reference: SigmaWatchlistReference): boolean => {
        return !this.byKey.has(reference.key);
      },
    );

    if (unread.length > 0) {
      const read: Map<string, SigmaWatchlist> = await SecurityWatchlists.load({
        projectId: this.projectId,
        names: unread.map((reference: SigmaWatchlistReference): string => {
          return reference.name;
        }),
      });

      for (const reference of unread) {
        this.byKey.set(reference.key, read.get(reference.key) || null);
      }
    }

    const watchlists: SigmaWatchlists = {};

    for (const reference of references) {
      const watchlist: SigmaWatchlist | null | undefined = this.byKey.get(
        reference.key,
      );

      if (watchlist) {
        watchlists[reference.key] = watchlist;
      }
    }

    return watchlists;
  }

  /*
   * The definition with the lists it names bound to its rules, or a refusal
   * naming each list the project does not have - the rule's error at a run,
   * and the answer to a save.
   */
  public async bind(
    definition: DetectionRuleDefinition,
  ): Promise<DetectionRuleDefinition> {
    const references: Array<SigmaWatchlistReference> =
      getDetectionRuleWatchlistReferences(definition);

    if (references.length === 0) {
      return definition;
    }

    const watchlists: SigmaWatchlists = await this.read(references);
    const missing: Array<string> = getMissingSigmaWatchlists(
      definition,
      watchlists,
    );

    if (missing.length > 0) {
      throw new SecurityWatchlistMissingException(missing);
    }

    return bindSigmaWatchlists(definition, watchlists);
  }
}

export default class SecurityWatchlists {
  // A reader for one project: one turn of the engine, one save, one run on past events.
  public static readerFor(projectId: ObjectID): SecurityWatchlistReader {
    return new SecurityWatchlistReader(projectId);
  }

  /*
   * Refuse names the project has no list of, naming each: what a monitor's
   * save and a hunt's save ask of the lists they read, as a rule's save
   * does. Only the names are read.
   */
  public static async assertProjectHas(data: {
    projectId: ObjectID;
    names: ReadonlyArray<string>;
  }): Promise<void> {
    if (data.names.length === 0) {
      return;
    }

    const watchlists: Array<SecurityWatchlist> =
      await SecurityWatchlistService.findAllBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameTextAnyOf(
            Array.from(new Set(data.names)),
          ),
        },
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

    const found: Set<string> = new Set(
      watchlists.map((watchlist: SecurityWatchlist): string => {
        return getSecurityWatchlistNameKey(watchlist.name);
      }),
    );

    // Each missing list named once, as it was first written.
    const missing: Array<string> = [];
    const named: Set<string> = new Set();

    for (const name of data.names) {
      const key: string = getSecurityWatchlistNameKey(name);

      if (!found.has(key) && !named.has(key)) {
        named.add(key);
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      throw new SecurityWatchlistMissingException(missing);
    }
  }

  /*
   * The project's lists of these names (whatever the case), each as a run
   * reads it, by name key: one read of the lists, and one of the values of
   * those kept by hand.
   */
  public static async load(data: {
    projectId: ObjectID;
    names: ReadonlyArray<string>;
    // When the lists are read: a value whose moment to leave has come is not on its list.
    now?: Date | undefined;
  }): Promise<Map<string, SigmaWatchlist>> {
    const result: Map<string, SigmaWatchlist> = new Map();
    const names: Array<string> = Array.from(
      new Set(
        data.names
          .map((name: string): string => {
            return name.trim();
          })
          .filter(Boolean),
      ),
    );

    if (names.length === 0) {
      return result;
    }

    const watchlists: Array<SecurityWatchlist> =
      await SecurityWatchlistService.findAllBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameTextAnyOf(names),
        },
        select: {
          _id: true,
          name: true,
          entityType: true,
          source: true,
          threatIntelFeedId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    // Values kept by hand or read from an address: the list's own rows.
    const keptByHand: Array<SecurityWatchlist> = watchlists.filter(
      (watchlist: SecurityWatchlist): boolean => {
        return watchlist.source !== SecurityWatchlistSource.ThreatIntelFeed;
      },
    );

    const valuesByWatchlist: Map<string, Array<string>> = new Map();

    if (keptByHand.length > 0) {
      const items: Array<SecurityWatchlistItem> =
        await SecurityWatchlistItemService.findAllBy({
          query: {
            projectId: data.projectId,
            securityWatchlistId: new Includes(
              keptByHand.map((watchlist: SecurityWatchlist): string => {
                return watchlist.id!.toString();
              }),
            ),
            /*
             * A value leaves its list the moment it was given: no read
             * sees it from then on, before OneUptime deletes it
             * (SecurityWatchlistExpiry).
             */
            expiresAt: QueryHelper.greaterThanOrNull(
              data.now || OneUptimeDate.getCurrentDate(),
            ),
          },
          select: {
            _id: true,
            securityWatchlistId: true,
            value: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

      for (const item of items) {
        if (!item.securityWatchlistId || !item.value) {
          continue;
        }

        const key: string = item.securityWatchlistId.toString();
        const values: Array<string> = valuesByWatchlist.get(key) || [];
        values.push(item.value);
        valuesByWatchlist.set(key, values);
      }
    }

    for (const watchlist of watchlists) {
      if (!watchlist.id || !watchlist.name) {
        continue;
      }

      const entityType: SecurityEntityType =
        (watchlist.entityType as SecurityEntityType) ||
        SecurityEntityType.Other;
      const key: string = getSecurityWatchlistNameKey(watchlist.name);

      // Two rows a race let share a name: the first one created is the list.
      if (result.has(key)) {
        continue;
      }

      if (watchlist.source === SecurityWatchlistSource.ThreatIntelFeed) {
        const indicatorTypes: Array<string> =
          getSecurityWatchlistFeedIndicatorTypes(entityType);

        /*
         * A list whose feed was deleted, or of a kind no feed carries,
         * follows nothing: it holds no value, as an empty list.
         */
        result.set(key, {
          name: watchlist.name,
          entityType,
          exactValues: [],
          patterns: [],
          ranges: [],
          ...(watchlist.threatIntelFeedId && indicatorTypes.length > 0
            ? {
                threatIntelFeed: {
                  projectId: data.projectId.toString(),
                  feedId: watchlist.threatIntelFeedId.toString(),
                  indicatorTypes,
                },
              }
            : {}),
        });
        continue;
      }

      result.set(key, {
        name: watchlist.name,
        entityType,
        ...splitSecurityWatchlistValues({
          values: valuesByWatchlist.get(watchlist.id.toString()) || [],
          entityType,
        }),
      });
    }

    return result;
  }

  /*
   * Everything in the project that reads each list, by name key: its
   * detection rules (their YAML's `expand`), its Security Events monitors
   * (their watchlist filters) and its hunts (their search's
   * `field:%name%`). What keeps a list from being deleted or renamed while
   * something still names it.
   */
  public static async findReaders(
    projectId: ObjectID,
  ): Promise<Map<string, Array<WatchlistReader>>> {
    const byKey: Map<string, Array<WatchlistReader>> = new Map();

    const add: (name: string, reader: WatchlistReader) => void = (
      name: string,
      reader: WatchlistReader,
    ): void => {
      const key: string = getSecurityWatchlistNameKey(name);
      const readers: Array<WatchlistReader> = byKey.get(key) || [];
      readers.push(reader);
      byKey.set(key, readers);
    };

    for (const [key, rules] of await this.findRulesReading(projectId)) {
      for (const rule of rules) {
        add(key, {
          kind: WatchlistReaderKind.DetectionRule,
          id: rule.id,
          name: rule.name,
        });
      }
    }

    const monitors: Array<Monitor> = await MonitorService.findAllBy({
      query: {
        projectId,
        monitorType: MonitorType.SecurityEvents,
      },
      select: {
        _id: true,
        name: true,
        monitorSteps: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    for (const monitor of monitors) {
      for (const name of MonitorStepsReferenceExtractor.extractWatchlistNames(
        monitor.monitorSteps,
      )) {
        add(name, {
          kind: WatchlistReaderKind.Monitor,
          id: monitor.id?.toString() || "",
          name: monitor.name || "",
        });
      }
    }

    const hunts: Array<SecurityHunt> = await SecurityHuntService.findAllBy({
      query: {
        projectId,
      },
      select: {
        _id: true,
        name: true,
        searchQuery: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    for (const hunt of hunts) {
      for (const name of getSecurityHuntWatchlistNames(hunt.searchQuery)) {
        add(name, {
          kind: WatchlistReaderKind.Hunt,
          id: hunt.id?.toString() || "",
          name: hunt.name || "",
        });
      }
    }

    return byKey;
  }

  /*
   * The project's detection rules that read each list, by name key: what
   * keeps a list from being deleted or renamed while a rule still names it.
   */
  public static async findRulesReading(
    projectId: ObjectID,
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const rules: Array<DetectionRule> = await DetectionRuleService.findAllBy({
      query: {
        projectId,
      },
      select: {
        _id: true,
        name: true,
        sigmaRuleYaml: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    return getRulesReadingWatchlists(
      rules.map((rule: DetectionRule): WatchlistReadingRule => {
        return {
          id: rule.id?.toString() || "",
          name: rule.name || "",
          sigmaRuleYaml: rule.sigmaRuleYaml,
        };
      }),
    );
  }
}
