import ProjectReferencesService from "./ProjectReferencesService";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRuleEngineService from "./IncomingCallPolicyLabelRuleEngineService";
import IncomingCallPolicyOwnerRuleEngineService from "./IncomingCallPolicyOwnerRuleEngineService";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import releaseIncomingCallPhoneNumber from "../Utils/IncomingCallPhoneNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import IncomingCallPolicyPhoneNumberService from "./IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyPhoneNumber from "../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import BadDataException from "../../Types/Exception/BadDataException";
import QueryHelper from "../Types/Database/QueryHelper";
import ObjectID from "../../Types/ObjectID";
import IncomingCallPolicyOwnerTeamService from "./IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "./IncomingCallPolicyOwnerUserService";
import TeamMemberService from "./TeamMemberService";
import IncomingCallPolicyOwnerTeam from "../../Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "../../Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import User from "../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Select from "../Types/Database/Select";

function normalizeProjectCallSMSConfigIdValue(
  value: unknown,
): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || value instanceof ObjectID) {
    return value.toString().trim().toLowerCase();
  }

  return undefined;
}

function normalizeProjectCallSMSConfigId(
  value: unknown,
): string | null | undefined {
  const directId: string | null | undefined =
    normalizeProjectCallSMSConfigIdValue(value);

  if (directId !== undefined) {
    return directId;
  }

  if (typeof value !== "object" || value === undefined) {
    return undefined;
  }

  const relation: { id?: unknown; _id?: unknown } = value as {
    id?: unknown;
    _id?: unknown;
  };
  const persistedId: string | null | undefined =
    normalizeProjectCallSMSConfigIdValue(relation._id);
  const publicId: string | null | undefined =
    normalizeProjectCallSMSConfigIdValue(relation.id);

  if (
    persistedId !== undefined &&
    publicId !== undefined &&
    persistedId !== publicId
  ) {
    throw new BadDataException(
      "Conflicting Twilio configuration identifiers were provided.",
    );
  }

  /*
   * TypeORM persists `_id`, while model instances also expose `id`. Prefer the
   * persisted value after proving both representations agree so a crafted
   * relation object cannot make the invariant inspect one config and save
   * another.
   */
  return persistedId !== undefined ? persistedId : publicId;
}

export class Service extends ProjectReferencesService<IncomingCallPolicy> {
  public constructor() {
    super(IncomingCallPolicy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncomingCallPolicy>,
  ): Promise<OnUpdate<IncomingCallPolicy>> {
    await super.onBeforeUpdate(updateBy);

    const hasProjectCallSMSConfigId: boolean =
      Object.prototype.hasOwnProperty.call(
        updateBy.data,
        "projectCallSMSConfigId",
      );
    const hasProjectCallSMSConfig: boolean =
      Object.prototype.hasOwnProperty.call(
        updateBy.data,
        "projectCallSMSConfig",
      );

    const requestedProjectCallSMSConfigIds: Array<string | null> = [];

    if (hasProjectCallSMSConfigId) {
      const configId: string | null | undefined =
        normalizeProjectCallSMSConfigId(updateBy.data.projectCallSMSConfigId);

      if (configId !== undefined) {
        requestedProjectCallSMSConfigIds.push(configId);
      }
    }

    if (hasProjectCallSMSConfig) {
      const configId: string | null | undefined =
        normalizeProjectCallSMSConfigId(updateBy.data.projectCallSMSConfig);

      if (configId !== undefined) {
        requestedProjectCallSMSConfigIds.push(configId);
      }
    }

    if (requestedProjectCallSMSConfigIds.length > 0) {
      /*
       * The policies the update writes - the ones its caller may write - with
       * the update held to them, so the invariant neither discloses nor
       * blocks a policy the caller may not update, and no policy is written
       * that it did not check.
       */
      const policies: Array<IncomingCallPolicy> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          projectCallSMSConfigId: true,
          routingPhoneNumber: true,
          callProviderPhoneNumberId: true,
        });

      const policiesChangingConfig: Array<IncomingCallPolicy> = policies.filter(
        (policy: IncomingCallPolicy): boolean => {
          const currentConfigId: string | null =
            policy.projectCallSMSConfigId?.toString().trim().toLowerCase() ||
            null;

          return requestedProjectCallSMSConfigIds.some(
            (requestedConfigId: string | null): boolean => {
              return requestedConfigId !== currentConfigId;
            },
          );
        },
      );

      const hasLegacyPhoneNumber: boolean = policiesChangingConfig.some(
        (policy: IncomingCallPolicy): boolean => {
          return Boolean(
            policy.routingPhoneNumber || policy.callProviderPhoneNumberId,
          );
        },
      );

      if (hasLegacyPhoneNumber) {
        throw new BadDataException(
          "Release all phone numbers before changing the Twilio configuration.",
        );
      }

      const policyIds: Array<ObjectID> = policiesChangingConfig
        .map((policy: IncomingCallPolicy): ObjectID | null | undefined => {
          return policy.id;
        })
        .filter(
          (policyId: ObjectID | null | undefined): policyId is ObjectID => {
            return Boolean(policyId);
          },
        );

      if (policyIds.length > 0) {
        const attachedPhoneNumber: IncomingCallPolicyPhoneNumber | null =
          await IncomingCallPolicyPhoneNumberService.findOneBy({
            query: {
              incomingCallPolicyId: QueryHelper.any(policyIds),
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (attachedPhoneNumber) {
          throw new BadDataException(
            "Release all phone numbers before changing the Twilio configuration.",
          );
        }
      }
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncomingCallPolicy>,
  ): Promise<OnDelete<IncomingCallPolicy>> {
    /*
     * Release any provisioned numbers before the policy rows are removed so we
     * don't leave paid, orphaned numbers on the provider that can never be
     * released again (the policy — and its SID — would be gone). Only the
     * policies the delete removes - the ones the caller may delete, in the
     * delete's own window - are read, and the delete is held to exactly them
     * before any provider call, so a window that shifts while the provider
     * answers cannot change which rows go. DatabaseService asks the caller's
     * permission once more right before deleting.
     */
    const policies: Array<IncomingCallPolicy> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      });

    for (const policy of policies) {
      if (!policy.id) {
        continue;
      }

      const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> =
        await IncomingCallPolicyPhoneNumberService.findAllBy({
          query: {
            incomingCallPolicyId: policy.id,
          },
          select: {
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
          },
          props: {
            isRoot: true,
          },
        });

      const releasedProviderPhoneNumberIds: Set<string> = new Set();

      for (const phoneNumber of phoneNumbers) {
        if (
          !phoneNumber.callProviderPhoneNumberId ||
          !phoneNumber.projectCallSMSConfigId
        ) {
          continue;
        }

        await releaseIncomingCallPhoneNumber({
          projectCallSMSConfigId: phoneNumber.projectCallSMSConfigId,
          callProviderPhoneNumberId: phoneNumber.callProviderPhoneNumberId,
        });

        releasedProviderPhoneNumberIds.add(
          phoneNumber.callProviderPhoneNumberId,
        );
      }

      /*
       * Compatibility for policies which still use the scalar-only layout:
       * do not orphan their provider number while normalized rows are absent.
       */
      if (
        policy.callProviderPhoneNumberId &&
        policy.projectCallSMSConfigId &&
        !releasedProviderPhoneNumberIds.has(policy.callProviderPhoneNumberId)
      ) {
        await releaseIncomingCallPhoneNumber({
          projectCallSMSConfigId: policy.projectCallSMSConfigId,
          callProviderPhoneNumberId: policy.callProviderPhoneNumberId,
        });
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * The people who own this policy: its owner users, plus the accepted
   * members of its owner teams, once each. Owners who are no longer accepted
   * members of the project are left out. Empty means nobody owns the policy,
   * which callers treat as "tell the project owners".
   */
  @CaptureSpan()
  public async findOwners(
    incomingCallPolicyId: ObjectID,
  ): Promise<Array<User>> {
    if (!incomingCallPolicyId) {
      throw new BadDataException("incomingCallPolicyId is required");
    }

    const ownerUsers: Array<IncomingCallPolicyOwnerUser> =
      await IncomingCallPolicyOwnerUserService.findBy({
        query: {
          incomingCallPolicyId: incomingCallPolicyId,
        },
        select: {
          _id: true,
          projectId: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          } as Select<User>,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const ownerTeams: Array<IncomingCallPolicyOwnerTeam> =
      await IncomingCallPolicyOwnerTeamService.findBy({
        query: {
          incomingCallPolicyId: incomingCallPolicyId,
        },
        select: {
          _id: true,
          projectId: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> = [];
    const seenUserIds: Set<string> = new Set<string>();

    const addUser: (user: User | undefined) => void = (
      user: User | undefined,
    ): void => {
      const userId: string | undefined = user?.id?.toString();

      if (!user || !userId || seenUserIds.has(userId)) {
        return;
      }

      seenUserIds.add(userId);
      users.push(user);
    };

    for (const ownerUser of ownerUsers) {
      addUser(ownerUser.user);
    }

    const teamIds: Array<ObjectID> = ownerTeams
      .map((ownerTeam: IncomingCallPolicyOwnerTeam): ObjectID | undefined => {
        return ownerTeam.teamId;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    if (teamIds.length > 0) {
      /*
       * Accepted rows only: a pending invitation to an owner team grants
       * none of the team's permissions, so it does not make anyone an owner.
       */
      const teamUsers: Array<User> = await TeamMemberService.getUsersInTeams(
        teamIds,
        { acceptedOnly: true },
      );

      for (const teamUser of teamUsers) {
        addUser(teamUser);
      }
    }

    const projectId: ObjectID | undefined =
      ownerUsers[0]?.projectId || ownerTeams[0]?.projectId;

    if (!projectId) {
      return [];
    }

    // Owners who left the project are not told about its calls.
    return await TeamMemberService.filterUsersToProjectMembers({
      projectId: projectId,
      users: users,
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<IncomingCallPolicy>,
    createdItem: IncomingCallPolicy,
  ): Promise<IncomingCallPolicy> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await IncomingCallPolicyLabelRuleEngineService.applyRulesToIncomingCallPolicy(
            createdItem,
          );
        })
        .then(async () => {
          await IncomingCallPolicyOwnerRuleEngineService.applyRulesToIncomingCallPolicy(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying incoming call policy rules in IncomingCallPolicyService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incomingCallPolicyId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }
}

export default new Service();
