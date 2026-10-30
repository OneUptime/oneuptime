import DataStore from "../../../Models/DatabaseModels/DataStore";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Select from "../../Types/Database/Select";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
  getDataStoreKeyOfEntityValue,
  isDataStoreEntityValue,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { NotifyDataStoreOwnersConfig } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  SecurityCaseTemplateValues,
  renderSecurityCaseTemplate,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import DataStoreService from "../../Services/DataStoreService";
import MailService from "../../Services/MailService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import { getEffectiveStoreSensitivity } from "../DataSecurity/DataSecurityCriticalitySync";
import DataSecurityIntegrations from "../DataSecurity/DataSecurityIntegrations";
import RuleRecordScope from "../Rules/RuleRecordScope";
import type {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "./SecurityPlaybookActions";

/*
 * NOTIFY DATA STORE OWNERS: the people who answer for a bucket or a
 * database hear that a security case is about it.
 *
 * A case Data Security opened, or one a detection rule grouped on a store,
 * names the store as a Data Store entity ("data-store:" and its key). For
 * each - at most MAX_NOTIFIED_DATA_STORES - the step finds the store and
 * its owners as Data Security lists them, directly or through a team
 * (DataSecurityIntegrations.getOwnerUsers), and emails each owner once,
 * naming the stores of theirs the case is about. Nobody who has left the
 * project is emailed, as Email people emails nobody outside it.
 *
 * The email says which store, how sensitive it is and where the case is -
 * never the rest of the case, which its owners may not be cleared to read;
 * a message the playbook's author wrote leads it, with the case put in.
 * A store without an owner is named in the step's details, so the playbook
 * shows whose stores nobody answers for.
 */

// The most data stores one step emails the owners of.
export const MAX_NOTIFIED_DATA_STORES: number = 10;

const ROOT: { isRoot: true } = { isRoot: true };

function succeeded(
  summary: MarkdownText,
  extra?: Partial<PlaybookStepOutcome>,
): PlaybookStepOutcome {
  return { status: SecurityPlaybookStepStatus.Succeeded, summary, ...extra };
}

function failed(error: string, summary?: MarkdownText): PlaybookStepOutcome {
  return {
    status: SecurityPlaybookStepStatus.Failed,
    summary: summary || FeedMarkdown.empty(),
    error,
  };
}

function skipped(
  summary: MarkdownText,
  extra?: Partial<PlaybookStepOutcome>,
): PlaybookStepOutcome {
  return { status: SecurityPlaybookStepStatus.Skipped, summary, ...extra };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

/*
 * The keys of the data stores a case names, each once, in its order: its
 * Data Store entities, and a value of one an older case kept as Other.
 */
export function getCaseDataStoreKeys(
  entities: ReadonlyArray<SecurityEntity>,
): Array<string> {
  const keys: Array<string> = [];

  for (const entity of entities) {
    if (
      entity.type !== SecurityEntityType.DataStore &&
      !isDataStoreEntityValue(entity.value)
    ) {
      continue;
    }

    const key: string = getDataStoreKeyOfEntityValue(entity.value);

    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys.slice(0, MAX_NOTIFIED_DATA_STORES);
}

// One store as its owners' email names it.
export function describeOwnedStore(
  store: Pick<
    DataStore,
    "name" | "storeKey" | "sensitivity" | "sensitivityOverride"
  >,
): MarkdownText {
  const sensitivity: DataSensitivity = getEffectiveStoreSensitivity(store);

  return mdText`**${store.name || store.storeKey || ""}** (${sensitivity} data)`;
}

// What one owner is emailed: the case, the stores of theirs it is about, and the way to it.
export function buildDataStoreOwnersMessage(data: {
  values: SecurityCaseTemplateValues;
  stores: Array<
    Pick<DataStore, "name" | "storeKey" | "sensitivity" | "sensitivityOverride">
  >;
  template?: string | undefined;
}): MarkdownText {
  const lead: MarkdownText =
    data.template && data.template.trim()
      ? renderSecurityCaseTemplate(data.template, data.values)
      : mdText`Security case **${data.values.number}**, ${data.values.title}, is about ${
          data.stores.length === 1 ? "a data store" : "data stores"
        } you own:`;

  return FeedMarkdown.join(
    [
      lead,
      FeedMarkdown.bulletList(data.stores.map(describeOwnedStore)),
      FeedMarkdown.link("Open the case", data.values.url),
    ],
    "\n\n",
  );
}

/*
 * The stores a case names, found by their key - or by their id, which an
 * issue without a key names - in the case's order, each once. Every step
 * that acts on a case's data stores finds them here (the response steps
 * too: SecurityPlaybookDataStoreResponse).
 */
export async function findCaseDataStores(
  projectId: ObjectID,
  keys: Array<string>,
  extraSelect: Select<DataStore> = {},
): Promise<Array<DataStore>> {
  const select: Select<DataStore> = {
    ...extraSelect,
    _id: true,
    name: true,
    storeKey: true,
    sensitivity: true,
    sensitivityOverride: true,
  };

  const byKey: Array<DataStore> = await DataStoreService.findBy({
    query: { projectId, storeKey: new Includes(keys) },
    select,
    skip: 0,
    limit: keys.length,
    props: ROOT,
  });

  const found: Set<string> = new Set(
    byKey.map((store: DataStore): string => {
      return store.storeKey || "";
    }),
  );
  const ids: Array<ObjectID> = keys
    .filter((key: string): boolean => {
      return !found.has(key) && ObjectID.isValidUUID(key);
    })
    .map((key: string): ObjectID => {
      return new ObjectID(key);
    });

  const byId: Array<DataStore> =
    ids.length > 0
      ? await DataStoreService.findBy({
          query: { projectId, _id: new Includes(ids) },
          select,
          skip: 0,
          limit: ids.length,
          props: ROOT,
        })
      : [];

  // In the case's order, each store once.
  const stores: Array<DataStore> = [];

  for (const key of keys) {
    const store: DataStore | undefined = [...byKey, ...byId].find(
      (candidate: DataStore): boolean => {
        return candidate.storeKey === key || candidate.id?.toString() === key;
      },
    );

    if (
      store &&
      !stores.some((kept: DataStore): boolean => {
        return kept.id?.toString() === store.id?.toString();
      })
    ) {
      stores.push(store);
    }
  }

  return stores;
}

// A store's owners who are still members of the project.
async function findOwners(
  projectId: ObjectID,
  store: DataStore,
): Promise<Array<User>> {
  const owners: Array<User> = await DataSecurityIntegrations.getOwnerUsers(
    store.id!,
  );
  const ids: Array<string> = owners
    .filter((owner: User): boolean => {
      return Boolean(owner.id && owner.email);
    })
    .map((owner: User): string => {
      return owner.id!.toString();
    });

  if (ids.length === 0) {
    return [];
  }

  const kept: Set<string> = new Set(
    await RuleRecordScope.keepIdsInProject({
      projectId,
      ids,
      modelType: User,
      description: "owners of a data store a security playbook step emails",
      logAttributes: { projectId: projectId.toString() },
    }),
  );

  return owners.filter((owner: User): boolean => {
    return Boolean(owner.id && kept.has(owner.id.toString()));
  });
}

export default class SecurityPlaybookDataStoreOwners {
  public static async notify(
    context: PlaybookStepContext,
    values: SecurityCaseTemplateValues,
  ): Promise<PlaybookStepOutcome> {
    const config: NotifyDataStoreOwnersConfig = (context.step.config ||
      {}) as unknown as NotifyDataStoreOwnersConfig;
    const keys: Array<string> = getCaseDataStoreKeys(
      mergeSecurityEntities(
        (context.securityCase.entities ||
          []) as unknown as Array<SecurityEntity>,
      ),
    );

    if (keys.length === 0) {
      return skipped(mdText`The case names no data store.`);
    }

    const stores: Array<DataStore> = await findCaseDataStores(
      context.projectId,
      keys,
    );

    if (stores.length === 0) {
      return skipped(
        mdText`The data stores the case names are no longer in Data Security.`,
      );
    }

    // Each owner once, with every store of theirs the case is about.
    const recipients: Map<string, { user: User; stores: Array<DataStore> }> =
      new Map();
    const withoutOwners: Array<DataStore> = [];

    for (const store of stores) {
      const owners: Array<User> = await findOwners(context.projectId, store);

      if (owners.length === 0) {
        withoutOwners.push(store);
        continue;
      }

      for (const owner of owners) {
        const key: string = owner.id!.toString();
        const recipient: { user: User; stores: Array<DataStore> } =
          recipients.get(key) || { user: owner, stores: [] };

        recipient.stores.push(store);
        recipients.set(key, recipient);
      }
    }

    const withoutOwnersLines: Array<MarkdownText> = withoutOwners.map(
      (store: DataStore): MarkdownText => {
        return mdText`${describeOwnedStore(store)} has no owner.`;
      },
    );

    if (recipients.size === 0) {
      return skipped(
        withoutOwners.length === 1
          ? mdText`No owner to email: the data store the case is about has none.`
          : mdText`No owner to email: none of the ${String(withoutOwners.length)} data stores the case is about has one.`,
        { detailsInMarkdown: FeedMarkdown.bulletList(withoutOwnersLines) },
      );
    }

    const subject: string = `[${values.number}] ${values.title}`;
    const notSent: Array<string> = [];

    for (const recipient of recipients.values()) {
      try {
        const html: string = await Markdown.convertToHTML(
          buildDataStoreOwnersMessage({
            values,
            stores: recipient.stores,
            template: config.message,
          }).toString(),
          MarkdownContentType.Email,
        );

        await MailService.sendMail(
          {
            toEmail: new Email(recipient.user.email!.toString()),
            templateType: EmailTemplateType.SimpleMessage,
            vars: { subject, message: html },
            subject,
            isSubjectLiteral: true,
          },
          {
            projectId: context.projectId,
            userId: recipient.user.id || undefined,
            timeoutInMs: 20000,
          },
        );
      } catch (error) {
        notSent.push(
          `${recipient.user.email?.toString() || ""}: ${errorMessage(error)}`,
        );
      }
    }

    const sent: number = recipients.size - notSent.length;
    const notifiedStores: number = stores.length - withoutOwners.length;

    if (sent === 0) {
      return failed(`No email was sent. ${notSent.join(" ")}`);
    }

    const details: Array<MarkdownValue> = [
      ...withoutOwnersLines,
      ...notSent.map((line: string): MarkdownText => {
        return mdText`Not emailed: ${line}`;
      }),
    ];

    return succeeded(
      mdText`Emailed ${plural(sent, "owner", "owners")} of ${plural(
        notifiedStores,
        "data store",
        "data stores",
      )}${
        notSent.length > 0
          ? mdText`; ${String(notSent.length)} could not be emailed`
          : FeedMarkdown.empty()
      }.`,
      {
        feedEventType: SecurityCaseFeedEventType.Notification,
        detailsInMarkdown:
          details.length > 0 ? FeedMarkdown.bulletList(details) : undefined,
      },
    );
  }
}
