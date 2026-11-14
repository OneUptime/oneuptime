import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import {
  SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
  SloRecommendedPolicyTier,
  formatSloPolicyTierThreshold,
  getMissingSloRecommendedPolicyTiers,
  readSloPolicyTierThreshold,
} from "../../Utils/Slo/SloErrorBudgetPolicy";
import {
  SLO_RECORD_OUTPUT_CHECKED_RELATIONS,
  SLO_RECORD_OUTPUT_RELATION_COLUMNS,
  SloRecordOutputOptionFlagDefaults,
} from "../../Utils/Slo/SloRecordOutputColumns";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import SloFeedUtil from "../Utils/Slo/SloFeedUtil";
import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";
import SloRecordSourceSettings from "../Utils/Slo/SloRecordSourceSettings";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";

/*
 * The tiers of an SLO's error budget policy (the model and
 * Common/Utils/Slo/SloErrorBudgetPolicy say what a tier is).
 *
 * A tier's outputs are a burn rate rule's, so they are validated, resolved
 * and forgotten by the same code (SloRecordSourceSettings). What is a tier's
 * own: its threshold (0 to 100, unique per SLO), its "what we do", whether
 * it freezes deployments (the deploy gate CI/CD reads on the SLO), outputs
 * that are both off by default - a tier may raise nothing at all, because
 * most of a policy is the team's agreement - and the recommended policy.
 *
 * Every hand-made change to a tier asks for the SLO to be evaluated on the
 * worker's next tick, so a policy added while the budget is already below a
 * tier takes effect within a minute rather than at the SLO's next cadence:
 * a tier applies whenever the budget is at or below it, however the budget
 * got there, so the SLO enters it - and raises what it is set to raise - on
 * that evaluation.
 */

export const SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE: string =
  "The budget-left threshold of an error budget policy tier must be a number from 0 to 100.";
export const SLO_POLICY_TIER_NAME_ERROR_MESSAGE: string =
  "An error budget policy tier needs a name.";
export const SLO_POLICY_TIER_WHAT_WE_DO_ERROR_MESSAGE: string =
  'An error budget policy tier needs a "what we do": what the team agreed to do while the SLO is in it.';

// An SLO the caller may not read is not found either, so it says nothing about itself.
export const SLO_NOT_FOUND_MESSAGE: string =
  "Service Level Objective not found.";

export type GetSloPolicyTierDuplicateThresholdMessageFunction = (
  thresholdPercentage: number,
) => string;

/*
 * Two tiers at one threshold would both apply at once, and the policy could
 * not say which agreement holds. The other tier is not named: the caller may
 * be allowed to create tiers without being allowed to read them.
 */
export const getSloPolicyTierDuplicateThresholdMessage: GetSloPolicyTierDuplicateThresholdMessageFunction =
  (thresholdPercentage: number): string => {
    return `This SLO's error budget policy already has a tier at ${formatSloPolicyTierThreshold(thresholdPercentage)}. Each tier needs a threshold of its own.`;
  };

/*
 * The lock "Use the recommended policy" holds per SLO, and how long a second
 * request waits for it: adding three tiers takes well under a second.
 */
const RECOMMENDED_POLICY_LOCK_NAMESPACE: string =
  "ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers";
const RECOMMENDED_POLICY_LOCK_TIMEOUT_MS: number = 30000;

/*
 * Mirrors the column defaults: a tier raises nothing until someone switches
 * an output on.
 */
const DEFAULT_SHOULD_CREATE_ALERT: boolean = false;
const DEFAULT_SHOULD_CREATE_INCIDENT: boolean = false;

// Mirrors its column: a tier freezes nothing until someone switches it on.
const DEFAULT_FREEZES_DEPLOYMENTS: boolean = false;

/*
 * The alert and incident options, defaulted exactly like their columns -
 * and exactly like a burn rate rule's, so the two forms that share their
 * fields start from the same place.
 */
export const SLO_POLICY_TIER_OPTION_FLAG_DEFAULTS: SloRecordOutputOptionFlagDefaults =
  {
    isAlertPrivate: false,
    autoResolveAlert: true,
    isIncidentPrivate: false,
    autoResolveIncident: true,
    addSloOwnersAsOwners: false,
  };

export interface SloMissingRecommendedPolicyTiers {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  tiers: Array<SloRecommendedPolicyTier>;
}

export interface SloAddedRecommendedPolicyTier
  extends SloRecommendedPolicyTier {
  tierId: ObjectID | null;
}

export interface SloAddedRecommendedPolicyTiers {
  serviceLevelObjectiveId: ObjectID;
  tiers: Array<SloAddedRecommendedPolicyTier>;
}

/*
 * The root causes a resolved tier record says closed it. Exported so the
 * tests and the worker read the same words.
 */
export const SLO_POLICY_TIER_DISABLED_ROOT_CAUSE: string =
  "Auto-resolved because the error budget policy tier that raised it was disabled.";
export const SLO_POLICY_TIER_DELETED_ROOT_CAUSE: string =
  "Auto-resolved because the error budget policy tier that raised it was deleted.";
export const SLO_POLICY_TIER_ALERTS_OFF_ROOT_CAUSE: string =
  "Alert auto-resolved because the error budget policy tier that raised it no longer raises alerts.";
export const SLO_POLICY_TIER_INCIDENTS_OFF_ROOT_CAUSE: string =
  "Incident auto-resolved because the error budget policy tier that declared it no longer declares incidents.";
// The SLO service's own words for the same event, when it passes none.
export const SLO_POLICY_TIER_SLO_DISABLED_OR_DELETED_ROOT_CAUSE: string =
  "Auto-resolved because the Service Level Objective was disabled or deleted.";

/*
 * The columns whose change moves the tier an SLO is in, what it raises, or
 * whether its deployments are frozen.
 */
const EVALUATION_COLUMNS: Array<string> = [
  "thresholdPercentage",
  "isEnabled",
  "name",
  "whatWeDo",
  "freezesDeployments",
  "shouldCreateAlert",
  "shouldCreateIncident",
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The SLO, the severities, the on-call policies, the labels and the owners
   * are checked by this service's own hooks (SloRecordSourceSettings), with
   * their own words, like a burn rate rule's.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return [...SLO_RECORD_OUTPUT_CHECKED_RELATIONS];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [...SLO_RECORD_OUTPUT_RELATION_COLUMNS];
  }

  // Built on first use: see SloRecordSourceSettings on the import loop.
  private recordSettings: SloRecordSourceSettings<Model> | null = null;

  private getRecordSettings(): SloRecordSourceSettings<Model> {
    if (!this.recordSettings) {
      this.recordSettings = new SloRecordSourceSettings<Model>({
        service: this,
        subject: "SLO error budget policy tier",
        optionFlagDefaults: SLO_POLICY_TIER_OPTION_FLAG_DEFAULTS,
      });
    }

    return this.recordSettings;
  }

  /*
   * Deterministic fingerprint on everything a tier raises, the burn rate
   * rule's scheme with its own word, so a tier and a rule can never claim
   * each other's records. The worker sets it as `seriesFingerprint`, and the
   * lifecycle hooks find (and resolve) the records by it.
   */
  public getPolicyTierFingerprint(data: {
    serviceLevelObjectiveId: ObjectID;
    policyTierId: ObjectID;
  }): string {
    return `slo:${data.serviceLevelObjectiveId.toString()}:policy-tier:${data.policyTierId.toString()}`;
  }

  /*
   * The recommended tiers an SLO is missing: what "Use the recommended
   * policy" asks about. The SLO is read as the caller, so one they may not
   * read - or another project's - is not found. Its tiers are read as root,
   * all of them: whether a recommended tier is missing has to be answered
   * from every tier the SLO has, and the answer names only recommended
   * tiers.
   */
  @CaptureSpan()
  public async getMissingRecommendedTiers(data: {
    serviceLevelObjectiveId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SloMissingRecommendedPolicyTiers> {
    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const slo: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneBy({
        query: {
          _id: data.serviceLevelObjectiveId.toString(),
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!slo || !slo.id) {
      throw new NotFoundException(SLO_NOT_FOUND_MESSAGE);
    }

    const existingTiers: Array<Model> = await this.findBy({
      query: {
        serviceLevelObjectiveId: slo.id,
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
        thresholdPercentage: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return {
      serviceLevelObjectiveId: slo.id,
      projectId: projectId,
      tiers: getMissingSloRecommendedPolicyTiers({
        existingTiers: existingTiers,
      }),
    };
  }

  /*
   * A recommended tier as the row OneUptime creates for it: its name,
   * threshold, agreement and whether it freezes deployments, with every
   * output left at its default - off.
   */
  public buildRecommendedTier(data: {
    projectId: ObjectID;
    serviceLevelObjectiveId: ObjectID;
    recommended: SloRecommendedPolicyTier;
  }): Model {
    const tier: Model = new Model();
    tier.projectId = data.projectId;
    tier.serviceLevelObjectiveId = data.serviceLevelObjectiveId;
    tier.name = data.recommended.name;
    tier.thresholdPercentage = data.recommended.thresholdPercentage;
    tier.whatWeDo = data.recommended.whatWeDo;
    tier.freezesDeployments = data.recommended.freezesDeployments === true;
    tier.isEnabled = true;
    return tier;
  }

  /*
   * "Use the recommended policy": creates the recommended tiers the SLO is
   * missing, and only those, as the caller - through create() with the
   * caller's props, exactly as a tier added by hand, so the same permission
   * checks refuse what the caller may not create, the same hooks validate
   * it, and the SLO's audit log records the caller adding it.
   *
   * Idempotent: what is missing is worked out again inside a lock held per
   * SLO, so a second request - a double click, a second tab, a retry - waits
   * for the first and then finds nothing left to add. Without the lock
   * (Redis unreachable) the request still runs, and the unique threshold
   * index refuses a second tier at a threshold the first already took.
   *
   * All or nothing: tiers are created one at a time, and when one fails,
   * the ones this request already added are removed again before the
   * refusal is passed on (removeRecommendedTiersAdded). Half a policy is
   * worse than none: the Error Budget Policy page offers the recommended
   * policy only to an SLO with no tier, so it could not be finished from
   * there, and a policy without its last tier never freezes deployments.
   */
  @CaptureSpan()
  public async addMissingRecommendedTiers(data: {
    serviceLevelObjectiveId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SloAddedRecommendedPolicyTiers> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.serviceLevelObjectiveId.toString(),
        namespace: RECOMMENDED_POLICY_LOCK_NAMESPACE,
        lockTimeout: RECOMMENDED_POLICY_LOCK_TIMEOUT_MS,
        acquireTimeout: RECOMMENDED_POLICY_LOCK_TIMEOUT_MS,
      });
    } catch (err) {
      logger.error(
        `Could not take the lock for adding the recommended error budget policy of SLO ${data.serviceLevelObjectiveId.toString()}; adding it without one: ${err}`,
        { projectId: data.props.tenantId?.toString() } as LogAttributes,
      );
    }

    try {
      const missing: SloMissingRecommendedPolicyTiers =
        await this.getMissingRecommendedTiers(data);

      const added: Array<SloAddedRecommendedPolicyTier> = [];

      try {
        for (const recommended of missing.tiers) {
          const created: Model = await this.create({
            data: this.buildRecommendedTier({
              projectId: missing.projectId,
              serviceLevelObjectiveId: missing.serviceLevelObjectiveId,
              recommended: recommended,
            }),
            props: data.props,
          });

          added.push({
            ...recommended,
            tierId: created.id || null,
          });
        }
      } catch (err) {
        // Still under the lock: a request waiting for it finds the SLO as it was.
        await this.removeRecommendedTiersAdded({
          projectId: missing.projectId,
          serviceLevelObjectiveId: missing.serviceLevelObjectiveId,
          tierIds: added
            .map((tier: SloAddedRecommendedPolicyTier): ObjectID | null => {
              return tier.tierId;
            })
            .filter((tierId: ObjectID | null): tierId is ObjectID => {
              return tierId !== null;
            }),
        });

        throw err;
      }

      return {
        serviceLevelObjectiveId: missing.serviceLevelObjectiveId,
        tiers: added,
      };
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          // It runs out on its own timeout.
          logger.error(
            `Could not release the lock for adding the recommended error budget policy of SLO ${data.serviceLevelObjectiveId.toString()}: ${err}`,
            { projectId: data.props.tenantId?.toString() } as LogAttributes,
          );
        }
      }
    }
  }

  /*
   * The tiers a "Use the recommended policy" request added before one of its
   * creates failed, removed again. Only those: by the ids its own creates
   * handed back, never a tier somebody else added meanwhile - one that took
   * the threshold a create then failed on, say. Removed as OneUptime, with
   * the delete's hooks, which ask for the SLO to be evaluated again: whoever
   * may add tiers need not be allowed to remove them, and these are the
   * request's own, created moments ago. Each removal is tried on its own,
   * and one that fails is logged, never thrown: the refusal the caller hears
   * about is the create's.
   */
  private async removeRecommendedTiersAdded(data: {
    projectId: ObjectID;
    serviceLevelObjectiveId: ObjectID;
    tierIds: Array<ObjectID>;
  }): Promise<void> {
    for (const tierId of data.tierIds) {
      try {
        await this.deleteOneBy({
          query: {
            _id: tierId.toString(),
            projectId: data.projectId,
            serviceLevelObjectiveId: data.serviceLevelObjectiveId,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `Could not remove error budget policy tier ${tierId.toString()} of SLO ${data.serviceLevelObjectiveId.toString()} after adding the recommended policy failed; the SLO keeps it: ${err}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }
  }

  /*
   * 0 is a threshold: the tier of an exhausted budget, which the recommended
   * policy ends with (Budget exhausted, the tier that freezes deployments).
   * The required-column check reads 0 as missing, so a tier at 0% was
   * refused as "thresholdPercentage is required" - added by hand, through
   * the API, or by "Use the recommended policy", which then stopped with
   * its first two tiers added (#6978). onBeforeCreate has read the threshold
   * into a number from 0 to 100 by then (validateThreshold), so any number
   * is a value of it; anything else is still read as the check reads it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (
      column === "thresholdPercentage" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * The threshold can arrive as a string - the Dashboard's number field
     * hands Formik `e.target.value` - so it is read, validated and written
     * back as a number, and a string never reaches the uniqueness check or
     * Postgres.
     */
    const thresholdPercentage: number = this.validateThreshold(
      createBy.data.thresholdPercentage,
    );
    createBy.data.thresholdPercentage = thresholdPercentage;

    createBy.data.name = this.validateName(createBy.data.name);
    createBy.data.whatWeDo = this.validateWhatWeDo(createBy.data.whatWeDo);

    /*
     * Both outputs written back explicitly as real booleans: the worker reads
     * them with `=== true`, and a tier read back must say what it raises.
     */
    createBy.data.shouldCreateAlert =
      this.getRecordSettings().normalizeBooleanInput(
        createBy.data.shouldCreateAlert,
        DEFAULT_SHOULD_CREATE_ALERT,
      );
    createBy.data.shouldCreateIncident =
      this.getRecordSettings().normalizeBooleanInput(
        createBy.data.shouldCreateIncident,
        DEFAULT_SHOULD_CREATE_INCIDENT,
      );

    /*
     * The deploy gate's switch, the same way: the worker reads it with
     * `=== true`, and a tier read back says whether it freezes deployments.
     */
    createBy.data.freezesDeployments =
      this.getRecordSettings().normalizeBooleanInput(
        createBy.data.freezesDeployments,
        DEFAULT_FREEZES_DEPLOYMENTS,
      );

    this.getRecordSettings().normalizeOptionFlags(
      createBy.data as unknown as Dictionary<unknown>,
      {
        applyDefaults: true,
      },
    );

    this.getRecordSettings().normalizeTemplates(
      createBy.data as unknown as Dictionary<unknown>,
    );

    // Tenant first, for every reference check below - see the rule service.
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    /*
     * The SLO first: a tier hung off another tenant's SLO would never apply
     * (the worker reads tiers pinned to the SLO's project), and that project
     * deleting its SLO would cascade into this project's tier. A foreign id
     * gets the same answer as a missing one.
     */
    await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
      {
        projectId: projectId,
        serviceLevelObjectives: [
          createBy.data.serviceLevelObjectiveId,
          createBy.data.serviceLevelObjective,
        ],
        subject: "SLO error budget policy tier",
      },
    );

    await this.getRecordSettings().validateSeverityReferences({
      projectId: projectId,
      ...this.getRecordSettings().readSeverityIds(
        createBy.data as unknown as Dictionary<unknown>,
      ),
    });

    await this.getRecordSettings().validateRoutingReferences({
      projectId: projectId,
      payload: createBy.data as unknown as Dictionary<unknown>,
      storedIds: undefined,
    });

    const serviceLevelObjectiveId: string | undefined =
      SloRecordReferenceValidator.getReferencedIds([
        createBy.data.serviceLevelObjectiveId,
        createBy.data.serviceLevelObjective,
      ])[0];

    if (projectId && serviceLevelObjectiveId) {
      await this.assertThresholdIsFree({
        projectId: projectId,
        serviceLevelObjectiveId: new ObjectID(serviceLevelObjectiveId),
        thresholdPercentage: thresholdPercentage,
        exceptTierId: undefined,
      });
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  /*
   * A new tier may apply to the budget the SLO already has: ask for the SLO
   * to be evaluated on the next tick. Fire-and-forget - the tier exists
   * either way, and the SLO's regular cadence picks it up regardless.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.serviceLevelObjectiveId) {
      this.requestEvaluation([createdItem.serviceLevelObjectiveId]).catch(
        (err: Error) => {
          logger.error(
            `Error asking for SLO ${createdItem.serviceLevelObjectiveId?.toString()} to be evaluated after an error budget policy tier was added: ${err}`,
          );
        },
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const newThreshold: unknown = updateBy.data.thresholdPercentage as unknown;

    if (newThreshold !== undefined) {
      const thresholdPercentage: number = this.validateThreshold(newThreshold);
      updateBy.data.thresholdPercentage = thresholdPercentage;
      await this.assertThresholdIsFreeOnUpdate(updateBy, thresholdPercentage);
    }

    if (updateBy.data.name !== undefined) {
      updateBy.data.name = this.validateName(updateBy.data.name as unknown);
    }

    if (updateBy.data.whatWeDo !== undefined) {
      updateBy.data.whatWeDo = this.validateWhatWeDo(
        updateBy.data.whatWeDo as unknown,
      );
    }

    // Only the flags this update carries are coerced; an absent flag stays absent.
    if (
      updateBy.data.shouldCreateAlert !== undefined &&
      updateBy.data.shouldCreateAlert !== null
    ) {
      updateBy.data.shouldCreateAlert =
        this.getRecordSettings().normalizeBooleanInput(
          updateBy.data.shouldCreateAlert,
          DEFAULT_SHOULD_CREATE_ALERT,
        );
    }

    if (
      updateBy.data.shouldCreateIncident !== undefined &&
      updateBy.data.shouldCreateIncident !== null
    ) {
      updateBy.data.shouldCreateIncident =
        this.getRecordSettings().normalizeBooleanInput(
          updateBy.data.shouldCreateIncident,
          DEFAULT_SHOULD_CREATE_INCIDENT,
        );
    }

    if (
      updateBy.data.freezesDeployments !== undefined &&
      updateBy.data.freezesDeployments !== null
    ) {
      updateBy.data.freezesDeployments =
        this.getRecordSettings().normalizeBooleanInput(
          updateBy.data.freezesDeployments,
          DEFAULT_FREEZES_DEPLOYMENTS,
        );
    }

    await this.getRecordSettings().validateServiceLevelObjectiveOnUpdate(
      updateBy,
    );

    await this.getRecordSettings().validateSeverityReferencesOnUpdate(updateBy);

    this.getRecordSettings().normalizeOptionFlags(
      updateBy.data as unknown as Dictionary<unknown>,
      {
        applyDefaults: false,
      },
    );

    this.getRecordSettings().normalizeTemplates(
      updateBy.data as unknown as Dictionary<unknown>,
    );

    await this.getRecordSettings().validateRoutingReferencesOnUpdate(updateBy);

    return {
      updateBy,
      carryForward: null,
    };
  }

  /*
   * A tier that stops raising something - disabled, or one of its outputs
   * switched off - leaves whatever it already has open an orphan: the worker
   * only loads enabled tiers and only raises what a tier still raises. So
   * that is resolved here, after the write commits, and the tier forgets it
   * had it open (clearOpenOutputStateForTier), so switching an output back on
   * raises it again while the SLO is still in the tier. The auto-resolve
   * switches are not consulted: the tier can no longer justify the record at
   * all - the stance the burn rate rule service takes.
   *
   * And a change that can move the SLO into or out of a tier, change what it
   * raises, or freeze or allow its deployments, asks for the SLO to be
   * evaluated on the next tick: the worker alone writes the SLO's
   * deploymentsAllowed, so switching Freeze Deployments on or off for the
   * tier the SLO is in takes effect within about a minute.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const data: Dictionary<unknown> = onUpdate.updateBy
      .data as unknown as Dictionary<unknown>;

    const isTierDisabled: boolean = data["isEnabled"] === false;
    const areAlertsTurnedOff: boolean = data["shouldCreateAlert"] === false;
    const areIncidentsTurnedOff: boolean =
      data["shouldCreateIncident"] === false;

    const isEvaluationAffected: boolean = EVALUATION_COLUMNS.some(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );

    if (
      !isTierDisabled &&
      !areAlertsTurnedOff &&
      !areIncidentsTurnedOff &&
      !isEvaluationAffected
    ) {
      return onUpdate;
    }

    const sloIds: Array<ObjectID> = [];

    for (const updatedItemId of updatedItemIds) {
      try {
        const tier: Model | null = await this.findOneById({
          id: updatedItemId,
          select: {
            _id: true,
            projectId: true,
            serviceLevelObjectiveId: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!tier || !tier.projectId || !tier.serviceLevelObjectiveId) {
          continue;
        }

        sloIds.push(tier.serviceLevelObjectiveId);

        if (!isTierDisabled && !areAlertsTurnedOff && !areIncidentsTurnedOff) {
          continue;
        }

        /*
         * Each output its own try: an alert that fails to resolve must not
         * take the incident's resolve down with it.
         */
        let clearAlert: boolean = false;
        let clearIncident: boolean = false;

        if (isTierDisabled || areAlertsTurnedOff) {
          try {
            await this.resolveOpenAlertsForTier({
              serviceLevelObjectiveId: tier.serviceLevelObjectiveId,
              policyTierId: updatedItemId,
              projectId: tier.projectId,
              rootCause: isTierDisabled
                ? SLO_POLICY_TIER_DISABLED_ROOT_CAUSE
                : SLO_POLICY_TIER_ALERTS_OFF_ROOT_CAUSE,
            });
            clearAlert = true;
          } catch (err) {
            logger.error(
              `Error resolving open alerts for SLO error budget policy tier ${updatedItemId.toString()} after update: ${err}`,
            );
          }
        }

        if (isTierDisabled || areIncidentsTurnedOff) {
          try {
            await this.resolveOpenIncidentsForTier({
              serviceLevelObjectiveId: tier.serviceLevelObjectiveId,
              policyTierId: updatedItemId,
              projectId: tier.projectId,
              rootCause: isTierDisabled
                ? SLO_POLICY_TIER_DISABLED_ROOT_CAUSE
                : SLO_POLICY_TIER_INCIDENTS_OFF_ROOT_CAUSE,
            });
            clearIncident = true;
          } catch (err) {
            logger.error(
              `Error resolving open incidents for SLO error budget policy tier ${updatedItemId.toString()} after update: ${err}`,
            );
          }
        }

        // Only forget the outputs that actually closed.
        await this.clearOpenOutputStateForTier({
          policyTierId: updatedItemId,
          clearAlert: clearAlert,
          clearIncident: clearIncident,
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts and incidents for SLO error budget policy tier ${updatedItemId.toString()} after update: ${err}`,
        );
      }
    }

    if (isEvaluationAffected) {
      this.requestEvaluation(sloIds).catch((err: Error) => {
        logger.error(
          `Error asking for SLOs to be evaluated after an error budget policy tier was updated: ${err}`,
        );
      });
    }

    return onUpdate;
  }

  /*
   * READ ONLY: notes down the tiers this delete may remove - onDeleteSuccess
   * needs each one's SLO and project to resolve what it raised, and the row
   * is gone by then. Nothing is resolved here: this runs before the caller's
   * delete permissions apply, so these rows are only candidates (the burn
   * rate rule service explains the hole that closes). A failed read is not
   * caught: deleting a tier without knowing what it raised would strand
   * those records.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
      },
    );

    return {
      deleteBy,
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
    };
  }

  /*
   * What the tiers this delete really removed leave behind: everything they
   * raised is resolved, and their SLOs are evaluated on the next tick, so an
   * SLO in a tier that is gone moves to the tier its budget is in now. Only
   * rows DatabaseService reports as deleted are acted on.
   *
   * (Deleting the SLO cascades its tiers in Postgres without this hook;
   * ServiceLevelObjectiveService.onDeleteSuccess resolves those.)
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = SloFeedUtil.getRowsActuallyDeleted({
      rows:
        (onDelete.carryForward?.itemsToDelete as Array<Model> | undefined) ||
        [],
      deletedIds: itemIdsBeforeDelete,
    });

    const sloIds: Array<ObjectID> = [];

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId || !item.serviceLevelObjectiveId) {
        continue;
      }

      sloIds.push(item.serviceLevelObjectiveId);

      try {
        await this.resolveOpenAlertsAndIncidentsForTier({
          serviceLevelObjectiveId: item.serviceLevelObjectiveId,
          policyTierId: item.id,
          projectId: item.projectId,
          rootCause: SLO_POLICY_TIER_DELETED_ROOT_CAUSE,
        });
      } catch (err) {
        // Never fail the request - the tier is already gone.
        logger.error(
          `Error resolving open alerts and incidents for deleted SLO error budget policy tier ${item.id.toString()}: ${err}`,
          { projectId: item.projectId.toString() } as LogAttributes,
        );
      }
    }

    if (sloIds.length > 0) {
      this.requestEvaluation(sloIds).catch((err: Error) => {
        logger.error(
          `Error asking for SLOs to be evaluated after an error budget policy tier was deleted: ${err}`,
        );
      });
    }

    return onDelete;
  }

  // Every open Alert carrying this tier's fingerprint gets resolved.
  @CaptureSpan()
  public async resolveOpenAlertsForTier(data: {
    serviceLevelObjectiveId: ObjectID;
    policyTierId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    await this.getRecordSettings().resolveOpenAlertsByFingerprint({
      fingerprint: this.getPolicyTierFingerprint({
        serviceLevelObjectiveId: data.serviceLevelObjectiveId,
        policyTierId: data.policyTierId,
      }),
      projectId: data.projectId,
      rootCause:
        data.rootCause ||
        "Alert auto-resolved because the error budget policy tier that raised it no longer applies.",
      sourceDescription: `SLO error budget policy tier ${data.policyTierId.toString()}`,
    });
  }

  // The Incident twin, resolved independently of the alert.
  @CaptureSpan()
  public async resolveOpenIncidentsForTier(data: {
    serviceLevelObjectiveId: ObjectID;
    policyTierId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    await this.getRecordSettings().resolveOpenIncidentsByFingerprint({
      fingerprint: this.getPolicyTierFingerprint({
        serviceLevelObjectiveId: data.serviceLevelObjectiveId,
        policyTierId: data.policyTierId,
      }),
      projectId: data.projectId,
      rootCause:
        data.rootCause ||
        "Incident auto-resolved because the error budget policy tier that declared it no longer applies.",
      sourceDescription: `SLO error budget policy tier ${data.policyTierId.toString()}`,
    });
  }

  /*
   * Both, the incident pass running even when the alert pass throws, and the
   * first error rethrown after both have run.
   */
  @CaptureSpan()
  public async resolveOpenAlertsAndIncidentsForTier(data: {
    serviceLevelObjectiveId: ObjectID;
    policyTierId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    let firstError: unknown = null;

    try {
      await this.resolveOpenAlertsForTier(data);
    } catch (err) {
      firstError = err;
    }

    try {
      await this.resolveOpenIncidentsForTier(data);
    } catch (err) {
      if (firstError === null) {
        firstError = err;
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  // Forget that the tier has an output open, without stamping a resolve.
  @CaptureSpan()
  public async clearOpenOutputStateForTier(data: {
    policyTierId: ObjectID;
    clearAlert: boolean;
    clearIncident: boolean;
  }): Promise<void> {
    await this.getRecordSettings().clearOpenOutputState({
      id: data.policyTierId,
      clearAlert: data.clearAlert,
      clearIncident: data.clearIncident,
    });
  }

  /*
   * Resolve everything any tier of this SLO has open, and forget it was
   * open. Called when the SLO is disabled or archived - the worker skips
   * those SLOs, so nothing else would - and so each tier raises again when
   * the SLO is back and still in it. Unlike burn rate rules, a Paused or
   * Misconfigured SLO keeps what its tier raised: the budget is unmeasured,
   * not recovered, and the tier stays where it was (see EvaluateSlos).
   *
   * Every tier is attempted, and the first error rethrown.
   */
  @CaptureSpan()
  public async resolveOpenPolicyTierAlertsAndIncidentsForSlo(data: {
    sloId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const tiers: Array<Model> = await this.findBy({
      query: {
        serviceLevelObjectiveId: data.sloId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    let firstError: unknown = null;

    for (const tier of tiers) {
      if (!tier.id) {
        continue;
      }

      try {
        await this.resolveOpenAlertsAndIncidentsForTier({
          serviceLevelObjectiveId: data.sloId,
          policyTierId: tier.id,
          projectId: data.projectId,
          rootCause:
            data.rootCause ||
            SLO_POLICY_TIER_SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
        });

        await this.clearOpenOutputStateForTier({
          policyTierId: tier.id,
          clearAlert: true,
          clearIncident: true,
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts and incidents for error budget policy tier ${tier.id.toString()} of SLO ${data.sloId.toString()}: ${err}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );

        if (firstError === null) {
          firstError = err;
        }
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  /*
   * Ask for these SLOs to be evaluated on the worker's next tick. Hookless:
   * nextEvaluationAt is worker bookkeeping, the same column the SLO's own
   * settings edits stamp.
   */
  private async requestEvaluation(sloIds: Array<ObjectID>): Promise<void> {
    const seen: Set<string> = new Set<string>();

    for (const sloId of sloIds) {
      const key: string = sloId.toString().toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      await ServiceLevelObjectiveService.updateColumnsByIdWithoutHooks({
        id: sloId,
        data: {
          nextEvaluationAt: OneUptimeDate.getCurrentDate(),
        },
      });
    }
  }

  private validateThreshold(value: unknown): number {
    const thresholdPercentage: number | null =
      readSloPolicyTierThreshold(value);

    if (thresholdPercentage === null) {
      throw new BadDataException(SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE);
    }

    return thresholdPercentage;
  }

  private validateName(value: unknown): string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new BadDataException(SLO_POLICY_TIER_NAME_ERROR_MESSAGE);
    }

    return value.trim();
  }

  /*
   * Never trimmed - leading whitespace is meaningful in Markdown - but a blank
   * one is no agreement at all.
   */
  private validateWhatWeDo(value: unknown): string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new BadDataException(SLO_POLICY_TIER_WHAT_WE_DO_ERROR_MESSAGE);
    }

    if (value.length > SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH) {
      throw new BadDataException(
        `"What we do" must be ${SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH} characters or fewer. It is ${value.length} characters long.`,
      );
    }

    return value;
  }

  /*
   * One tier per threshold on an SLO. The unique index is what holds under
   * concurrency; this says so in words before Postgres has to.
   */
  private async assertThresholdIsFree(data: {
    projectId: ObjectID;
    serviceLevelObjectiveId: ObjectID;
    thresholdPercentage: number;
    exceptTierId: ObjectID | undefined;
  }): Promise<void> {
    const sameThreshold: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        serviceLevelObjectiveId: data.serviceLevelObjectiveId,
        thresholdPercentage: data.thresholdPercentage,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const others: Array<Model> = sameThreshold.filter(
      (tier: Model): boolean => {
        return (
          !data.exceptTierId ||
          tier.id?.toString().toLowerCase() !==
            data.exceptTierId.toString().toLowerCase()
        );
      },
    );

    if (others.length > 0) {
      throw new BadDataException(
        getSloPolicyTierDuplicateThresholdMessage(data.thresholdPercentage),
      );
    }
  }

  /*
   * The update twin: checked against each tier the update writes, and two of
   * them on the same SLO cannot both take the one threshold.
   */
  private async assertThresholdIsFreeOnUpdate(
    updateBy: UpdateBy<Model>,
    thresholdPercentage: number,
  ): Promise<void> {
    const tiers: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
      },
    );

    const sloIdsSeen: Set<string> = new Set<string>();

    for (const tier of tiers) {
      if (!tier.id || !tier.projectId || !tier.serviceLevelObjectiveId) {
        continue;
      }

      const sloKey: string = tier.serviceLevelObjectiveId
        .toString()
        .toLowerCase();

      if (sloIdsSeen.has(sloKey)) {
        throw new BadDataException(
          getSloPolicyTierDuplicateThresholdMessage(thresholdPercentage),
        );
      }

      sloIdsSeen.add(sloKey);

      await this.assertThresholdIsFree({
        projectId: tier.projectId,
        serviceLevelObjectiveId: tier.serviceLevelObjectiveId,
        thresholdPercentage: thresholdPercentage,
        exceptTierId: tier.id,
      });
    }
  }
}

export default new Service();
