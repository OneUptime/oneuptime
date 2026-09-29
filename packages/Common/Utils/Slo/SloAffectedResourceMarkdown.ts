import URL from "../../Types/API/URL";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../Markdown/MarkdownEscape";

/*
 * The SLO bullets under "Resources Affected" in an incident's or alert's
 * "created" feed item: `- [SLO <name>](<dashboard link>)`, one per SLO the
 * record is linked to.
 *
 * Why this lives here and not on ServiceLevelObjectiveService: the services
 * that write those feed items cannot import it. ServiceLevelObjectiveService
 * imports ServiceLevelObjectiveBurnRateRuleService, which imports
 * IncidentService and AlertService to resolve burn-rate outputs, so the link
 * is built from the dashboard URL the caller already has. The route and the
 * `SLO <name>` wording match ServiceLevelObjectiveService.getSloLinkInDashboard
 * and getSloMarkdownLink exactly, and a test pins that, so an SLO reads the
 * same in every feed.
 *
 * The name is escaped exactly once, here, at the point it becomes markdown:
 * feeds render without safe mode, and a name like `x](https://evil)` must not
 * be able to re-point the link or restyle the sentence.
 */

/*
 * Structural rather than the ServiceLevelObjective model, so this stays a
 * dependency-free helper. A relation select on Incident / Alert yields
 * exactly these columns; all three are readable on relation queries.
 *
 * projectId is required for a bullet to print: see
 * getSloAffectedResourceMarkdownLines.
 */
export interface SloAffectedResourceLinkSubject {
  _id?: string | undefined;
  name?: string | undefined;
  projectId?: ObjectID | string | undefined | null;
}

export type GetSloDashboardUrlFunction = (data: {
  dashboardUrl: URL;
  projectId: ObjectID;
  sloId: ObjectID | string;
}) => URL;

export const getSloDashboardUrl: GetSloDashboardUrlFunction = (data: {
  dashboardUrl: URL;
  projectId: ObjectID;
  sloId: ObjectID | string;
}): URL => {
  /*
   * URL.addRoute mutates and returns the same instance, so start from a copy:
   * the caller's dashboard URL is reused for every bullet.
   */
  return URL.fromString(data.dashboardUrl.toString()).addRoute(
    `/${data.projectId.toString()}/slos/${data.sloId.toString()}`,
  );
};

export type GetSloAffectedResourceMarkdownLinesFunction = (data: {
  dashboardUrl: URL;
  projectId: ObjectID;
  serviceLevelObjectives:
    | Array<SloAffectedResourceLinkSubject>
    | undefined
    | null;
}) => Array<string>;

export const getSloAffectedResourceMarkdownLines: GetSloAffectedResourceMarkdownLinesFunction =
  (data: {
    dashboardUrl: URL;
    projectId: ObjectID;
    serviceLevelObjectives:
      | Array<SloAffectedResourceLinkSubject>
      | undefined
      | null;
  }): Array<string> => {
    const lines: Array<string> = [];
    const seenSloIds: Set<string> = new Set<string>();

    for (const slo of data.serviceLevelObjectives || []) {
      const sloId: string = slo?._id?.toString() || "";

      /*
       * A row without an id cannot be linked, and the relation cannot hold
       * one twice - skipping both keeps a malformed payload from printing a
       * dead link or a duplicate bullet.
       */
      if (!sloId || seenSloIds.has(sloId)) {
        continue;
      }

      /*
       * Only an SLO of the record's own project is named. The callers read
       * the record as root, so a link to another project's SLO would put
       * that SLO's name into this project's feed (and Slack / Teams). The
       * write hooks reject such links now, but rows saved before that check
       * existed may still hold one. An SLO whose project was not read cannot
       * be shown to belong here, so it is left out too; that also makes a
       * caller that drops projectId from its select fail loudly in its tests
       * rather than quietly lose the pin.
       */
      if (
        !slo.projectId ||
        slo.projectId.toString().trim().toLowerCase() !==
          data.projectId.toString().trim().toLowerCase()
      ) {
        continue;
      }

      seenSloIds.add(sloId);

      const escapedName: string = escapeMarkdownInline(slo.name).trim();
      const linkText: string = escapedName ? `SLO ${escapedName}` : "SLO";
      const link: URL = getSloDashboardUrl({
        dashboardUrl: data.dashboardUrl,
        projectId: data.projectId,
        sloId: sloId,
      });

      lines.push(`- [${linkText}](${link.toString()})`);
    }

    return lines;
  };
