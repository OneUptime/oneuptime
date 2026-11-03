import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { LinkedAffectedResource } from "../../AI/Toolbox/AffectedResourceLinks";
import { truncateToLength } from "../../Database/TruncateColumnValue";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceAffectedResources, {
  WORKSPACE_AFFECTED_RESOURCES_FIELD,
  WORKSPACE_AFFECTED_RESOURCES_TEXT,
  WORKSPACE_MAX_AFFECTED_RESOURCES,
  WorkspaceAffectedResourceKindMatches,
  WorkspaceAffectedResourceMatch,
} from "../WorkspaceAffectedResources";
import MicrosoftTeamsAuthAction from "./Actions/Auth";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "./MicrosoftTeams";
import { MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH } from "./MicrosoftTeamsCardChoices";

/*
 * MICROSOFT TEAMS' AFFECTED RESOURCES INPUT ON THE CREATE NEW INCIDENT CARD.
 *
 * An Input.ChoiceSet with dynamic typeahead: the card sends no list of
 * resources. As the person types, Teams sends the bot an "application/search"
 * invoke naming the input's dataset and what was typed, and lists the
 * results the bot answers with - at most fifteen, Teams' own limit - each
 * a resource's name with its kind beside it (WorkspaceAffectedResources).
 *
 * The dataset names the project the card was drawn for, the one project a
 * card is ever filled in for. A search is read like a press of the card's
 * own button: the organization's project, told apart by that project, the
 * channel and the person (WorkspaceProjectResolution) - a dataset naming a
 * project the organization is not connected to is no clue at all - and then
 * as the member the person's Teams account is connected to there, with
 * their own permissions. In a channel anybody can type into the card: each
 * search is theirs, held to what they may read. Somebody OneUptime cannot
 * act as there is listed nothing, and no message is ever sent from here.
 */

// The name of the invoke Teams sends for a dynamic typeahead.
export const MICROSOFT_TEAMS_SEARCH_INVOKE_NAME: string = "application/search";

// The input's dataset, before the project it searches.
export const MICROSOFT_TEAMS_AFFECTED_RESOURCES_DATASET: string =
  "oneuptime.affectedResources";

// The most results Teams lists for one search.
export const MICROSOFT_TEAMS_MAX_SEARCH_RESULTS: number = 15;

// What a search's answer is marked as.
export const MICROSOFT_TEAMS_SEARCH_RESPONSE_TYPE: string =
  "application/vnd.microsoft.search.searchResponse";

const DATASET_PROJECT_SEPARATOR: string = ":";

/*
 * One result Teams lists, and the choice a card opens with. A type, not an
 * interface, so a list of them is a JSONValue on a card.
 */
export type MicrosoftTeamsSearchResult = {
  title: string;
  value: string;
};

// What the bot answers an invoke with: its status and its body.
export interface MicrosoftTeamsInvokeResponse {
  status: number;
  body: JSONObject;
}

export default class MicrosoftTeamsAffectedResources {
  /*
   * The card's Affected Resources input, opening with `initial` picked - the
   * resources of the alert a card is declared from - and the line under it
   * that says why it is there. Optional, as every input after the severity.
   */
  public static getInputElements(data: {
    projectId: ObjectID;
    initial: Array<LinkedAffectedResource>;
  }): Array<JSONObject> {
    const initial: Array<MicrosoftTeamsSearchResult> = data.initial
      .slice(0, WORKSPACE_MAX_AFFECTED_RESOURCES)
      .map((resource: LinkedAffectedResource): MicrosoftTeamsSearchResult => {
        return this.toResult(resource);
      });

    const input: JSONObject = {
      type: "Input.ChoiceSet",
      id: WORKSPACE_AFFECTED_RESOURCES_FIELD,
      label: `${WORKSPACE_AFFECTED_RESOURCES_TEXT.label} (Optional)`,
      placeholder: WORKSPACE_AFFECTED_RESOURCES_TEXT.placeholder,
      style: "filtered",
      isMultiSelect: true,
      choices: initial,
      "choices.data": {
        type: "Data.Query",
        dataset: this.getDataset(data.projectId),
      },
    };

    if (initial.length > 0) {
      input["value"] = initial
        .map((choice: MicrosoftTeamsSearchResult): string => {
          return choice.value;
        })
        .join(",");
    }

    return [
      input,
      {
        type: "TextBlock",
        text: WorkspaceAffectedResources.getHint(),
        isSubtle: true,
        size: "Small",
        wrap: true,
        spacing: "Small",
      },
    ];
  }

  // The input's dataset: the project the card was drawn for, named.
  public static getDataset(projectId: ObjectID): string {
    return `${MICROSOFT_TEAMS_AFFECTED_RESOURCES_DATASET}${DATASET_PROJECT_SEPARATOR}${projectId.toString()}`;
  }

  /*
   * The project a dataset names, or undefined: a dataset of another input,
   * or one that names no project.
   */
  public static readDatasetProjectId(dataset: unknown): string | undefined {
    if (typeof dataset !== "string") {
      return undefined;
    }

    const prefix: string = `${MICROSOFT_TEAMS_AFFECTED_RESOURCES_DATASET}${DATASET_PROJECT_SEPARATOR}`;

    if (!dataset.startsWith(prefix)) {
      return undefined;
    }

    const projectId: string = dataset.substring(prefix.length).trim();

    return ObjectID.isValidUUID(projectId) ? projectId : undefined;
  }

  // Whether an activity is a card's typeahead search.
  public static isSearch(activity: JSONObject | null | undefined): boolean {
    return (
      activity?.["type"] === "invoke" &&
      activity["name"] === MICROSOFT_TEAMS_SEARCH_INVOKE_NAME
    );
  }

  /*
   * "api-1 (Host)", "core-sw-01 (Network Device · 10.0.4.1)": a resource as
   * the list shows it and the input keeps it once picked - its kind beside
   * its name, since one list holds every kind - cut to what a row shows.
   */
  public static getResultTitle(resource: {
    kind: WorkspaceAffectedResourceMatch["kind"];
    name: string;
    detail?: string | undefined;
  }): string {
    const kind: string = WorkspaceAffectedResources.getKindLabel(
      resource.kind,
    );
    const title: string = resource.detail
      ? `${resource.name} (${kind} · ${resource.detail})`
      : `${resource.name} (${kind})`;

    return title.length > MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH
      ? `${truncateToLength(title, MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH - 1)}…`
      : title;
  }

  // The answer to a search: the results, as Teams lists them.
  public static getSearchResponse(
    results: Array<MicrosoftTeamsSearchResult>,
  ): MicrosoftTeamsInvokeResponse {
    return {
      status: 200,
      body: {
        type: MICROSOFT_TEAMS_SEARCH_RESPONSE_TYPE,
        value: {
          results: results.slice(0, MICROSOFT_TEAMS_MAX_SEARCH_RESULTS),
        },
      },
    };
  }

  /*
   * The results of the matches of every kind: one list, ranked across the
   * kinds (WorkspaceAffectedResources.rankAcrossKinds), at most `limit`.
   */
  public static toResults(data: {
    groups: Array<WorkspaceAffectedResourceKindMatches>;
    text: string;
    limit: number;
  }): Array<MicrosoftTeamsSearchResult> {
    return WorkspaceAffectedResources.rankAcrossKinds({
      groups: data.groups,
      text: data.text,
      limit: Math.min(MICROSOFT_TEAMS_MAX_SEARCH_RESULTS, data.limit),
    }).map(
      (match: WorkspaceAffectedResourceMatch): MicrosoftTeamsSearchResult => {
        return this.toResult(match);
      },
    );
  }

  /*
   * A card's typeahead search, answered: the resources that match what was
   * typed, read as the member in the card's project - or none, for a search
   * of another input, somebody OneUptime cannot act as there, or a search
   * that fails. Never throws, and always answers 200: Teams shows an error
   * in the input for anything else.
   */
  @CaptureSpan()
  public static async answerSearch(data: {
    activity: JSONObject;
  }): Promise<MicrosoftTeamsInvokeResponse> {
    try {
      return this.getSearchResponse(await this.search(data.activity));
    } catch (error) {
      logger.error(
        `Could not list the affected resources a Microsoft Teams card searched for: ${error}`,
      );
      return this.getSearchResponse([]);
    }
  }

  private static async search(
    activity: JSONObject,
  ): Promise<Array<MicrosoftTeamsSearchResult>> {
    const value: JSONObject =
      (activity["value"] as JSONObject | undefined) || {};
    const drawnForProjectId: string | undefined = this.readDatasetProjectId(
      value["dataset"],
    );

    if (!drawnForProjectId) {
      return [];
    }

    const channelData: JSONObject =
      (activity["channelData"] as JSONObject | undefined) || {};
    const tenantId: unknown = (
      channelData["tenant"] as JSONObject | undefined
    )?.["id"];
    const teamsUserId: unknown = (
      activity["from"] as JSONObject | undefined
    )?.["aadObjectId"];

    if (typeof tenantId !== "string" || !tenantId) {
      return [];
    }

    if (typeof teamsUserId !== "string" || !teamsUserId) {
      return [];
    }

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: tenantId,
        clues: {
          ...MicrosoftTeamsUtil.getProjectClues({ activity: activity }),
          drawnForProjectId: drawnForProjectId,
        },
      });

    const projectId: ObjectID | undefined =
      resolution.projectAuth?.projectId || undefined;

    /*
     * Only the project the card was drawn for: a card of a project the
     * organization is no longer connected to searches nothing, rather than
     * another project's resources.
     */
    if (!projectId || projectId.toString() !== drawnForProjectId) {
      return [];
    }

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId(
          {
            teamsUserId: teamsUserId,
            projectId: projectId,
          },
        ),
        projectId: projectId,
      });
    } catch (error) {
      logger.debug(
        `A Microsoft Teams affected resources search was not read as a member: ${error}`,
      );
      return [];
    }

    const text: string = WorkspaceAffectedResources.readSearchText(
      value["queryText"],
    );
    const limit: number = this.readLimit(value["queryOptions"]);

    const groups: Array<WorkspaceAffectedResourceKindMatches> =
      await WorkspaceAffectedResources.search({
        projectId: projectId,
        props: props,
        text: text,
        limitPerKind: limit,
      });

    return this.toResults({ groups: groups, text: text, limit: limit });
  }

  // How many results a search asks for (queryOptions.top), at most Teams' limit.
  private static readLimit(queryOptions: unknown): number {
    const top: unknown = (queryOptions as JSONObject | null | undefined)?.[
      "top"
    ];
    const asked: number = typeof top === "number" ? Math.floor(top) : NaN;

    return Number.isFinite(asked) && asked > 0
      ? Math.min(MICROSOFT_TEAMS_MAX_SEARCH_RESULTS, asked)
      : MICROSOFT_TEAMS_MAX_SEARCH_RESULTS;
  }

  private static toResult(resource: {
    kind: WorkspaceAffectedResourceMatch["kind"];
    id: string;
    name: string;
    detail?: string | undefined;
  }): MicrosoftTeamsSearchResult {
    return {
      title: this.getResultTitle(resource),
      value: WorkspaceAffectedResources.toValue(resource),
    };
  }
}
