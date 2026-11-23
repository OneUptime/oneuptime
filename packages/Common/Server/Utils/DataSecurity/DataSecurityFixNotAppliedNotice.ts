import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import Includes from "../../../Types/BaseDatabase/Includes";
import { Orange500 } from "../../../Types/BrandColors";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { DataSecurityIssueResolutionFix } from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import MailService from "../../Services/MailService";
import UserService from "../../Services/UserService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import logger from "../Logger";
import DataSecurityIntegrations from "./DataSecurityIntegrations";
import DataSecurityIssueResolutions, {
  describePullRequest,
} from "./DataSecurityIssueResolutions";

/*
 * "MERGED, NOT APPLIED" (#10368): A FIX IN INFRASTRUCTURE CODE THAT DID NOT
 * TAKE, SAID ONCE.
 *
 * A pull request to the Terraform, CloudFormation or Bicep that declares a
 * store changes nothing until it is applied. When a read a day after the
 * merge still finds a store failing the check the pull request was for
 * (StoreConfigurationFixWatch), the people who can apply it are told,
 * once, by email - with each store and its check, and a link to its issue:
 *
 *   - the store's owners, as a new issue's owners are (project members
 *     only, DataSecurityIntegrations.getOwnersToNotify), each told of the
 *     stores they own;
 *   - the pull request's author - OneUptime AI opens the pull request, so
 *     the person who asked for it - told of every store.
 *
 * Each issue's timeline and its store's say so too, and say who was
 * emailed, or that nobody could be. Never a value: names and checks only.
 * Never throws: a notice that cannot go never changes the fix's verdict.
 */

// The most people one notice goes to.
export const MAX_NOT_APPLIED_RECIPIENTS: number = 50;

// The most stores one email lists; the rest are counted.
export const MAX_NOT_APPLIED_STORES_LISTED: number = 20;

// One store the fix has not reached, as an email lists it.
export interface NotAppliedStore {
  issueId: ObjectID;
  dataStoreId: ObjectID;
  storeName: string;
  checkTitle: string;
  issueLink: URL;
}

export function getFixNotAppliedSubject(data: {
  fix: DataSecurityIssueResolutionFix;
}): string {
  return data.fix.number
    ? `Data Security: pull request #${data.fix.number} merged, but its change was not applied`
    : "Data Security: a fix merged, but its change was not applied";
}

/*
 * The email, as Markdown. The stores' names come from a cloud and the
 * checks from the catalog, so each is placed as text (mdText).
 */
export function buildFixNotAppliedMarkdown(data: {
  fix: DataSecurityIssueResolutionFix;
  stores: ReadonlyArray<NotAppliedStore>;
  // Stores of the fix not listed in this email.
  moreCount: number;
}): MarkdownText {
  const lines: Array<MarkdownText> = data.stores
    .slice(0, MAX_NOT_APPLIED_STORES_LISTED)
    .map((store: NotAppliedStore): MarkdownText => {
      return mdText`**${store.storeName}**: ${store.checkTitle}. [Open the issue](${store.issueLink.toString()})`;
    });
  const more: number =
    data.moreCount +
    Math.max(0, data.stores.length - MAX_NOT_APPLIED_STORES_LISTED);

  return FeedMarkdown.join(
    [
      data.stores.length === 1
        ? mdText`${describePullRequest(data.fix)} merged a day ago to fix the store below, but when its configuration was read again it still fails the check:`
        : mdText`${describePullRequest(data.fix)} merged a day ago to fix the stores below, but when their configuration was read again they still fail their check:`,
      FeedMarkdown.bulletList(lines),
      ...(more > 0
        ? [
            mdText`And ${String(more)} more ${more === 1 ? "store" : "stores"} the pull request is for.`,
          ]
        : []),
      mdText`An apply is usually what is missing: run the change through your apply (terraform apply, or your pipeline's apply step). Each issue resolves once its store is read again - within the hour of a change CloudTrail records on AWS, otherwise daily - or press Check Now on the store to read it at once.`,
    ],
    "\n\n",
  );
}

// What the timeline says: who was emailed, or that nobody could be.
export function describeNotAppliedLine(data: {
  fix: DataSecurityIssueResolutionFix;
  emailed: number;
}): MarkdownText {
  const told: MarkdownText =
    data.emailed === 0
      ? mdText`Nobody was emailed: the store has no owner, and nobody asked for the pull request.`
      : data.emailed === 1
        ? mdText`1 person was emailed: the store's owners and the pull request's author.`
        : mdText`${String(data.emailed)} people were emailed: the store's owners and the pull request's author.`;

  return mdText`Merged, not applied: ${describePullRequest(data.fix)} merged a day ago, but the store still fails this check when read again. An apply is usually what is missing. ${told}`;
}

export default class DataSecurityFixNotAppliedNotice {
  /*
   * Tell the stores' owners and the pull request's author, and say so on
   * the timelines. Returns how many were emailed.
   */
  public static async send(data: {
    projectId: ObjectID;
    fix: DataSecurityIssueResolutionFix;
    issues: ReadonlyArray<{
      issueId: ObjectID;
      dataStoreId: ObjectID;
      checkId: string;
    }>;
    authorUserId?: ObjectID | undefined;
  }): Promise<number> {
    let emailed: number = 0;

    try {
      const stores: Array<NotAppliedStore> =
        await DataSecurityFixNotAppliedNotice.readStores(data);
      const byRecipient: Map<
        string,
        { user: User; stores: Array<NotAppliedStore> }
      > = new Map();

      for (const store of stores) {
        const owners: Array<User> =
          await DataSecurityIntegrations.getOwnersToNotify({
            projectId: data.projectId,
            dataStoreId: store.dataStoreId,
          });

        for (const owner of owners) {
          const key: string = owner.id?.toString() || "";

          if (!key) {
            continue;
          }

          const entry: { user: User; stores: Array<NotAppliedStore> } =
            byRecipient.get(key) || { user: owner, stores: [] };

          entry.stores.push(store);
          byRecipient.set(key, entry);
        }
      }

      if (data.authorUserId) {
        const author: User | null = await UserService.findOneById({
          id: data.authorUserId,
          select: { _id: true, email: true, name: true },
          props: { isRoot: true },
        });

        if (author?.id) {
          // The author hears of every store: they asked for the whole fix.
          byRecipient.set(author.id.toString(), { user: author, stores });
        }
      }

      const subject: string = getFixNotAppliedSubject({ fix: data.fix });

      for (const entry of Array.from(byRecipient.values()).slice(
        0,
        MAX_NOT_APPLIED_RECIPIENTS,
      )) {
        if (!entry.user.email || !entry.user.id) {
          continue;
        }

        // The template places the message as HTML: written from Markdown, never as it is.
        const message: string = await Markdown.convertToHTML(
          buildFixNotAppliedMarkdown({
            fix: data.fix,
            stores: entry.stores,
            moreCount: 0,
          }).toString(),
          MarkdownContentType.Email,
        );

        emailed++;
        MailService.sendMail(
          {
            toEmail: entry.user.email,
            templateType: EmailTemplateType.SimpleMessage,
            vars: { subject, message },
            subject,
            isSubjectLiteral: true,
          },
          { projectId: data.projectId, userId: entry.user.id },
        ).catch((error: Error) => {
          logger.error(error);
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not email the owners about a merged fix that was not applied: ${error}`,
      );
    }

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId: data.projectId,
      issueIds: data.issues.map((issue: { issueId: ObjectID }): ObjectID => {
        return issue.issueId;
      }),
      eventType: DataSecurityIssueFeedEventType.FixNotApplied,
      storeEventType: DataStoreFeedEventType.IssueFixNotApplied,
      color: Orange500,
      markdown: describeNotAppliedLine({ fix: data.fix, emailed }),
    });

    return emailed;
  }

  // Each issue's store, named, with its check and the issue's link.
  private static async readStores(data: {
    projectId: ObjectID;
    issues: ReadonlyArray<{
      issueId: ObjectID;
      dataStoreId: ObjectID;
      checkId: string;
    }>;
  }): Promise<Array<NotAppliedStore>> {
    if (data.issues.length === 0) {
      return [];
    }

    const records: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(
          data.issues.map((issue: { dataStoreId: ObjectID }): string => {
            return issue.dataStoreId.toString();
          }),
        ),
      } as never,
      select: { _id: true, name: true },
      skip: 0,
      limit: data.issues.length,
      props: { isRoot: true },
    });
    const names: Map<string, string> = new Map(
      records.map((store: DataStore): [string, string] => {
        return [store.id!.toString(), store.name || ""];
      }),
    );
    const stores: Array<NotAppliedStore> = [];

    for (const issue of data.issues) {
      const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
        issue.checkId,
      );

      stores.push({
        issueId: issue.issueId,
        dataStoreId: issue.dataStoreId,
        storeName: names.get(issue.dataStoreId.toString()) || "A store",
        checkTitle: check?.title || "Its check fails",
        issueLink: await DataSecurityIssueService.getIssueLinkInDashboard(
          data.projectId,
          issue.issueId,
        ),
      });
    }

    return stores;
  }
}
