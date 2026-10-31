import DashboardDomainService from "../../Services/DashboardDomainService";
import FormDomainService from "../../Services/FormDomainService";
import StatusPageDomainService from "../../Services/StatusPageDomainService";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * One name, one thing to show. A custom domain - a status page's, a
 * dashboard's or a form's - is found by the name a visit comes to, so a
 * name two of them claim shows only one of them: the ingress sends every
 * custom domain to the same app, which serves a dashboard's domain first,
 * then a form's, then a status page's (FeatureSet/Frontend). The second
 * claim never worked; it only hid behind the first one, and went live by
 * surprise the day the first was removed.
 *
 * So a new custom domain is refused when another kind of custom domain on
 * this installation already has its name, whichever project it is in - and
 * a form's, also when another form has it: a form's domain is looked up by
 * its name alone (FormDomainService.getShareKeyOfFormOnDomain). Two status
 * pages, or two dashboards, of different projects with one name are left as
 * they were: neither table ever refused them, and the projects that have
 * them keep them.
 *
 * Every kind is looked up as root: the refusal must hold for names in other
 * projects, and it says nothing about them - not whose they are, not what
 * they show - so it tells a caller no more than that the name is taken.
 * The services are reached when the check runs, never when this file
 * loads: they import this file too.
 */

export enum CustomDomainKind {
  StatusPage = "StatusPage",
  Dashboard = "Dashboard",
  Form = "Form",
}

export const getCustomDomainInUseMessage: (fullDomain: string) => string = (
  fullDomain: string,
): string => {
  return `${fullDomain} is already in use: a domain can show only one status page, dashboard or form. Choose another subdomain, or remove ${fullDomain} where it is used first.`;
};

export default class CustomDomainConflicts {
  /*
   * The kinds a new domain of this kind may not share its name with: every
   * other kind, and, for a form, other forms.
   */
  public static getKindsToCheck(
    kind: CustomDomainKind,
  ): Array<CustomDomainKind> {
    return [
      CustomDomainKind.StatusPage,
      CustomDomainKind.Dashboard,
      CustomDomainKind.Form,
    ].filter((other: CustomDomainKind): boolean => {
      return other !== kind || kind === CustomDomainKind.Form;
    });
  }

  // Whether a domain of this kind has the name, anywhere on the installation.
  public static async isNameUsedBy(data: {
    kind: CustomDomainKind;
    fullDomain: string;
  }): Promise<boolean> {
    switch (data.kind) {
      case CustomDomainKind.StatusPage:
        return Boolean(
          await StatusPageDomainService.findOneBy({
            query: { fullDomain: data.fullDomain },
            select: { _id: true },
            props: { isRoot: true },
          }),
        );
      case CustomDomainKind.Dashboard:
        return Boolean(
          await DashboardDomainService.findOneBy({
            query: { fullDomain: data.fullDomain },
            select: { _id: true },
            props: { isRoot: true },
          }),
        );
      case CustomDomainKind.Form:
        return Boolean(
          await FormDomainService.findOneBy({
            query: { fullDomain: data.fullDomain },
            select: { _id: true },
            props: { isRoot: true },
          }),
        );
    }
  }

  /*
   * Refuses a new custom domain of this kind whose name is in use (see
   * above). The name is the domain's full name, as its service worked it
   * out: lower case, no trailing dot.
   */
  public static async assertNameIsFree(data: {
    kind: CustomDomainKind;
    fullDomain: string;
  }): Promise<void> {
    const fullDomain: string = data.fullDomain.trim().toLowerCase();

    if (!fullDomain) {
      return;
    }

    for (const other of CustomDomainConflicts.getKindsToCheck(data.kind)) {
      if (
        await CustomDomainConflicts.isNameUsedBy({
          kind: other,
          fullDomain: fullDomain,
        })
      ) {
        throw new BadDataException(getCustomDomainInUseMessage(fullDomain));
      }
    }
  }
}
