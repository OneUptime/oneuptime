import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import { WorkspaceDropdownBlock } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import { cutToLength } from "../../../../Utils/Markdown/OverLongText";
import { LinkedAffectedResource } from "../../AI/Toolbox/AffectedResourceLinks";
import { ExpressRequest, ExpressResponse } from "../../Express";
import logger from "../../Logger";
import Response from "../../Response";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceAffectedResources, {
  WORKSPACE_AFFECTED_RESOURCES_FIELD,
  WORKSPACE_AFFECTED_RESOURCES_TEXT,
  WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND,
  WORKSPACE_MAX_AFFECTED_RESOURCES,
  WorkspaceAffectedResourceKindMatches,
  WorkspaceAffectedResourceMatch,
} from "../WorkspaceAffectedResources";
import SlackAuthAction, { SlackRequest } from "./Actions/Auth";

/*
 * SLACK'S AFFECTED RESOURCES FIELD ON THE NEW INCIDENT FORM.
 *
 * A multi external select: Slack lists no option the form was sent with.
 * As the person opens it and types, Slack posts what they typed to the
 * app's Options Load URL (the manifest's message_menu_options_url,
 * POST /api/slack/options-load) as a block_suggestion, and lists what
 * OneUptime answers - the project's resources that match, under a heading
 * for each kind (WorkspaceAffectedResources).
 *
 * The request is read as the press a submission of the same form would
 * be (SlackAuthAction.isAuthorized): the project the form was drawn for,
 * which its private_metadata carries, and the member the Slack account is
 * connected to there. Somebody not connected, no longer a member, or in a
 * workspace connected to several projects and no clue which, is listed
 * nothing - no message is ever sent from here. Every resource is read with
 * the member's own props, so the list holds only what they may read.
 *
 * Slack takes an answer within three seconds, at most a hundred options,
 * each option's text and description at most 75 characters and its value
 * at most 150: this answer holds to all of it.
 */

// The most options one answer lists, across every heading.
export const SLACK_AFFECTED_RESOURCES_MAX_OPTIONS: number = 100;

// The most characters an option's text, its description or a heading holds.
export const SLACK_OPTION_TEXT_MAX_LENGTH: number = 75;

// The most characters an option's value holds.
const SLACK_OPTION_VALUE_MAX_LENGTH: number = 150;

// Slack's payload type for an options request of a select in a view.
const BLOCK_SUGGESTION: string = "block_suggestion";

// What an options request is answered with when there is nothing to list.
const NO_OPTIONS: JSONObject = { options: [] };

// Plain text cut to `maxLength`, ending with "…" when cut.
function cutText(text: string, maxLength: number): string {
  return text.length > maxLength
    ? `${cutToLength(text, maxLength - 1).trimEnd()}…`
    : text;
}

function plainText(text: string): JSONObject {
  return {
    type: "plain_text",
    text: cutText(text, SLACK_OPTION_TEXT_MAX_LENGTH),
  };
}

export default class SlackAffectedResources {
  /*
   * The form's Affected Resources field, opening with `initial` picked - the
   * resources of the alert a form is declared from. Optional, and searched
   * from the first moment it is opened: a project of a few resources sees
   * them all at once, a big one types. Its hint says what OneUptime AI does
   * with the picks, in a project whose AI is on.
   */
  public static getField(data: {
    initial: Array<LinkedAffectedResource>;
    isAiEnabled: boolean;
  }): WorkspaceDropdownBlock {
    const initial: Array<DropdownOption> = data.initial
      .slice(0, WORKSPACE_MAX_AFFECTED_RESOURCES)
      .map((resource: LinkedAffectedResource): DropdownOption => {
        return {
          label: cutText(resource.name, SLACK_OPTION_TEXT_MAX_LENGTH),
          value: WorkspaceAffectedResources.toValue(resource),
        };
      });

    return {
      _type: "WorkspaceDropdownBlock",
      label: WORKSPACE_AFFECTED_RESOURCES_TEXT.label,
      blockId: WORKSPACE_AFFECTED_RESOURCES_FIELD,
      placeholder: WORKSPACE_AFFECTED_RESOURCES_TEXT.placeholder,
      options: initial,
      initialValues: initial.map((option: DropdownOption): string => {
        return option.value.toString();
      }),
      multiSelect: true,
      optional: true,
      description: data.isAiEnabled
        ? WorkspaceAffectedResources.getHint()
        : undefined,
      optionsLoad: {
        minQueryLength: 0,
        maxSelectedItems: WORKSPACE_MAX_AFFECTED_RESOURCES,
      },
    };
  }

  // Whether Slack asks for the field's options: a block_suggestion of it.
  public static isOptionsRequest(payload: unknown): boolean {
    const json: JSONObject | null =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as JSONObject)
        : null;

    return (
      json?.["type"] === BLOCK_SUGGESTION &&
      json["action_id"] === WORKSPACE_AFFECTED_RESOURCES_FIELD
    );
  }

  /*
   * The answer Slack lists: a heading for each kind with matches, in the
   * order the kinds are offered - "Hosts", or "Hosts (15 of 240)" when
   * more match than are listed, so the person knows to type more - each
   * resource by its name, and under it what tells two of one name apart
   * (a network device's address). At most
   * SLACK_AFFECTED_RESOURCES_MAX_OPTIONS in all: past it, the longest
   * lists give way first, one option at a time, so every kind that matched
   * keeps a place.
   */
  public static getOptionsResponse(
    groups: Array<WorkspaceAffectedResourceKindMatches>,
  ): JSONObject {
    const shown: Array<Array<WorkspaceAffectedResourceMatch>> = groups.map(
      (group: WorkspaceAffectedResourceKindMatches) => {
        return group.matches.filter(
          (match: WorkspaceAffectedResourceMatch): boolean => {
            return (
              WorkspaceAffectedResources.toValue(match).length <=
              SLACK_OPTION_VALUE_MAX_LENGTH
            );
          },
        );
      },
    );

    let total: number = shown.reduce(
      (sum: number, matches: Array<WorkspaceAffectedResourceMatch>) => {
        return sum + matches.length;
      },
      0,
    );

    while (total > SLACK_AFFECTED_RESOURCES_MAX_OPTIONS) {
      let longest: number = 0;

      shown.forEach(
        (matches: Array<WorkspaceAffectedResourceMatch>, index: number) => {
          if (matches.length > shown[longest]!.length) {
            longest = index;
          }
        },
      );

      shown[longest]!.pop();
      total--;
    }

    const optionGroups: Array<JSONObject> = [];

    groups.forEach(
      (group: WorkspaceAffectedResourceKindMatches, index: number) => {
        const matches: Array<WorkspaceAffectedResourceMatch> = shown[index]!;

        if (matches.length === 0) {
          return;
        }

        const label: string = WorkspaceAffectedResources.getKindPluralLabel(
          group.kind,
        );

        optionGroups.push({
          label: plainText(
            group.count > matches.length
              ? `${label} (${matches.length} of ${group.count})`
              : label,
          ),
          options: matches.map(
            (match: WorkspaceAffectedResourceMatch): JSONObject => {
              const option: JSONObject = {
                text: plainText(match.name),
                value: WorkspaceAffectedResources.toValue(match),
              };

              if (match.detail) {
                option["description"] = plainText(match.detail);
              }

              return option;
            },
          ),
        });
      },
    );

    if (optionGroups.length === 0) {
      return { ...NO_OPTIONS };
    }

    return { option_groups: optionGroups };
  }

  /*
   * POST /slack/options-load, once Slack's signature is checked: the
   * field's options for what was typed, read as the member in the form's
   * project - or none, for a request that is not the field's, a person
   * OneUptime cannot act as there, or a search that fails. Always answered,
   * and never with an error: Slack shows an error over the field for
   * anything but a list.
   */
  @CaptureSpan()
  public static async answerOptionsRequest(data: {
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { req, res } = data;

    let groups: Array<WorkspaceAffectedResourceKindMatches> = [];

    try {
      const payload: JSONObject | null = this.readPayload(req.body);

      if (payload && this.isOptionsRequest(payload)) {
        groups = await this.search({ req: req, payload: payload });
      }
    } catch (error) {
      logger.error(
        `Could not list the affected resources a Slack form searched for: ${error}`,
      );
      groups = [];
    }

    return Response.sendJsonObjectResponse(
      req,
      res,
      this.getOptionsResponse(groups),
    );
  }

  private static async search(data: {
    req: ExpressRequest;
    payload: JSONObject;
  }): Promise<Array<WorkspaceAffectedResourceKindMatches>> {
    const slackRequest: SlackRequest = await SlackAuthAction.isAuthorized({
      req: data.req,
      payload: data.payload,
    });

    if (
      !slackRequest.isAuthorized ||
      !slackRequest.userId ||
      !slackRequest.projectId
    ) {
      return [];
    }

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: slackRequest.userId,
        projectId: slackRequest.projectId,
      });
    } catch (error) {
      logger.debug(
        `A Slack affected resources search was not read as a member: ${error}`,
      );
      return [];
    }

    return await WorkspaceAffectedResources.search({
      projectId: slackRequest.projectId,
      props: props,
      text: WorkspaceAffectedResources.readSearchText(data.payload["value"]),
      limitPerKind: WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND,
    });
  }

  // Slack's form body: the payload, JSON in its "payload" field.
  private static readPayload(body: unknown): JSONObject | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const field: unknown = (body as JSONObject)["payload"];

    if (typeof field !== "string") {
      return body as JSONObject;
    }

    try {
      const parsed: unknown = JSON.parse(field);

      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JSONObject)
        : null;
    } catch {
      return null;
    }
  }
}
