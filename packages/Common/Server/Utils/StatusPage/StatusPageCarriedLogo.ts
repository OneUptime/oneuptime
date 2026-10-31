import DatabaseConfig from "../../DatabaseConfig";
import StatusPageService from "../../Services/StatusPageService";
import FileOwnership from "../File/FileOwnership";
import logger from "../Logger";
import { CarriedLogo, toCarriedLogo } from "../Mail/EmailCarriedLogos";
import StatusPageEmailLogo from "./StatusPageEmailLogo";
import File from "../../../Models/DatabaseModels/File";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import ObjectID from "../../../Types/ObjectID";

/*
 * A STATUS PAGE'S LOGO, AS THE EMAILS THAT SHOW IT CARRY IT.
 *
 * A status page's emails show its logo by its address on the page's logo
 * route (StatusPageEmailLogo). Just before such an email goes out, the
 * notification service asks here for the logo that address shows, and the
 * email carries it inside itself instead (Utils/Mail/EmailCarriedLogos.ts):
 * read as the route serves it - a page that is not archived, a file of the
 * page's own project - and only a PNG, JPEG or GIF of at most
 * MAX_CARRIED_LOGO_BYTES. Anything else is null, and the email keeps the
 * address, as it always did.
 *
 * A notification goes to every subscriber of a page at once, one email
 * each, so the logo is read once for all of them: a read is kept for
 * CARRIED_LOGO_CACHE_TTL_IN_MS, and the emails that ask while it is still
 * being read wait for that one read. A new logo is carried within a minute
 * of its upload. A read that fails is kept only for
 * CARRIED_LOGO_RETRY_AFTER_FAILURE_IN_MS: those emails show the address.
 */

export const CARRIED_LOGO_CACHE_TTL_IN_MS: number = 60 * 1000;

export const CARRIED_LOGO_RETRY_AFTER_FAILURE_IN_MS: number = 5 * 1000;

/*
 * The most pages whose logos are kept at once: the pages of the
 * notifications going out in the same minute. The oldest goes first.
 */
export const MAX_CACHED_CARRIED_LOGOS: number = 16;

// The name a status page's logo goes by as an attachment.
export const STATUS_PAGE_LOGO_ATTACHMENT_NAME: string = "logo";

interface CachedLogo {
  logo: Promise<CarriedLogo | null>;
  expiresAtInMs: number;
}

export default class StatusPageCarriedLogo {
  private static cache: Map<string, CachedLogo> = new Map<
    string,
    CachedLogo
  >();

  /**
   * The logo `address` shows, as an email carries it, when the address is a
   * status page's logo on this installation as StatusPageEmailLogo writes
   * it - the host and protocol every sender builds it with - or null.
   */
  public static async readAddress(
    address: string,
  ): Promise<CarriedLogo | null> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const statusPageId: ObjectID | null = StatusPageEmailLogo.readLogoAddress(
      address,
      { host: host, httpProtocol: httpProtocol },
    );

    if (!statusPageId) {
      return null;
    }

    return await StatusPageCarriedLogo.read(statusPageId);
  }

  // The page's logo as an email carries it, or null (see the top).
  public static read(statusPageId: ObjectID): Promise<CarriedLogo | null> {
    const key: string = statusPageId.toString().toLowerCase();
    const nowInMs: number = Date.now();
    const cached: CachedLogo | undefined = StatusPageCarriedLogo.cache.get(key);

    if (cached && cached.expiresAtInMs > nowInMs) {
      return cached.logo;
    }

    const entry: CachedLogo = {
      logo: Promise.resolve(null),
      expiresAtInMs: nowInMs + CARRIED_LOGO_CACHE_TTL_IN_MS,
    };

    entry.logo = StatusPageCarriedLogo.readFromDatabase(statusPageId).catch(
      (err: unknown): null => {
        entry.expiresAtInMs = Date.now() + CARRIED_LOGO_RETRY_AFTER_FAILURE_IN_MS;

        logger.error(
          `The logo of status page ${key} could not be read to go inside its emails, so they show it from its address.`,
        );
        logger.error(err);

        return null;
      },
    );

    // Newest last, so the first is always the oldest.
    StatusPageCarriedLogo.cache.delete(key);
    StatusPageCarriedLogo.cache.set(key, entry);

    while (StatusPageCarriedLogo.cache.size > MAX_CACHED_CARRIED_LOGOS) {
      const oldest: string | undefined = StatusPageCarriedLogo.cache
        .keys()
        .next().value;

      if (oldest === undefined) {
        break;
      }

      StatusPageCarriedLogo.cache.delete(oldest);
    }

    return entry.logo;
  }

  // Forgets every logo read (for tests).
  public static clearCache(): void {
    StatusPageCarriedLogo.cache.clear();
  }

  // The page's logo, read the way its logo route serves it.
  private static async readFromDatabase(
    statusPageId: ObjectID,
  ): Promise<CarriedLogo | null> {
    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId,
        // An archived page serves none of its branding.
        isArchived: false,
      },
      select: {
        projectId: true,
        logoFile: {
          _id: true,
          projectId: true,
          file: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    // Only a file of the page's own project, as the route serves.
    const logo: File | undefined = FileOwnership.keepProjectFile(
      statusPage?.logoFile,
      statusPage?.projectId,
    );

    return toCarriedLogo(logo?.file, STATUS_PAGE_LOGO_ATTACHMENT_NAME);
  }
}
