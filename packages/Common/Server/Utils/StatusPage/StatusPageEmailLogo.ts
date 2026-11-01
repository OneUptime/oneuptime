import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { StatusPageApiRoute } from "../../../ServiceRoute";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import Select from "../../Types/Database/Select";
import FileOwnership from "../File/FileOwnership";

/*
 * A status page's logo in the emails it sends - subscriber notifications,
 * subscription confirmations, reports, private users' invitations and
 * password emails. An email shows the logo by its address on the page's
 * logo route (StatusPageAPI, /status-page-api/logo/<page>), which serves it
 * only when it is a file of the page's own project and the page is not
 * archived (FileOwnership.keepProjectFile). An email whose logo the route
 * would not serve - a logo of another project, or one with no project that
 * the backfill could not give one (BackfillFileOwners1797900000000) - leaves
 * it out, as for a page with no logo, rather than show a broken image.
 *
 * The one place an email builds that address, and reads it back
 * (readLogoAddress); StatusPageEmailLogoGuard keeps it so. Just before an
 * email goes out, a logo every mail client can draw, and small enough,
 * goes inside the email in place of its address (StatusPageCarriedLogo,
 * Utils/Mail/EmailCarriedLogos.ts), so the reader's mail client fetches
 * nothing; any other logo stays this address.
 */

/*
 * What a status page read must select for getLogoUrl to answer as the logo
 * route does: the page's project, whether it is archived, and the logo's id
 * and project. Spread into the read's select; a root read, since
 * File.projectId is closed to every request.
 */
export const STATUS_PAGE_EMAIL_LOGO_SELECT: Select<StatusPage> = {
  _id: true,
  projectId: true,
  isArchived: true,
  logoFileId: true,
  logoFile: {
    _id: true,
    projectId: true,
  },
};

export default class StatusPageEmailLogo {
  /**
   * Whether the page's logo route serves its logo: the page is not archived
   * and its logo is a file of its own project. A read that did not select
   * the logo with its project (STATUS_PAGE_EMAIL_LOGO_SELECT) shows none.
   */
  public static isLogoServed(
    statusPage: StatusPage | null | undefined,
  ): boolean {
    if (!statusPage || statusPage.isArchived === true) {
      return false;
    }

    return Boolean(
      FileOwnership.keepProjectFile(statusPage.logoFile, statusPage.projectId),
    );
  }

  /**
   * The address an email shows the page's logo from, or "" when the logo
   * route would not serve it - and the email leaves the logo out.
   */
  public static getLogoUrl(data: {
    statusPage: StatusPage;
    host: Hostname;
    httpProtocol: Protocol;
  }): string {
    const statusPageId: string =
      data.statusPage.id?.toString() || data.statusPage._id?.toString() || "";

    if (!statusPageId || !this.isLogoServed(data.statusPage)) {
      return "";
    }

    return this.getLogoAddress({
      statusPageId: statusPageId,
      host: data.host,
      httpProtocol: data.httpProtocol,
    });
  }

  /**
   * The status page whose logo `address` shows - an address exactly as
   * getLogoUrl writes it for `host` and `httpProtocol` - or null for any
   * other address. How an email that is about to go out finds the logo it
   * can carry in place of the address (StatusPageCarriedLogo).
   */
  public static readLogoAddress(
    address: string,
    data: {
      host: Hostname;
      httpProtocol: Protocol;
    },
  ): ObjectID | null {
    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(address);
    } catch {
      return null;
    }

    if (parsed.search || parsed.hash || parsed.username || parsed.password) {
      return null;
    }

    const segments: Array<string> = parsed.pathname.split("/");
    const statusPageId: string = segments[segments.length - 1] || "";

    if (!ObjectID.isValidUUID(statusPageId)) {
      return null;
    }

    let expected: globalThis.URL;

    try {
      expected = new globalThis.URL(
        this.getLogoAddress({
          statusPageId: statusPageId,
          host: data.host,
          httpProtocol: data.httpProtocol,
        }),
      );
    } catch {
      return null;
    }

    return parsed.href === expected.href ? new ObjectID(statusPageId) : null;
  }

  // The address of a page's logo on its logo route.
  private static getLogoAddress(data: {
    statusPageId: string;
    host: Hostname;
    httpProtocol: Protocol;
  }): string {
    return new URL(data.httpProtocol, data.host)
      .addRoute(StatusPageApiRoute)
      .addRoute(`/logo/${data.statusPageId}`)
      .toString();
  }
}
