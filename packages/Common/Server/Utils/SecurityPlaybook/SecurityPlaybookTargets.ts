import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import SecurityProtectedEntityService from "../../Services/SecurityProtectedEntityService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../Services/ThreatIntelIndicatorService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseMatches from "../SecurityCase/Context/SecurityCaseMatches";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "../SecurityBlocklist/SecurityProtectedAddresses";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { describeSecurityAddressProtection } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { SecurityCaseMatchesJson } from "../../../Types/SecurityCase/SecurityCaseMatches";
import { getCaseClaimedOnlyAddresses } from "../../../Utils/SecurityCase/CaseClaimedClientAddress";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityEntity,
  SecurityEntityType,
  inferSecurityEntityType,
  mergeSecurityEntities,
  readSecurityEntities,
  securityEntityKey,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  ProtectedEntityRule,
  findProtectingRule,
} from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import { CONTAINMENT_ENTITY_LIMIT } from "./SecurityPlaybookContainment";

// How many of a case's detections are read for the values they are grouped on.
const GROUPED_DETECTIONS_LIMIT: number = 100;

// A case's grouping key for an entity: "entity:" and the value, case-folded.
const ENTITY_GROUPING_KEY_PREFIX: string = "entity:";
const HASHED_GROUPING_KEY_PREFIX: string = "sha256:";

export interface GroupedDetection {
  groupValue?: string | undefined;
  entities: Array<SecurityEntity>;
}

/*
 * THE TARGET RULE: what a step that acts on users or hosts acts on.
 *
 * Never every user or host the case names. A brute force against the VPN,
 * grouped on the attacker's address, also names the account it tried and
 * the gateway it hit, and containing either contains the victim. A step acts
 * only on the case's attacker side:
 *
 *  1. Grouped on: the value a detection of the case is grouped on, which is
 *     what the detection - and so the case - is about: the account an
 *     impossible-travel rule groups by, the host an EDR alert names. A case
 *     grouped on an address has no user or host here at all.
 *  2. Threat intel: a user or host of the case that is a known indicator in
 *     the project's threat intel.
 *
 * Of the step's kind only (users for Okta, hosts for CrowdStrike and
 * Defender, addresses for a block), grouped-on ones first, at most
 * CONTAINMENT_ENTITY_LIMIT. A target on the project's protected list stays
 * in the list, marked Protected, and is never acted on. The approver sees
 * the targets and may leave any out (SecurityPlaybookRunAPI).
 *
 * An address (#10342) is a target only when it is public and the case's
 * requests did not only claim it (#10416); one of the project's own - a
 * host's, a load balancer's, the edge in front of the app - is Protected,
 * saying what it is.
 */
export default class SecurityPlaybookTargets {
  /*
   * The entities a case's detections are grouped on, typed as the detection
   * (or the case) typed them: a value a rule groups by is typed by its field,
   * which beats any guess from its shape. The case's own grouping key counts
   * too, so deleting a detection does not change what the case is about.
   */
  public static getGroupedOnEntities(data: {
    groupingKey?: string | undefined;
    detections: Array<GroupedDetection>;
    caseEntities: Array<SecurityEntity>;
  }): Array<SecurityEntity> {
    const values: Array<{ value: string; entities: Array<SecurityEntity> }> =
      [];
    const key: string = (data.groupingKey || "").trim();

    if (
      key.startsWith(ENTITY_GROUPING_KEY_PREFIX) &&
      !key
        .slice(ENTITY_GROUPING_KEY_PREFIX.length)
        .startsWith(HASHED_GROUPING_KEY_PREFIX)
    ) {
      values.push({
        value: key.slice(ENTITY_GROUPING_KEY_PREFIX.length),
        entities: [],
      });
    }

    for (const detection of data.detections) {
      if (detection.groupValue && detection.groupValue.trim()) {
        values.push({
          value: detection.groupValue,
          entities: detection.entities,
        });
      }
    }

    return mergeSecurityEntities(
      values.map(
        (item: {
          value: string;
          entities: Array<SecurityEntity>;
        }): SecurityEntity => {
          const wanted: string = item.value.trim().toLowerCase();
          const typed: SecurityEntity | undefined = [
            ...item.entities,
            ...data.caseEntities,
          ].find((entity: SecurityEntity): boolean => {
            return (
              securityEntityKey(entity) === wanted &&
              entity.type !== SecurityEntityType.Other
            );
          });

          return typed
            ? { type: typed.type, value: typed.value.trim() }
            : {
                type: inferSecurityEntityType(item.value),
                value: item.value.trim(),
              };
        },
      ),
    );
  }

  // The rule itself, on what was read: see the class comment.
  public static chooseTargets(data: {
    entityType: SecurityEntityType;
    groupedOn: Array<SecurityEntity>;
    caseEntities: Array<SecurityEntity>;
    // Case-folded values the project's threat intel knows as indicators.
    threatIntelValues: ReadonlySet<string>;
    protectedRules: ReadonlyArray<ProtectedEntityRule>;
  }): Array<SecurityPlaybookTarget> {
    const candidates: Map<string, SecurityPlaybookTarget> = new Map();

    const add: (
      entity: SecurityEntity,
      reason: SecurityPlaybookTargetReason,
    ) => void = (
      entity: SecurityEntity,
      reason: SecurityPlaybookTargetReason,
    ): void => {
      const key: string = securityEntityKey(entity);

      if (!key || entity.type !== data.entityType || candidates.has(key)) {
        return;
      }

      candidates.set(key, {
        type: entity.type,
        value: entity.value.trim(),
        reason,
        state: SecurityPlaybookTargetState.Proposed,
      });
    };

    for (const entity of data.groupedOn) {
      add(entity, SecurityPlaybookTargetReason.GroupedOn);
    }

    for (const entity of data.caseEntities) {
      if (data.threatIntelValues.has(securityEntityKey(entity))) {
        add(entity, SecurityPlaybookTargetReason.ThreatIntel);
      }
    }

    const targets: Array<SecurityPlaybookTarget> = this.protect({
      targets: Array.from(candidates.values()),
      rules: data.protectedRules,
    });

    let proposed: number = 0;

    return targets.filter((target: SecurityPlaybookTarget): boolean => {
      if (target.state !== SecurityPlaybookTargetState.Proposed) {
        return true;
      }

      proposed++;
      return proposed <= CONTAINMENT_ENTITY_LIMIT;
    });
  }

  /*
   * Marks the targets the protected list covers as Protected. Asked again
   * right before a step acts, so an entry added while the step waited for
   * approval still holds.
   */
  public static protect(data: {
    targets: Array<SecurityPlaybookTarget>;
    rules: ReadonlyArray<ProtectedEntityRule>;
  }): Array<SecurityPlaybookTarget> {
    return data.targets.map(
      (target: SecurityPlaybookTarget): SecurityPlaybookTarget => {
        if (target.state !== SecurityPlaybookTargetState.Proposed) {
          return target;
        }

        const rule: ProtectedEntityRule | undefined = findProtectingRule({
          type: target.type,
          value: target.value,
          rules: data.rules,
        });

        return rule
          ? {
              ...target,
              state: SecurityPlaybookTargetState.Protected,
              protectedBy: rule.value,
            }
          : target;
      },
    );
  }

  /*
   * An address a block may target (#10342): a public one - a private or a
   * local one is never reached from the internet, so an edge has nothing
   * to block - and never one the case's requests only claimed (#10416):
   * whoever sent them wrote it, and blocking it could block a customer.
   */
  public static keepBlockableAddresses(data: {
    targets: Array<SecurityPlaybookTarget>;
    claimedOnly: ReadonlySet<string>;
  }): Array<SecurityPlaybookTarget> {
    return data.targets.filter((target: SecurityPlaybookTarget): boolean => {
      const address: string | null = canonicalAddress(target.value);

      return Boolean(
        address &&
          getSecurityAddressScope(address) === SecurityAddressScope.Public &&
          !data.claimedOnly.has(address),
      );
    });
  }

  /*
   * The project's own addresses among the targets - a host's, a load
   * balancer's, a probe's, the edge in front of the app - marked Protected,
   * with what they are (SecurityProtectedAddresses): the protected list is
   * read already, by the rule. One OneUptime cannot tell about stays
   * proposed, and the blocklist refuses it when the step acts, saying so.
   */
  public static async protectOwnAddresses(data: {
    projectId: ObjectID;
    targets: Array<SecurityPlaybookTarget>;
  }): Promise<Array<SecurityPlaybookTarget>> {
    const marked: Array<SecurityPlaybookTarget> = [];

    for (const target of data.targets) {
      const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
        target.value,
      );

      if (target.state !== SecurityPlaybookTargetState.Proposed || !block) {
        marked.push(target);
        continue;
      }

      const check: SecurityProtectionCheck =
        await SecurityProtectedAddresses.findProtection({
          projectId: data.projectId,
          block,
        });

      marked.push(
        check.protection
          ? {
              ...target,
              state: SecurityPlaybookTargetState.Protected,
              detail: describeSecurityAddressProtection({
                value: block.text,
                protection: check.protection,
              }),
            }
          : target,
      );
    }

    return marked;
  }

  // The targets a step of this kind has on the case, by the rule.
  @CaptureSpan()
  public static async selectTargets(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    entityType: SecurityEntityType;
  }): Promise<Array<SecurityPlaybookTarget>> {
    const targets: Array<SecurityPlaybookTarget> =
      await this.selectTargetsByRule(data);

    if (data.entityType !== SecurityEntityType.IpAddress) {
      return targets;
    }

    /*
     * An address: the case's requests say which addresses they only
     * claimed. A case whose requests cannot be read is not acted on: it
     * fails toward a person, who can block from the case.
     */
    const matches: SecurityCaseMatchesJson | null = data.securityCase.id
      ? await SecurityCaseMatches.build({
          projectId: data.projectId,
          securityCaseId: data.securityCase.id,
          props: { isRoot: true },
          now: OneUptimeDate.getCurrentDate(),
        })
      : null;

    return await this.protectOwnAddresses({
      projectId: data.projectId,
      targets: this.keepBlockableAddresses({
        targets,
        claimedOnly: getCaseClaimedOnlyAddresses(matches),
      }),
    });
  }

  private static async selectTargetsByRule(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    entityType: SecurityEntityType;
  }): Promise<Array<SecurityPlaybookTarget>> {
    const caseEntities: Array<SecurityEntity> = mergeSecurityEntities(
      readSecurityEntities(data.securityCase.entities),
    );

    const detections: Array<SecurityDetection> = data.securityCase.id
      ? await SecurityDetectionService.findBy({
          query: {
            projectId: data.projectId,
            securityCaseId: data.securityCase.id,
          },
          select: {
            groupValue: true,
            entities: true,
          },
          skip: 0,
          limit: GROUPED_DETECTIONS_LIMIT,
          props: {
            isRoot: true,
          },
        })
      : [];

    const ofKind: Array<SecurityEntity> = caseEntities.filter(
      (entity: SecurityEntity): boolean => {
        return entity.type === data.entityType;
      },
    );

    const indicators: Array<ActiveIndicator> =
      ofKind.length > 0
        ? await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
            projectId: data.projectId,
            values: ofKind.map((entity: SecurityEntity): string => {
              return securityEntityKey(entity);
            }),
            now: OneUptimeDate.getCurrentDate(),
          })
        : [];

    return this.chooseTargets({
      entityType: data.entityType,
      groupedOn: this.getGroupedOnEntities({
        groupingKey: data.securityCase.groupingKey,
        detections: detections.map(
          (detection: SecurityDetection): GroupedDetection => {
            return {
              groupValue: detection.groupValue,
              entities: readSecurityEntities(detection.entities),
            };
          },
        ),
        caseEntities,
      }),
      caseEntities,
      threatIntelValues: new Set(
        indicators.map((indicator: ActiveIndicator): string => {
          return indicator.indicatorValue.trim().toLowerCase();
        }),
      ),
      protectedRules: await SecurityProtectedEntityService.getRules({
        projectId: data.projectId,
        entityType: data.entityType,
      }),
    });
  }
}
