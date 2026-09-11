import DatabaseService from "./DatabaseService";
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
import ModelPermission from "../Types/Database/Permissions/Index";

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

export class Service extends DatabaseService<IncomingCallPolicy> {
  public constructor() {
    super(IncomingCallPolicy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncomingCallPolicy>,
  ): Promise<OnUpdate<IncomingCallPolicy>> {
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
       * Hooks run before DatabaseService applies update permissions. Scope the
       * query here before inspecting rows, otherwise the invariant itself can
       * disclose or block policies that the caller is not allowed to update.
       * DatabaseService deliberately checks it again immediately before the
       * write, preserving its normal authorization boundary.
       */
      updateBy.query = await ModelPermission.checkUpdateQueryPermissions(
        IncomingCallPolicy,
        updateBy.query,
        updateBy.data,
        updateBy.props,
      );

      const policies: Array<IncomingCallPolicy> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          projectCallSMSConfigId: true,
          routingPhoneNumber: true,
          callProviderPhoneNumberId: true,
        },
        limit: updateBy.limit,
        skip: updateBy.skip,
        props: {
          isRoot: true,
        },
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
     * The delete hook performs provider side effects before DatabaseService's
     * normal delete permission check. Apply that exact scope first so a
     * denied delete cannot release phone numbers belonging to another tenant
     * or access-control scope.
     */
    deleteBy.query = await ModelPermission.checkDeleteQueryPermission(
      IncomingCallPolicy,
      deleteBy.query,
      deleteBy.props,
    );

    /*
     * Release any provisioned numbers before the policy rows are removed so we
     * don't leave paid, orphaned numbers on the provider that can never be
     * released again (the policy — and its SID — would be gone).
     */
    const policies: Array<IncomingCallPolicy> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
    });

    const policyIds: Array<ObjectID> = policies
      .map((policy: IncomingCallPolicy): ObjectID | null => {
        return policy.id;
      })
      .filter((policyId: ObjectID | null): policyId is ObjectID => {
        return Boolean(policyId);
      });

    /*
     * Provider calls can take long enough for the original offset/limit window
     * to shift. Pin the final database delete to this exact snapshot before
     * making any external calls. DatabaseService re-applies permissions to
     * this id query immediately before deleting.
     */
    deleteBy.query = {
      _id: QueryHelper.any(policyIds),
    };
    deleteBy.skip = 0;
    deleteBy.limit = policyIds.length;

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
