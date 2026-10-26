import Route from "../../Types/API/Route";
import ObjectID from "../../Types/ObjectID";

/*
 * The public page one browser tab shows - a status page, a public dashboard -
 * for that tab alone (issue #5277).
 *
 * OneUptime's own address shows every status page at /status-page/<id> and
 * every public dashboard at /public-dashboard/<id>, and everything a browser
 * keeps in localStorage for that address is shared by every tab open on it.
 * The id these apps kept there was therefore the id of whichever page a tab
 * opened last: with two status pages side by side, the first one's next
 * refresh drew the second one under its own address, and its links led to
 * the second one's pages, its Subscribe form included.
 *
 * So the id is read only from what belongs to this tab:
 *
 *   1. its address, when the address names the page (/<segment>/<id>/...):
 *      what the visitor opened, and what a reload of the tab shows;
 *   2. otherwise the page this tab resolved for itself as it started - on a
 *      custom domain, the page the domain shows - kept in this tab's memory,
 *      where no other tab can change it, and found again on every load.
 *
 * Ids are kept in lower case, as the API writes them: an address may spell
 * one in capitals, and the same page must have one id wherever it is used.
 *
 * React-free.
 */
export default class TabPageId {
  // The first segment of the page's own address: "status-page".
  private readonly segment: string;

  private resolvedId: string | null = null;

  public constructor(segment: string) {
    this.segment = segment;
  }

  /*
   * The value of the page segment of a path - "<id>" in
   * /<segment>/<id>/incidents?x#y - as written, or null when the path is
   * not one of the page's own addresses.
   */
  public static getSegmentValue(data: {
    path: string;
    segment: string;
  }): string | null {
    const pathname: string = TabPageId.getPathname(data.path);
    const prefix: string = `/${data.segment}/`;

    if (!pathname.startsWith(prefix)) {
      return null;
    }

    return pathname.slice(prefix.length).split("/")[0] || "";
  }

  // The page a path names, when it names one by a real id.
  public static getIdInPath(data: {
    path: string;
    segment: string;
  }): ObjectID | null {
    const value: string | null = TabPageId.getSegmentValue(data);

    /*
     * A route's own placeholder (:statusPageId) or any other word is not a
     * page: only a real id is.
     */
    if (!value || !ObjectID.isValidUUID(value)) {
      return null;
    }

    return new ObjectID(value.toLowerCase());
  }

  // The page this tab's address names, if it names one.
  public getIdInAddress(): ObjectID | null {
    if (typeof window === "undefined") {
      return null;
    }

    return TabPageId.getIdInPath({
      path: window.location.pathname,
      segment: this.segment,
    });
  }

  // The page this tab shows: the one its address names, else its own.
  public get(): ObjectID | null {
    return this.getIdInAddress() || this.getResolved();
  }

  // The page this tab resolved as it started, whatever its address says now.
  public getResolved(): ObjectID | null {
    return this.resolvedId ? new ObjectID(this.resolvedId) : null;
  }

  public set(id: ObjectID | string | null | undefined): void {
    const value: string = id ? id.toString().trim().toLowerCase() : "";

    this.resolvedId = value || null;
  }

  /*
   * Whether a path of this app opens another page than this tab's: one under
   * /<segment>/<id> that names any other page, read as navigation opens it
   * (getOpenedPath). A tab that does not know its page yet cannot tell, and
   * answers no.
   */
  public isAnotherPagesPath(path: string): boolean {
    const value: string | null = TabPageId.getSegmentValue({
      path: TabPageId.getOpenedPath(path),
      segment: this.segment,
    });

    if (!value) {
      return false;
    }

    const own: ObjectID | null = this.get();

    if (!own) {
      return false;
    }

    return value !== own.toString();
  }

  /*
   * The path navigation opens for a path of this app: repeated slashes made
   * one, as Route makes them in every path it is given, then dot segments
   * resolved, as the browser resolves them in the address it goes to (../
   * and %2e%2e/ alike), without the query and fragment. So
   * /<segment>/<own id>/../<another id> and /<segment>//<another id> are
   * read as the other page's addresses they open. In lower case: the app's
   * router matches the segment in any case, and ids are kept in lower case.
   * What Route or the browser cannot read is read as written.
   */
  private static getOpenedPath(path: string): string {
    let opened: string = (path || "").trim();

    try {
      opened = new Route(opened).toString();
    } catch {
      // Route refuses it, and nothing navigates to it.
    }

    if (typeof window !== "undefined") {
      try {
        opened = new window.URL(opened, window.location.origin).pathname;
      } catch {
        // Not an address the browser reads: kept as Route left it.
      }
    }

    return opened.toLowerCase();
  }

  // The path of an address or a path: what is before its query and fragment.
  private static getPathname(path: string): string {
    const text: string = (path || "").trim();
    const queryStart: number = text.indexOf("?");
    const fragmentStart: number = text.indexOf("#");

    const ends: Array<number> = [queryStart, fragmentStart].filter(
      (index: number) => {
        return index >= 0;
      },
    );

    return ends.length > 0 ? text.slice(0, Math.min(...ends)) : text;
  }
}
