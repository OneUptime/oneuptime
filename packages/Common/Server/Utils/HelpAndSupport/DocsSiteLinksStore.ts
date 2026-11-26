import { ExpressRequest } from "../Express";
import { DocsSiteLinks } from "../../../Types/HelpAndSupport/HelpAndSupport";

/*
 * WHERE THE DOCS SITE AND THE API REFERENCE ASK WHAT TO LINK TO (#10940).
 *
 * The docs (/docs) and the API reference (/reference) read nothing from the
 * database themselves, as they keep "Was this page helpful?" answers
 * through a keeper they are handed (Docs/Utils/DocsFeedbackStore): the App
 * hands them a reader of this server's Help and Support settings when it
 * starts (App/Index.ts: DocsSiteLinks.getLinks). Without one - a test, or a
 * process that serves them without a database - the answer is null, and
 * the pages link to what they always did.
 *
 * Never throws: a page of documentation is never worth an error.
 */
export type DocsSiteLinksReader = (
  req: ExpressRequest,
) => Promise<DocsSiteLinks>;

export default class DocsSiteLinksStore {
  private static reader: DocsSiteLinksReader | null = null;

  // The App's: DocsSiteLinks.getLinks. Null reads nothing.
  public static useReader(reader: DocsSiteLinksReader | null): void {
    DocsSiteLinksStore.reader = reader;
  }

  // What a page links to for this request, or null: OneUptime's, as always.
  public static async getLinks(
    req: ExpressRequest,
  ): Promise<DocsSiteLinks | null> {
    if (!DocsSiteLinksStore.reader) {
      return null;
    }

    try {
      return await DocsSiteLinksStore.reader(req);
    } catch {
      return null;
    }
  }
}
