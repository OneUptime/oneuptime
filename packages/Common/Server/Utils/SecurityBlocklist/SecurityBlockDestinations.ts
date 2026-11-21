import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_BLOCK_INDICATOR_TYPES,
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SECURITY_BLOCK_SAMPLE_VALUES,
  SecurityBlockHolder,
} from "../../../Types/SecurityBlocklist/SecurityBlockHolders";
import logger from "../Logger";
import SecurityBlockDestination from "./SecurityBlockDestination";
import {
  CrowdStrikeBlockDestinationSource,
  MicrosoftDefenderBlockDestinationSource,
} from "./Destinations/EndpointBlockDestinationSources";

/*
 * WHERE A PROJECT'S BLOCKLIST IS ENFORCED (#10338): every destination of
 * every kind the project has, found afresh on each pass of the reconciler
 * and each read of the Blocklist page.
 *
 * Each kind of destination is a source here: given a project, it lists the
 * destinations of its kind the project has - one per connection with
 * blocking turned on, say, or one per zone of it. Each provider's issue of
 * #10335 adds its source to SECURITY_BLOCK_DESTINATION_SOURCES as it lands
 * (Cloudflare #10343, AWS WAF #10344, the feed #10345, Defender and
 * CrowdStrike #10346, Azure WAF #10348, Cloud Armor #10349). Until one has,
 * a project has no destination, and the blocklist says so: its blocks are
 * enforced nowhere.
 *
 * A source that cannot be read is not taken to have no destination: it is
 * named as failed, so the reconciler leaves its destinations' rows as they
 * are rather than marking them removed, and the page can say it cannot
 * tell.
 */

// One kind of destination, and how to find a project's destinations of it.
export interface SecurityBlockDestinationSource {
  provider: SecurityBlockDestinationProvider;
  findForProject(projectId: ObjectID): Promise<Array<SecurityBlockDestination>>;
}

export interface SecurityBlockDestinationsFound {
  destinations: Array<SecurityBlockDestination>;
  // The kinds whose destinations could not be listed, and why.
  failedProviders: Array<{
    provider: SecurityBlockDestinationProvider;
    error: string;
  }>;
}

/*
 * The kinds of destination OneUptime enforces the blocklist at. Each
 * provider's issue adds its own source here, with its import at the top of
 * this file.
 */
export const SECURITY_BLOCK_DESTINATION_SOURCES: ReadonlyArray<SecurityBlockDestinationSource> =
  [
    // Every machine (#10346): Microsoft Defender's indicators and CrowdStrike Falcon's IOCs.
    MicrosoftDefenderBlockDestinationSource,
    CrowdStrikeBlockDestinationSource,
  ];

export default class SecurityBlockDestinations {
  /*
   * The sources a process asks, which tests replace (setSourcesForTests):
   * SECURITY_BLOCK_DESTINATION_SOURCES otherwise.
   */
  private static sources: ReadonlyArray<SecurityBlockDestinationSource> =
    SECURITY_BLOCK_DESTINATION_SOURCES;

  public static getSources(): ReadonlyArray<SecurityBlockDestinationSource> {
    return this.sources;
  }

  // Whether any kind of destination exists at all: with none, nothing can enforce a block anywhere.
  public static hasSources(): boolean {
    return this.sources.length > 0;
  }

  // For tests: the sources to ask instead, until resetSourcesForTests.
  public static setSourcesForTests(
    sources: ReadonlyArray<SecurityBlockDestinationSource>,
  ): void {
    this.sources = sources;
  }

  public static resetSourcesForTests(): void {
    this.sources = SECURITY_BLOCK_DESTINATION_SOURCES;
  }

  /*
   * What each destination can hold (#10346), from its own supports(): the
   * kinds of value it blocks, whether it quarantines files, and whether it
   * enforces on every machine. What a case's plan and the server's refusal
   * of a block nothing could hold read.
   */
  public static getHolders(
    destinations: ReadonlyArray<SecurityBlockDestination>,
  ): Array<SecurityBlockHolder> {
    return destinations.map(
      (destination: SecurityBlockDestination): SecurityBlockHolder => {
        const holds: (
          indicatorType: SecurityBlockIndicatorType,
          action: SecurityBlockAction,
        ) => boolean = (
          indicatorType: SecurityBlockIndicatorType,
          action: SecurityBlockAction,
        ): boolean => {
          return destination.supports({
            indicatorType,
            action,
            value: SECURITY_BLOCK_SAMPLE_VALUES[indicatorType],
          }).isSupported;
        };

        return {
          name: destination.name,
          provider: destination.provider,
          enforcesOnEveryMachine: Boolean(destination.enforcesOnEveryMachine),
          blocks: SECURITY_BLOCK_INDICATOR_TYPES.filter(
            (indicatorType: SecurityBlockIndicatorType): boolean => {
              return holds(indicatorType, SecurityBlockAction.Block);
            },
          ),
          quarantinesFiles:
            Boolean(destination.quarantinesFiles) &&
            holds(
              SecurityBlockIndicatorType.FileSha256,
              SecurityBlockAction.BlockAndQuarantine,
            ),
        };
      },
    );
  }

  /*
   * Every destination the project has, of every kind, each once by its key
   * (the first source to name a key keeps it), and the kinds that could not
   * be listed. Never throws.
   */
  public static async findForProject(
    projectId: ObjectID,
  ): Promise<SecurityBlockDestinationsFound> {
    const destinations: Array<SecurityBlockDestination> = [];
    const failedProviders: Array<{
      provider: SecurityBlockDestinationProvider;
      error: string;
    }> = [];
    const seen: Set<string> = new Set();

    for (const source of this.sources) {
      try {
        for (const destination of await source.findForProject(projectId)) {
          if (!destination.key || seen.has(destination.key)) {
            continue;
          }

          seen.add(destination.key);
          destinations.push(destination);
        }
      } catch (error) {
        const message: string =
          error instanceof Error && error.message
            ? error.message
            : String(error);

        logger.warn(
          `SecurityBlockDestinations: could not list the ${source.provider} destinations of project ${projectId.toString()}: ${message}`,
        );

        failedProviders.push({ provider: source.provider, error: message });
      }
    }

    return { destinations, failedProviders };
  }
}
