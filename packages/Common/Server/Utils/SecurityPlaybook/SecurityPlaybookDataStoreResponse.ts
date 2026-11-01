import DataStore from "../../../Models/DatabaseModels/DataStore";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import {
  DataSecurityResponseAction,
  getDataSecurityResponseActions,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import {
  SecurityEntity,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { DataSecurityResponseOutcome } from "../DataSecurity/Cloud/DataSecurityCloudTypes";
import DataSecurityResponse from "../DataSecurity/DataSecurityResponse";
import {
  findCaseDataStores,
  getCaseDataStoreKeys,
} from "./SecurityPlaybookDataStoreOwners";
import type {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "./SecurityPlaybookActions";

/*
 * BLOCK PUBLIC ACCESS TO DATA STORES, REVOKE DATA STORE SHARING: the data
 * stores a case is about, closed through their cloud connections.
 *
 * A case Data Security opened - or one a detection rule grouped on a store,
 * such as "A sensitive bucket was made public" - names the store as a Data
 * Store entity. For each, at most MAX_NOTIFIED_DATA_STORES, the step runs
 * the response action Data Security runs from an issue's page
 * (DataSecurityResponse): it changes the store's configuration, never its
 * data, reads first and changes only what is not already so, and runs only
 * when the store's cloud connection has its "Data security response"
 * setting on. A store of a kind the action does not fit is left alone, and
 * so is a store marked public by design - a public website's bucket - for
 * Block public access: the step names each in its details.
 *
 * Like a Contain step it fails when a store it should have closed could not
 * be, so the run stops there unless the step carries on: nobody should
 * read "done" while a bucket is still public.
 */

const SKIPPED: SecurityPlaybookStepStatus.Skipped =
  SecurityPlaybookStepStatus.Skipped;

interface StoreOutcome {
  store: DataStore;
  // What became of the store.
  state: "changed" | "unchanged" | "public-by-design" | "failed";
  summary: string;
}

function storeLabel(store: DataStore): string {
  return store.name || store.storeKey || store.id?.toString() || "";
}

// The response action a step of this playbook action runs.
export function getResponseActionOfStep(
  action: SecurityPlaybookActionType | string,
): DataSecurityResponseAction | undefined {
  switch (action) {
    case SecurityPlaybookActionType.BlockDataStorePublicAccess:
      return DataSecurityResponseAction.BlockPublicAccess;
    case SecurityPlaybookActionType.RevokeDataStoreSharing:
      return DataSecurityResponseAction.RevokeSharing;
    default:
      return undefined;
  }
}

function describeOutcome(outcome: StoreOutcome): MarkdownText {
  switch (outcome.state) {
    case "changed":
      return mdText`**${storeLabel(outcome.store)}**: ${outcome.summary}`;
    case "unchanged":
      return mdText`**${storeLabel(outcome.store)}**: nothing to change. ${outcome.summary}`;
    case "public-by-design":
      return mdText`**${storeLabel(outcome.store)}**: left alone, it is marked public by design.`;
    default:
      return mdText`**${storeLabel(outcome.store)}**: could not be changed. ${outcome.summary}`;
  }
}

export default class SecurityPlaybookDataStoreResponse {
  public static async run(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const action: DataSecurityResponseAction | undefined =
      getResponseActionOfStep(context.step.action);

    if (!action) {
      return {
        status: SecurityPlaybookStepStatus.Failed,
        summary: FeedMarkdown.empty(),
        error: `"${String(context.step.action)}" is not a data store response.`,
      };
    }

    const keys: Array<string> = getCaseDataStoreKeys(
      mergeSecurityEntities(
        (context.securityCase.entities ||
          []) as unknown as Array<SecurityEntity>,
      ),
    );

    if (keys.length === 0) {
      return {
        status: SKIPPED,
        summary: mdText`The case names no data store.`,
      };
    }

    const stores: Array<DataStore> = (
      await findCaseDataStores(context.projectId, keys, {
        kind: true,
        isPublicByDesign: true,
      })
    ).filter((store: DataStore): boolean => {
      return getDataSecurityResponseActions(store.kind).includes(action);
    });

    if (stores.length === 0) {
      return {
        status: SKIPPED,
        summary:
          action === DataSecurityResponseAction.BlockPublicAccess
            ? mdText`No data store of the case is a bucket or a storage account whose public access can be blocked.`
            : mdText`No data store of the case is a database or a snapshot whose sharing can be revoked.`,
      };
    }

    const outcomes: Array<StoreOutcome> = [];

    for (const store of stores) {
      if (
        action === DataSecurityResponseAction.BlockPublicAccess &&
        store.isPublicByDesign
      ) {
        outcomes.push({ store, state: "public-by-design", summary: "" });
        continue;
      }

      try {
        const outcome: DataSecurityResponseOutcome =
          await DataSecurityResponse.run({
            projectId: context.projectId,
            dataStoreId: store.id!,
            action,
          });

        outcomes.push({
          store,
          state: outcome.changed ? "changed" : "unchanged",
          summary: outcome.summary,
        });
      } catch (error) {
        outcomes.push({
          store,
          state: "failed",
          summary:
            error instanceof Error && error.message
              ? error.message
              : String(error || "unknown error"),
        });
      }
    }

    return this.summarize(action, outcomes);
  }

  private static summarize(
    action: DataSecurityResponseAction,
    outcomes: Array<StoreOutcome>,
  ): PlaybookStepOutcome {
    const closed: Array<StoreOutcome> = outcomes.filter(
      (outcome: StoreOutcome): boolean => {
        return outcome.state === "changed" || outcome.state === "unchanged";
      },
    );
    const failures: Array<StoreOutcome> = outcomes.filter(
      (outcome: StoreOutcome): boolean => {
        return outcome.state === "failed";
      },
    );
    const details: MarkdownText = FeedMarkdown.bulletList(
      outcomes.map(describeOutcome),
    );
    const names: MarkdownText = FeedMarkdown.join(
      closed.map((outcome: StoreOutcome): MarkdownText => {
        return mdText`**${storeLabel(outcome.store)}**`;
      }),
    );

    if (closed.length === 0 && failures.length === 0) {
      // Every store it fits is public by design.
      return {
        status: SKIPPED,
        summary: mdText`${action}: every data store of the case it fits is marked public by design, and was left alone.`,
        detailsInMarkdown: details,
      };
    }

    const summary: MarkdownText =
      closed.length > 0
        ? mdText`${action}: done for ${names}${
            failures.length > 0
              ? mdText`; ${String(failures.length)} could not be changed`
              : FeedMarkdown.empty()
          }.`
        : mdText`${action}: no data store of the case could be changed.`;

    if (failures.length > 0) {
      return {
        status: SecurityPlaybookStepStatus.Failed,
        summary,
        detailsInMarkdown: details,
        feedEventType: SecurityCaseFeedEventType.ResponseAction,
        error: failures
          .map((outcome: StoreOutcome): string => {
            return `${storeLabel(outcome.store)}: ${outcome.summary}`;
          })
          .join(" "),
      };
    }

    return {
      status: SecurityPlaybookStepStatus.Succeeded,
      summary,
      detailsInMarkdown: details,
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
    };
  }
}
