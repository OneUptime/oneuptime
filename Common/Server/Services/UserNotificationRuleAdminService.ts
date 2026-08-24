import DatabaseConfig from "../DatabaseConfig";
import BaseService from "./BaseService";
import MailService from "./MailService";
import ProjectService from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserPushService from "./UserPushService";
import UserService from "./UserService";
import UserSmsService from "./UserSmsService";
import UserTelegramService from "./UserTelegramService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import type AuditLogServiceType from "./AuditLogService";
import { resolveReferenceId } from "../Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../Types/Dictionary";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";

/*
 * THE SHAPE OF THE PROBLEM THIS FILE EXISTS TO SOLVE
 *
 * A UserNotificationRule row is a pair: an OWNERSHIP column (userId) that
 * decides whose on-call pages select the row, and a METHOD foreign key that
 * decides which address the page is delivered to. Those two halves are read at
 * completely different moments by completely different code — the ownership
 * column by UserOnCallLogService when it works out who to page, the method
 * relation by UserNotificationRuleService when it works out where to send — and
 * NOTHING in the ORM, the permission layer or the API surface ever compares
 * them.
 *
 * While every notification model was CurrentUser-only that mismatch was
 * unreachable in practice, because a caller could only ever name their own id
 * in both halves. Phase 3 deliberately widens the rule model so a project admin
 * can repair somebody else's configuration, and the moment an admin may write a
 * row whose userId is not their own, "userId says Bob, userWebhookId says the
 * admin's own webhook" becomes a row an attacker can ask for. It would route
 * every one of Bob's pages to an endpoint the attacker controls, and Bob would
 * see nothing: his rules page still says he is paged, his on-call log still
 * says a page went out.
 *
 * So the widened permission is only half the feature. The other half is here:
 * the value-level invariants that the permission layer structurally cannot
 * express, because it reasons about tables and columns and never about the
 * relationship BETWEEN two column values in one row.
 *
 *   R1  A rule may only be written for a user who is a member of the project
 *       the write is scoped to. Without this, holding ProjectAdmin anywhere
 *       lets you write rules for a user id belonging to any other project.
 *
 *   R3  A rule's method FK must reference a method row owned by the SAME user
 *       as the rule. This is the anti-hijack invariant, and on the update path
 *       the rule's owner is re-read FROM THE DATABASE — a userId in the request
 *       body is the attacker's own input and proves nothing.
 *
 *   R6  When the actor is not the owner, say so out loud: an audit trail keyed
 *       on the server-resolved actor versus the row's PERSISTED owner, and a
 *       mail to the person whose pages just changed.
 *
 * None of these are UI concerns. POST/PATCH /api/user-notification-rule stays
 * reachable with any member session and no dashboard involved, so every one of
 * them is enforced in the service hooks that the API route runs through.
 */

/*
 * One of the nine ways a rule can name a delivery address, reduced to what the
 * ownership guard needs: which column carried it (for the error message and the
 * audit line) and which row it points at.
 */
export interface NotificationMethodReference {
  /** The FK column on UserNotificationRule, e.g. "userWebhookId". */
  idColumn: string;
  /*
   * The property the payload actually used to carry this id: either the FK
   * column itself or the relation slot beside it. Both write the one database
   * column, and a payload may carry both — so a reference has to remember which
   * spelling it came out of, or the ambiguity check below has nothing to talk
   * about.
   */
  suppliedColumn: string;
  /** Human-readable channel name used verbatim in rejection messages. */
  label: string;
  /** The notification-method row the rule points at. */
  methodId: ObjectID;
}

/*
 * A rule-shaped bag of values to read the guarded columns out of — the nine
 * method references AND the ownership column, because both halves of the pair
 * this file exists to compare arrive through the same payload.
 *
 * Create hands us a hydrated UserNotificationRule; update hands us a
 * PartialEntity whose slots may hold an ObjectID, a bare uuid string or a
 * relation object depending on how far through sanitisation the request has
 * travelled. Rather than overload on those, callers cast to this and
 * resolveReferenceId untangles the shapes — the same helper the project-scoped
 * reference guards use, for exactly the same reason.
 */
export type RuleColumnCarrier = Record<string, unknown>;

/*
 * The ownership column in both of its spellings, resolved from the model rather
 * than restated as two string literals.
 */
interface RuleOwnerColumns {
  /** The scalar @CurrentUserCanAccessRecordBy points at, i.e. "userId". */
  idColumn: string;
  /** The ManyToOne beside it whose @JoinColumn names that same scalar. */
  relationColumn: string;
}

/*
 * Why this reads a row rather than being handed one.
 *
 * Every lookup below runs with isRoot props. That is not laziness about
 * permissions: the question being asked is a question about the DATABASE'S
 * state ("who really owns method X", "is user Y really in project P"), and
 * asking it through the caller's own permission scope would let the caller's
 * scope shape the answer. A caller who cannot READ the victim's method row
 * would get `null` back and, under any "not found means fine" reading, sail
 * straight through the guard that exists to stop them.
 */
interface NotificationMethodDescriptor {
  idColumn: string;
  relationColumn: string;
  label: string;
  findOwnerUserId: (methodId: ObjectID) => Promise<ObjectID | undefined>;
}

export class UserNotificationRuleAdminService extends BaseService {
  /*
   * Built per call, never hoisted to module scope.
   *
   * UserEmailService and its six siblings import UserNotificationRuleService,
   * which imports this file — a genuine require cycle. Capturing the service
   * objects in a module-level constant would read `default` while the sibling
   * module is still mid-evaluation and freeze `undefined` into the table. Built
   * inside a method, every service reference resolves at call time, long after
   * the cycle has settled.
   */
  private getNotificationMethodDescriptors(): Array<NotificationMethodDescriptor> {
    return [
      {
        idColumn: "userEmailId",
        relationColumn: "userEmail",
        label: "Email",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserEmailService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userSmsId",
        relationColumn: "userSms",
        label: "SMS",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserSmsService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userCallId",
        relationColumn: "userCall",
        label: "Call",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserCallService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userWhatsAppId",
        relationColumn: "userWhatsApp",
        label: "WhatsApp",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserWhatsAppService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userTelegramId",
        relationColumn: "userTelegram",
        label: "Telegram",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserTelegramService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userSlackId",
        relationColumn: "userSlack",
        label: "Slack",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserSlackService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userMicrosoftTeamsId",
        relationColumn: "userMicrosoftTeams",
        label: "Microsoft Teams",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserMicrosoftTeamsService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userPushId",
        relationColumn: "userPush",
        label: "Push",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserPushService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
      {
        idColumn: "userWebhookId",
        relationColumn: "userWebhook",
        label: "Webhook",
        findOwnerUserId: async (
          methodId: ObjectID,
        ): Promise<ObjectID | undefined> => {
          return (
            await UserWebhookService.findOneById({
              id: methodId,
              select: { _id: true, userId: true },
              props: { isRoot: true },
            })
          )?.userId;
        },
      },
    ];
  }

  /*
   * The nine FK columns, in one place, so a future tenth channel is a single
   * entry rather than a tenth thing to remember. A guard that covers eight of
   * nine covers none: the attacker picks the ninth.
   */
  public getNotificationMethodIdColumns(): Array<string> {
    return this.getNotificationMethodDescriptors().map(
      (descriptor: NotificationMethodDescriptor): string => {
        return descriptor.idColumn;
      },
    );
  }

  /*
   * The ownership column's two spellings, derived from the model rather than
   * restated here as literals.
   *
   * `userId` is a declared @Column; `user` is a @ManyToOne whose @JoinColumn
   * names that same physical column. Two decorated members, one join column,
   * and a payload may carry either or both — exactly the situation that made
   * the method FKs bypassable, reproduced on the column that decides whose
   * pages the row selects.
   *
   * The derivation ("relation name is the scalar minus its `Id` suffix") is the
   * one CreatePermission.checkCreateOwnership uses, and it is deliberate that
   * both places derive rather than hard-code: a model that renames its
   * ownership column must not leave a guard silently reading a property that no
   * longer exists.
   */
  private getRuleOwnerColumns(): RuleOwnerColumns | null {
    const idColumn: string | null = new UserNotificationRule().getUserColumn();

    if (!idColumn || !idColumn.endsWith("Id")) {
      /*
       * No user-scoped column, or one that does not follow the convention, so
       * there is no second spelling to reconcile. Genuinely a no-op rather than
       * a guard opening: with no ownership column there is no ownership to
       * disagree about. Same reasoning as CreatePermission's `if (!userColumn)`.
       */
      return null;
    }

    return {
      idColumn: idColumn,
      relationColumn: idColumn.slice(0, -2),
    };
  }

  /**
   * Refuse a payload whose two spellings of the ownership column name two
   * different users.
   *
   * The exact counterpart of assertOneMethodPerNotificationChannel below, on
   * the other half of the pair this file exists to keep in agreement. A payload
   * saying `userId: <victim>, user: { _id: <me> }` is not a client mistake — no
   * dashboard sends both — it is a request for the guard and the ORM to read
   * different owners, which is precisely how a validated write becomes a
   * different persisted row.
   *
   * Refusing rather than silently preferring one spelling means the correctness
   * of this file never rests on our reading of TypeORM's precedence rule. The
   * fold below then removes the surviving redundancy, so nothing downstream —
   * the roster check, the method-ownership check, CreatePermission, the audit
   * line — has a precedence question left to resolve.
   */
  public assertOneRuleOwner(carrier: RuleColumnCarrier): void {
    const columns: RuleOwnerColumns | null = this.getRuleOwnerColumns();

    if (!columns) {
      return;
    }

    const fromIdColumn: ObjectID | string | undefined = resolveReferenceId(
      carrier[columns.idColumn],
    );
    const fromRelation: ObjectID | string | undefined = resolveReferenceId(
      carrier[columns.relationColumn],
    );

    if (!fromIdColumn || !fromRelation) {
      return;
    }

    /*
     * Case-insensitively, for the reason ProjectScopedReferenceValidator
     * normalises ids: ObjectID keeps whatever case it was handed while Postgres
     * renders `uuid` lower case, so one id in two cases is still one id and
     * must not read as a contradiction.
     */
    if (
      fromIdColumn.toString().toLowerCase() ===
      fromRelation.toString().toLowerCase()
    ) {
      return;
    }

    throw new BadDataException(
      `This notification rule names two different users: ${columns.idColumn} says ${fromIdColumn.toString()} and ${columns.relationColumn} says ${fromRelation.toString()}. Send only one of them.`,
    );
  }

  /**
   * Fold the ownership relation into the ownership scalar so exactly one
   * spelling survives a create.
   *
   * This is the same reduction collapseNotificationMethodRelationsOnCreate
   * performs for the nine method FKs, and the same one
   * CreatePermission.checkCreateOwnership performs for this very column — it
   * validates `user` identically to `userId` and then CLEARS it, because after
   * clearing there is no second source of truth left to disagree with the
   * first. What CreatePermission cannot do is cover the administrator: it
   * returns early for a caller holding a real role permission in the model's
   * create list, which is exactly the caller this phase introduced and exactly
   * the caller who may legitimately name somebody else. On that path the
   * relation reached TypeORM unreduced.
   *
   * The relation's id is what is kept, because that is the value TypeORM would
   * have written: the declared @Column and the relation's @JoinColumn share one
   * ColumnMetadata, and getEntityValue reads the relation slot first, falling
   * back to the scalar only when the relation holds no object. A relation slot
   * that is present but carries no id therefore resolves to nothing, and
   * clearing the scalar alongside it reproduces the NULL the ORM would have
   * written rather than inventing an owner the row will not have.
   *
   * CREATE ONLY, though for a different reason than the method columns: `user`
   * and `userId` are `update: []` for BOTH spellings on this model, so there is
   * no update-path fold to consider at all — an update naming either one is
   * refused outright by ColumnPermission.
   */
  public collapseRuleOwnerRelationOnCreate(carrier: RuleColumnCarrier): void {
    const columns: RuleOwnerColumns | null = this.getRuleOwnerColumns();

    if (!columns) {
      return;
    }

    const relationValue: unknown = carrier[columns.relationColumn];

    if (relationValue === undefined || relationValue === null) {
      // Nothing in this spelling; TypeORM falls through to the scalar already.
      return;
    }

    const resolved: ObjectID | string | undefined =
      resolveReferenceId(relationValue);

    carrier[columns.idColumn] = resolved
      ? resolved instanceof ObjectID
        ? resolved
        : new ObjectID(resolved)
      : undefined;

    carrier[columns.relationColumn] = undefined;
  }

  /**
   * Pull EVERY notification-method reference out of a create payload or an
   * update patch — every channel, and every spelling of every channel.
   *
   * THE BUG THIS SHAPE EXISTS TO PREVENT. `userWebhookId` and `userWebhook` are
   * two decorated members over ONE physical join column, and a request may
   * carry both. This method used to resolve them as
   * `carrier[idColumn] || carrier[relationColumn]`, which validates the FK
   * column and never looks at the relation when both are present. TypeORM
   * resolves the same conflict the other way round: the declared @Column and
   * the relation's @JoinColumn share a single ColumnMetadata, and
   * ColumnMetadata.getEntityValue reads the RELATION first, falling back to the
   * scalar only when the relation slot holds no object.
   *
   * So the id that was checked and the id that was written were different ids,
   * and the caller chose both. Put the rule owner's own method in the FK column
   * to satisfy the guard, and your own row in the relation slot to be
   * persisted, and R3 — the entire anti-hijack invariant — is a formality.
   *
   * The rule is therefore: never short-circuit. Emit one reference per spelling
   * actually present, so the ownership check below has to answer for all of
   * them, and a payload can no longer be right in the half that is inspected
   * and wrong in the half that is written.
   *
   * Duplicates are folded only when they are the SAME id in the same column,
   * where the second lookup could not produce a different answer. Two spellings
   * naming two DIFFERENT ids stay two references on purpose — that is precisely
   * the case worth an extra query.
   *
   * A rule that names no method at all yields an empty array and the ownership
   * guard becomes a no-op — correct, because an opt-out row genuinely has no
   * address to hijack.
   */
  public collectNotificationMethodReferences(
    carrier: RuleColumnCarrier,
  ): Array<NotificationMethodReference> {
    const references: Array<NotificationMethodReference> = [];
    const seen: Set<string> = new Set<string>();

    for (const descriptor of this.getNotificationMethodDescriptors()) {
      const spellings: Array<string> = [
        descriptor.idColumn,
        descriptor.relationColumn,
      ];

      for (const suppliedColumn of spellings) {
        const resolved: ObjectID | string | undefined = resolveReferenceId(
          carrier[suppliedColumn],
        );

        if (!resolved) {
          continue;
        }

        const methodId: ObjectID =
          resolved instanceof ObjectID ? resolved : new ObjectID(resolved);

        /*
         * Ids are compared case-insensitively for the same reason
         * ProjectScopedReferenceValidator normalises them: ObjectID keeps
         * whatever case it was handed, while Postgres renders `uuid` in lower
         * case, so an uppercase spelling and a lowercase one are one id.
         */
        const key: string = `${descriptor.idColumn}:${methodId
          .toString()
          .toLowerCase()}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        references.push({
          idColumn: descriptor.idColumn,
          suppliedColumn: suppliedColumn,
          label: descriptor.label,
          methodId: methodId,
        });
      }
    }

    return references;
  }

  /**
   * Refuse a payload whose two spellings of one method column name two
   * different methods.
   *
   * Validating both spellings (above) closes the hijack: whichever one the ORM
   * picks, it has been checked against the rule's owner. What it does not do is
   * make the write PREDICTABLE — with both slots filled, which address the rule
   * ends up delivering to is decided by a TypeORM precedence rule that no
   * reader of this codebase should have to know, and that a TypeORM upgrade is
   * free to change.
   *
   * "Both spellings, two different methods" is not something a client does by
   * accident; the dashboard sends one. So there is no legitimate request to
   * preserve here, and refusing is strictly better than guessing: the caller is
   * told exactly what is contradictory, and nothing downstream has a precedence
   * question left to resolve.
   *
   * Deliberately NOT run before the ownership check. A payload that is both
   * ambiguous and a hijack attempt should be reported as the hijack — that is
   * the finding an operator needs to see, and "you sent the same field twice"
   * would bury it.
   */
  public assertOneMethodPerNotificationChannel(
    carrier: RuleColumnCarrier,
  ): void {
    for (const descriptor of this.getNotificationMethodDescriptors()) {
      const fromIdColumn: ObjectID | string | undefined = resolveReferenceId(
        carrier[descriptor.idColumn],
      );
      const fromRelation: ObjectID | string | undefined = resolveReferenceId(
        carrier[descriptor.relationColumn],
      );

      if (!fromIdColumn || !fromRelation) {
        continue;
      }

      if (
        fromIdColumn.toString().toLowerCase() ===
        fromRelation.toString().toLowerCase()
      ) {
        continue;
      }

      throw new BadDataException(
        `This notification rule names two different ${descriptor.label} notification methods: ${descriptor.idColumn} says ${fromIdColumn.toString()} and ${descriptor.relationColumn} says ${fromRelation.toString()}. Send only one of them.`,
      );
    }
  }

  /**
   * Fold the relation spelling into the FK column so exactly one spelling
   * survives — the create-path reduction, and the reason the ORM never gets to
   * choose.
   *
   * This mirrors CreatePermission.checkCreateOwnership, which validates the
   * `user` relation identically to the `userId` scalar and then CLEARS it. The
   * point of clearing rather than merely checking is that after it there is no
   * second source of truth left to disagree with the first.
   *
   * The relation's id is what is kept, because that is the value TypeORM would
   * have written: getEntityValue reads the relation slot first. A relation slot
   * that is present but carries no id resolves to nothing, and clearing the FK
   * column alongside it reproduces the NULL the ORM would have written — which
   * matters, because that NULL is what turns a rule into one that pages
   * nowhere, and the create invariants below have to be able to see it.
   *
   * CREATE ONLY. On update the two spellings do not have the same access
   * control: the relation members are `update: []` on UserNotificationRule
   * while the `*Id` members are open to an administrator, so moving a value
   * from the relation slot into the FK column would launder a column write that
   * ColumnPermission (which runs after the update hook) exists to refuse. On
   * that path ambiguity is resolved by refusal instead — see
   * assertOneMethodPerNotificationChannel.
   */
  public collapseNotificationMethodRelationsOnCreate(
    carrier: RuleColumnCarrier,
  ): void {
    for (const descriptor of this.getNotificationMethodDescriptors()) {
      const relationValue: unknown = carrier[descriptor.relationColumn];

      if (relationValue === undefined || relationValue === null) {
        /*
         * Nothing supplied in this spelling. TypeORM falls through to the
         * scalar in exactly this case, so there is nothing to fold and nothing
         * to clear.
         */
        continue;
      }

      const resolved: ObjectID | string | undefined =
        resolveReferenceId(relationValue);

      carrier[descriptor.idColumn] = resolved
        ? resolved instanceof ObjectID
          ? resolved
          : new ObjectID(resolved)
        : undefined;

      carrier[descriptor.relationColumn] = undefined;
    }
  }

  /**
   * Does this payload name a delivery address at all, in any channel, in either
   * spelling?
   *
   * Driven off the descriptor table rather than a hand-written list of fourteen
   * property names. A hand-written list is how an eighth channel ends up
   * exempt from the "a rule must be able to reach somebody" invariant, and an
   * exempt channel is a rule that silently pages nobody.
   */
  public carriesAnyNotificationMethod(carrier: RuleColumnCarrier): boolean {
    for (const descriptor of this.getNotificationMethodDescriptors()) {
      if (carrier[descriptor.idColumn] || carrier[descriptor.relationColumn]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Does this patch MENTION a delivery address, whatever it sets it to?
   *
   * Distinct from carriesAnyNotificationMethod, and the difference is the whole
   * point: `userEmailId: null` carries no method but very much mentions one. It
   * is the write that removes a rule's only way of reaching somebody, so it is
   * exactly the patch the coherence check must not skip.
   */
  public mentionsAnyNotificationMethodColumn(
    carrier: RuleColumnCarrier,
  ): boolean {
    for (const descriptor of this.getNotificationMethodDescriptors()) {
      if (
        carrier[descriptor.idColumn] !== undefined ||
        carrier[descriptor.relationColumn] !== undefined
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * The row's delivery addresses as they would stand AFTER a patch is applied.
   *
   * The create-time invariants ("a rule that pages must name a method", "an
   * opt-out rule must not") are properties of the ROW, and update can break
   * both of them: flipping `isOptOut` on a rule that carries an email, or
   * nulling the only method on a rule that is still meant to page. Neither is
   * visible from the patch alone, so the persisted row has to be read and the
   * two combined.
   *
   * Precedence between the two spellings is the ORM's, not ours: the relation
   * slot wins when it is present, because that is what would be written. A
   * column the patch does not mention keeps whatever the row already had.
   */
  public getNotificationMethodIdsAfterPatch(data: {
    patch: RuleColumnCarrier;
    currentRow: RuleColumnCarrier;
  }): Array<ObjectID> {
    const methodIds: Array<ObjectID> = [];

    for (const descriptor of this.getNotificationMethodDescriptors()) {
      let resolved: ObjectID | string | undefined = undefined;

      if (data.patch[descriptor.relationColumn] !== undefined) {
        resolved = resolveReferenceId(data.patch[descriptor.relationColumn]);
      } else if (data.patch[descriptor.idColumn] !== undefined) {
        resolved = resolveReferenceId(data.patch[descriptor.idColumn]);
      } else {
        resolved = resolveReferenceId(data.currentRow[descriptor.idColumn]);
      }

      if (!resolved) {
        continue;
      }

      methodIds.push(
        resolved instanceof ObjectID ? resolved : new ObjectID(resolved),
      );
    }

    return methodIds;
  }

  /**
   * R1 — the target of an on-behalf-of write must belong to the project the
   * write is scoped to.
   *
   * The create-path ownership gate (CreatePermission.checkCreateOwnership)
   * deliberately steps aside for a caller who holds a real role permission in
   * the model's create list, so that this feature can exist at all. What it
   * hands over is a caller who may name SOME other user — it says nothing about
   * WHICH other users are in scope, because it has no notion of a project
   * roster. Left there, holding ProjectAdmin on one throwaway project would be
   * a licence to write notification rules for any user id in the installation.
   *
   * Membership is read straight from TeamMember with isRoot props and no cache.
   * TeamMemberService.getTeamIdsForUser would have answered the same question
   * with one fewer query, but it memoises for 60 seconds — and a security
   * decision that keeps saying "yes" for a minute after the user was removed
   * from the project is not a security decision.
   *
   * `hasAcceptedInvitation` is part of the test because it is this codebase's
   * own definition of membership (the Owned permission scope resolves teams the
   * same way), and because a pending invitation is an admin-created row: any
   * admin can create one for any email address, so treating one as membership
   * would hand back most of what this guard just took away. Nothing legitimate
   * is lost — a rule must carry a notification method to be created at all, and
   * a user who has not joined the project has none.
   */
  @CaptureSpan()
  public async assertTargetUserIsProjectMember(data: {
    targetUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!projectId) {
      /*
       * A non-root caller writing another user's rule without a tenant scope
       * has nothing to be an admin OF. There is no roster to check them
       * against, so there is no way to say yes.
       */
      throw new BadDataException(
        "A project is required to create a notification rule for another user.",
      );
    }

    const membership: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        userId: data.targetUserId,
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!membership) {
      throw new BadDataException(
        `Cannot create a notification rule for user ${data.targetUserId.toString()} because they are not a member of this project.`,
      );
    }
  }

  /**
   * R3 — the anti-hijack invariant, and the single most important guard in this
   * phase.
   *
   * A rule's method FK is the address its pages are delivered to. Its userId is
   * whose pages select it. If those two can name different people, an admin
   * editing a colleague's rule to point at the ADMIN's own webhook silently
   * redirects that colleague's pages, and every surface either of them can see
   * still reports a healthy configuration.
   *
   * `ownerUserId` MUST be the rule's persisted owner, not a value out of the
   * request body. On update the caller controls the body, so a body-supplied
   * userId lets them claim the row is theirs while writing somebody else's; the
   * callers in UserNotificationRuleService therefore re-read it from the
   * database first, and pass what the database said.
   *
   * A method row that does not exist is rejected rather than ignored. "Not
   * found" and "not yours" are the same answer here — in both cases the caller
   * named a row they have no business naming — and a guard whose failure mode
   * is `undefined === undefined` is a guard that opens on the one input it was
   * written to reject.
   */
  @CaptureSpan()
  public async assertNotificationMethodsBelongToUser(data: {
    ownerUserId: ObjectID | undefined;
    references: Array<NotificationMethodReference>;
  }): Promise<void> {
    if (data.references.length === 0) {
      return;
    }

    if (!data.ownerUserId) {
      /*
       * An unowned rule is not a safe rule. Its userId decides whose pages
       * select it, so a row that names an address but no owner is a row nobody
       * can be shown and nobody can audit. Reject rather than skip the check.
       */
      throw new BadDataException(
        "A notification rule that names a notification method must have an owner.",
      );
    }

    const descriptorsByColumn: Map<string, NotificationMethodDescriptor> =
      new Map<string, NotificationMethodDescriptor>();

    for (const descriptor of this.getNotificationMethodDescriptors()) {
      descriptorsByColumn.set(descriptor.idColumn, descriptor);
    }

    for (const reference of data.references) {
      const descriptor: NotificationMethodDescriptor | undefined =
        descriptorsByColumn.get(reference.idColumn);

      if (!descriptor) {
        /*
         * Unreachable while references only ever come from
         * collectNotificationMethodReferences, which builds them from this same
         * table. Refusing an unknown column rather than skipping it keeps that
         * true if the two ever drift.
         */
        throw new BadDataException(
          `Unknown notification method column ${reference.idColumn}.`,
        );
      }

      const methodOwnerUserId: ObjectID | undefined =
        await descriptor.findOwnerUserId(reference.methodId);

      if (!methodOwnerUserId) {
        throw new BadDataException(
          `The ${descriptor.label} notification method referenced by this rule does not exist.`,
        );
      }

      if (methodOwnerUserId.toString() !== data.ownerUserId.toString()) {
        /*
         * The spelling is named at the end rather than woven into the sentence
         * so that the wording support runbooks and tests match on stays intact.
         * It earns its place because the two spellings are one column: told only
         * "your Email method is wrong", a caller looking at a payload whose
         * `userEmailId` is perfectly correct has no way to see that the relation
         * slot beside it is the problem.
         */
        throw new BadDataException(
          `The ${descriptor.label} notification method referenced by this rule belongs to a different user. A notification rule can only use notification methods owned by the user the rule belongs to. The offending value was sent in ${reference.suppliedColumn}.`,
        );
      }
    }
  }

  /**
   * R6 — record and announce a change one person made to another person's
   * paging configuration.
   *
   * Both halves are keyed on `props.userId` — the actor the SERVER resolved
   * from the session — versus the row's PERSISTED userId, read back after the
   * write. Nothing here reads the request body: the body is the thing under
   * suspicion, and an audit line that an attacker can author is worse than no
   * audit line, because it looks like evidence.
   *
   * Nothing in here may break the write. The row is already committed by the
   * time this runs; throwing now would report a failure for a change that
   * happened, and the caller would be entitled to believe it did not. So the
   * whole body is a try/catch, and the mail is fire-and-forget on top of that.
   */
  @CaptureSpan()
  public async recordAdminRuleChange(data: {
    action: AuditLogAction;
    actorUserId: ObjectID;
    ownerUserId: ObjectID;
    projectId: ObjectID | undefined;
    /*
     * `null` as well as `undefined`, because BaseModel.id is a getter over
     * `_id` and returns null for a row that has none. Both mean the same thing
     * here — no row to point the audit entry at — and typing only one of them
     * makes every call site cast.
     */
    ruleId: ObjectID | null | undefined;
    /*
     * The row as it stood before the write. Absent on create. On delete this is
     * the whole of the record that is left: the row is gone, so this snapshot
     * is the only description of what the project just lost.
     */
    before?: UserNotificationRule | undefined;
    /** The row as it stands after the write. Absent on update and delete. */
    after?: UserNotificationRule | undefined;
    /** The patch, for the update diff. Absent on create and delete. */
    updatedFields?: JSONObject | undefined;
    /*
     * Whether to mail the owner. The audit entry is per ROW because that is
     * what an investigator needs to reconstruct; the mail is per PERSON,
     * because one request that touches twenty of somebody's rules is still one
     * thing that happened to them, and twenty identical mails is how a warning
     * becomes a filter rule.
     */
    notifyOwner: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      /*
       * The dependable half of the trail. AuditLogService below only writes on
       * enterprise builds with audit logs switched on for the project, which is
       * a minority of installs — and "an admin edited somebody else's paging"
       * is exactly the event an operator needs to be able to find on the other
       * ones too.
       */
      logger.info(
        `On-call notification rule ${data.action.toLowerCase()}d for user ${data.ownerUserId.toString()} by a different user ${data.actorUserId.toString()}.`,
        {
          projectId: data.projectId?.toString(),
          userId: data.ownerUserId.toString(),
          actorUserId: data.actorUserId.toString(),
          userNotificationRuleId: data.ruleId?.toString(),
          action: data.action,
        } as LogAttributes,
      );

      await this.writeAuditLog(data);

      if (!data.notifyOwner) {
        return;
      }

      /*
       * Fire-and-forget by construction: the owner's mail involves three more
       * reads and an SMTP round trip, none of which the writing request should
       * wait on and none of which may surface as a failed write.
       */
      this.notifyOwnerOfAdminChange({
        action: data.action,
        actorUserId: data.actorUserId,
        ownerUserId: data.ownerUserId,
        projectId: data.projectId,
      }).catch((error: Error): void => {
        logger.error(
          `UserNotificationRuleAdminService: failed to tell user ${data.ownerUserId.toString()} that an admin changed their on-call notification rules.`,
        );
        logger.error(error);
      });
    } catch (error) {
      logger.error(
        "UserNotificationRuleAdminService: failed to record an administrative notification rule change.",
      );
      logger.error(error);
    }
  }

  /*
   * The AuditLog analytics row, written directly rather than through
   * DatabaseService's own audit hook.
   *
   * DatabaseService writes one automatically for models decorated with
   * @EnableAuditLog, and UserNotificationRule is not one of them — so without
   * this call an administrative edit leaves no row at all. The decorator is
   * checked anyway so that adding it later produces one entry rather than two:
   * a duplicated audit record is not merely noise, it makes a reader count two
   * changes where one happened.
   *
   * Required lazily for the same reason DatabaseService requires it lazily —
   * AuditLogService depends on ProjectService and UserService, both of which
   * extend DatabaseService, so a top-level import can leave the base class
   * undefined at class-extension time.
   */
  private async writeAuditLog(data: {
    action: AuditLogAction;
    ruleId: ObjectID | null | undefined;
    before?: UserNotificationRule | undefined;
    after?: UserNotificationRule | undefined;
    updatedFields?: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const model: UserNotificationRule = new UserNotificationRule();

    if (model.enableAuditLogOn) {
      // DatabaseService already writes this row; a second one would double-count.
      return;
    }

    const auditLogService: typeof AuditLogServiceType =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("./AuditLogService").default;

    if (data.action === AuditLogAction.Create && data.after) {
      await auditLogService.recordCreate({
        model: model,
        createdItem: data.after,
        props: data.props,
      });

      return;
    }

    if (data.action === AuditLogAction.Update && data.before && data.ruleId) {
      await auditLogService.recordUpdate({
        model: model,
        before: data.before,
        updatedFields: data.updatedFields || {},
        itemId: data.ruleId,
        props: data.props,
      });

      return;
    }

    /*
     * Delete is the one action whose audit entry cannot be reconstructed after
     * the fact. An edited row can still be read; a deleted one cannot, so the
     * snapshot captured before the write is the entire record of what the
     * responder's paging used to be.
     */
    if (data.action === AuditLogAction.Delete && data.before && data.ruleId) {
      await auditLogService.recordDelete({
        model: model,
        deletedItem: data.before,
        itemId: data.ruleId,
        props: data.props,
      });
    }
  }

  /*
   * Tell the person whose pages just changed.
   *
   * This is the part of the phase that makes admin repair safe to hand out
   * rather than merely possible: an admin fixing a colleague's rules is a
   * normal, welcome thing, and an attacker redirecting them is not, and from
   * the server's side those two are the same request. The only reliable way to
   * tell them apart is to ask the one person who always knows which it was.
   */
  private async notifyOwnerOfAdminChange(data: {
    action: AuditLogAction;
    actorUserId: ObjectID;
    ownerUserId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    const owner: User | null = await UserService.findOneById({
      id: data.ownerUserId,
      select: {
        _id: true,
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!owner || !owner.email) {
      return;
    }

    const actor: User | null = await UserService.findOneById({
      id: data.actorUserId,
      select: {
        _id: true,
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * Naming the actor by email as well as by name is deliberate. Display names
     * are not unique and are user-editable, so "Alex changed your rules" is not
     * something the reader can act on; an address is.
     */
    const actorDescription: string = actor
      ? `${actor.name?.toString() || "A project administrator"} (${
          actor.email?.toString() || data.actorUserId.toString()
        })`
      : `A project administrator (${data.actorUserId.toString()})`;

    let projectName: string = "your project";

    if (data.projectId) {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (project?.name) {
        projectName = project.name;
      }
    }

    let verb: string = "changed";

    if (data.action === AuditLogAction.Create) {
      verb = "added";
    }

    if (data.action === AuditLogAction.Delete) {
      verb = "deleted";
    }

    const subject: string = `Your on-call notification rules were ${verb} by an administrator`;

    const settingsLink: string = data.projectId
      ? (
          await this.getNotificationRulesLinkInDashboard(data.projectId)
        ).toString()
      : "";

    /*
     * Deletion gets its own sentence rather than the generic one. "Somebody
     * changed your rules" is a prompt to go and look; "you may no longer be
     * paged" is the consequence, and it is the only one of the three actions
     * that can leave a responder silently unreachable — which is the failure
     * this whole epic exists to stop happening unnoticed.
     */
    const consequence: string =
      data.action === AuditLogAction.Delete
        ? "Your notification rules decide how OneUptime reaches you when you are paged. With them removed you may no longer be notified when you are on call, so add new rules if this was not what you expected, and tell your project owners."
        : "Your notification rules decide how OneUptime reaches you when you are paged. If you were not expecting this change, review your rules now and tell your project owners.";

    const message: string = `${this.escapeHtml(actorDescription)} ${verb} your on-call notification rules in ${this.escapeHtml(
      projectName,
    )}.<br/><br/>${consequence}${
      settingsLink
        ? `<br/><br/><a href="${this.escapeHtml(settingsLink)}">Review your notification rules</a>`
        : ""
    }`;

    const vars: Dictionary<string> = {
      subject: subject,
      message: message,
    };

    await MailService.sendMail(
      {
        toEmail: owner.email,
        templateType: EmailTemplateType.SimpleMessage,
        vars: vars,
        subject: subject,
      },
      {
        projectId: data.projectId,
        userId: owner.id!,
      },
    );
  }

  private async getNotificationRulesLinkInDashboard(
    projectId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    /*
     * Spelled out rather than imported: Common/Server cannot reach the
     * Dashboard's RouteMap, the same reason
     * OnCallNotificationAlertingService.getNotificationRulesLinkInDashboard
     * duplicates its path segments.
     */
    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/user-settings/notification-methods`,
    );
  }

  /*
   * SimpleMessage.hbs renders `message` through a triple-stache InfoBlock
   * partial, so nothing between here and the recipient's inbox escapes
   * anything. Project names and user names are attacker-influenced free text.
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export default new UserNotificationRuleAdminService();
