import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupNameFact,
  getIssueGroupNameFacts,
  getIssueGroupNameFactsHash,
  holdIssueGroupNameToFacts,
  readDataSecurityIssueGroupFacts,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import ObjectID from "../../../../Types/ObjectID";
import { AILogResponse } from "../../../Services/AIService";
import DataSecurityIssueGroupService from "../../../Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataSecurityAiCall from "./DataSecurityAiCall";
import {
  DATA_SECURITY_ISSUE_GROUP_NAME_MAX_TOKENS,
  DATA_SECURITY_ISSUE_GROUP_NAME_TEMPERATURE,
  buildIssueGroupNamePrompt,
  readIssueGroupNameAnswer,
} from "./DataSecurityIssueGroupPrompt";

/*
 * ONEUPTIME AI NAMES A GROUP OF ISSUES ONE MISTAKE MADE (#10370), FROM ITS
 * FACTS ONLY.
 *
 * The facts decide a group (DataSecurityIssueGrouper); this only names it,
 * in a phrase that completes "40 issues, one cause: ..." - "the static-site
 * module turns off access logs". After each grouping, for each open group
 * whose facts changed since it was named (getIssueGroupNameFactsHash), or in
 * a new language:
 *
 *   - only while Enable AI and Work on new issues are on: OneUptime AI's own
 *     work on Data Security issues, as the analysis of a new issue is;
 *   - one constrained call through the one Data Security call
 *     (DataSecurityAiCall), told the group's facts - what made the stores,
 *     the check, the code that declares them, what they are - and never a
 *     store's name, a value, a sample or a record (DataSecurityAiInput);
 *   - the answer held to those facts (holdIssueGroupNameToFacts): a name
 *     that says a name, an id, a number or a store the facts do not hold is
 *     dropped, and the group goes by its cause's own words;
 *   - in the project's language (ProjectLanguage);
 *   - at most MAX_GROUP_NAMES_PER_RUN calls a run, the rest the next.
 *
 * A name is written once per facts: a group whose issues open and resolve
 * is not named again. Never throws.
 */

export const MAX_GROUP_NAMES_PER_RUN: number = 10;

// The most of a group's stores read to keep their names out of its name.
const MAX_STORE_NAMES_READ: number = 500;

const ROOT: { isRoot: true } = { isRoot: true };

export default class DataSecurityIssueGroupNaming {
  /*
   * Names the open groups among these whose name is not of their facts as
   * they are now. Returns how many were asked about.
   */
  @CaptureSpan()
  public static async nameGroups(data: {
    projectId: ObjectID;
    groupIds: ReadonlyArray<ObjectID>;
    now?: Date | undefined;
  }): Promise<number> {
    if (data.groupIds.length === 0) {
      return 0;
    }

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
        },
        props: ROOT,
      });

      // Off, nothing is asked: every group goes by its cause's own words.
      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return 0;
      }

      const language: string = await ProjectLanguage.getLanguage(
        data.projectId,
      );
      const groups: Array<DataSecurityIssueGroup> =
        await DataSecurityIssueGroupService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(
              data.groupIds.map((id: ObjectID): string => {
                return id.toString();
              }),
            ),
          },
          select: {
            _id: true,
            facts: true,
            issueCount: true,
            openIssueCount: true,
            nameFactsHash: true,
          },
          skip: 0,
          limit: data.groupIds.length,
          props: ROOT,
        });
      let asked: number = 0;

      for (const group of groups) {
        if (asked >= MAX_GROUP_NAMES_PER_RUN) {
          break;
        }

        const facts: DataSecurityIssueGroupFacts | null =
          readDataSecurityIssueGroupFacts(group.facts);

        if (!group.id || !facts || (group.openIssueCount || 0) === 0) {
          continue;
        }

        const hash: string = getIssueGroupNameFactsHash(facts, language);

        if (group.nameFactsHash === hash) {
          continue;
        }

        asked++;
        await DataSecurityIssueGroupNaming.nameGroup({
          projectId: data.projectId,
          group,
          facts,
          language,
          hash,
          now: data.now || OneUptimeDate.getCurrentDate(),
        });
      }

      return asked;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not name the issue groups of project ${data.projectId.toString()}: ${error}`,
      );
      return 0;
    }
  }

  /*
   * One group's name: asked, held to its facts, and kept with what it was
   * written from - none, where the answer said what the facts do not hold.
   * A call that fails keeps nothing, and is asked again the next run.
   */
  private static async nameGroup(data: {
    projectId: ObjectID;
    group: DataSecurityIssueGroup;
    facts: DataSecurityIssueGroupFacts;
    language: string;
    hash: string;
    now: Date;
  }): Promise<void> {
    const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
      data.facts.checkId,
    );
    const nameFacts: Array<DataSecurityIssueGroupNameFact> =
      getIssueGroupNameFacts({
        facts: data.facts,
        checkTitle: check?.title || data.facts.checkId,
        checkDescription: check?.description || "",
        issueCount: data.group.issueCount || 0,
      });
    let name: string | null = null;

    try {
      const response: AILogResponse = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        prompt: buildIssueGroupNamePrompt({
          facts: nameFacts,
          language: data.language,
        }),
        maxTokens: DATA_SECURITY_ISSUE_GROUP_NAME_MAX_TOKENS,
        temperature: DATA_SECURITY_ISSUE_GROUP_NAME_TEMPERATURE,
        // No person started it: the call's own messages and bounds hold.
        protectRequestParameters: true,
      });

      name = holdIssueGroupNameToFacts({
        answer: readIssueGroupNameAnswer(response.content),
        facts: nameFacts,
        storeNames: await DataSecurityIssueGroupNaming.readStoreNames(
          data.projectId,
          data.group.id!,
        ),
      });
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not name issue group ${data.group.id!.toString()} of project ${data.projectId.toString()}: ${error}`,
      );
      return;
    }

    await DataSecurityIssueGroupService.updateOneById({
      id: data.group.id!,
      data: {
        name,
        nameFactsHash: data.hash,
        nameLanguage: data.language,
        namedAt: data.now,
      } as never,
      props: ROOT,
    });
  }

  // The names of a group's stores: what its name may never say.
  private static async readStoreNames(
    projectId: ObjectID,
    groupId: ObjectID,
  ): Promise<Array<string>> {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: { projectId, dataSecurityIssueGroupId: groupId },
        select: { _id: true, dataStoreId: true },
        skip: 0,
        limit: MAX_STORE_NAMES_READ,
        props: ROOT,
      });
    const storeIds: Array<string> = issues
      .map((issue: DataSecurityIssue): string => {
        return issue.dataStoreId?.toString() || "";
      })
      .filter(Boolean);

    if (storeIds.length === 0) {
      return [];
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, _id: QueryHelper.any(storeIds) },
      select: { _id: true, name: true },
      skip: 0,
      limit: storeIds.length,
      props: ROOT,
    });

    return stores
      .map((store: DataStore): string => {
        return store.name || "";
      })
      .filter(Boolean);
  }
}
