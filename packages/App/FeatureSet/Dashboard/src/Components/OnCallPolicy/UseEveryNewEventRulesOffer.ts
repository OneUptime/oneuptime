import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  EVERY_NEW_EVENT_RULES_LANGUAGE_KEY,
  EveryNewEventRulesOfferFacts,
  EveryNewEventRulesOfferKind,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
  doesEveryNewEventRulesOfferStartOn,
  getEveryNewEventRulesOfferKind,
} from "Common/Types/OnCallDutyPolicy/EveryNewEventRules";
import { getGlobalTranslator } from "Common/UI/Utils/TranslateTemplate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useCallback, useRef, useState } from "react";

/*
 * WHETHER CREATE ON-CALL POLICY OFFERS "PAGE IT FOR EVERY NEW INCIDENT AND
 * ALERT" (EveryNewEventRules).
 *
 * Offered to someone who may add on-call rules for incidents and alerts:
 * on for a project's first policy - no on-call policy (archived ones count)
 * and no on-call rule of either kind yet - and off for a later one, whose
 * dialog otherwise never said it would page nobody (#7371,
 * getEveryNewEventRulesOfferKind). The policies list tells it when its
 * first page has loaded: a page with a policy on it settles the answer (a
 * later policy) without a request; an empty one has it counted, with three
 * counts of the whole project, once. Until they are known, and if one
 * fails, nothing is offered.
 *
 * `prepareCreate` is the create form's onBeforeCreate: it drops the switch
 * from the request whenever the form does not offer it, so a switch left on
 * while it was hidden asks for nothing.
 */

export interface EveryNewEventRulesOffer {
  // Read when the form is drawn, and again when it is sent.
  isOffered: () => boolean;
  /*
   * Whether the switch starts on, read as the page is drawn: the page is
   * drawn again once the counts are in.
   */
  startsOn: () => boolean;
  // The policies list's first page has loaded with this many rows.
  onPoliciesListed: (rowCount: number) => void;
  prepareCreate: (miscDataProps: JSONObject) => void;
}

type CountFacts = Omit<EveryNewEventRulesOfferFacts, "mayAddRules">;

const UNKNOWN_FACTS: CountFacts = {
  policyCount: null,
  incidentRuleCount: null,
  alertRuleCount: null,
};

export const mayAddEveryNewEventRules: () => boolean = (): boolean => {
  return (
    PermissionGate.check(new IncidentOnCallRule(), ModelAction.Create)
      .isAllowed &&
    PermissionGate.check(new AlertOnCallRule(), ModelAction.Create).isAllowed
  );
};

const useEveryNewEventRulesOffer: () => EveryNewEventRulesOffer =
  (): EveryNewEventRulesOffer => {
    const facts: MutableRefObject<CountFacts> =
      useRef<CountFacts>(UNKNOWN_FACTS);
    const isCounting: MutableRefObject<boolean> = useRef<boolean>(false);

    // Drawn again once the counts are in, so the form's showIf reads them.
    const [, setRevision] = useState<number>(0);

    const getKind: () => EveryNewEventRulesOfferKind =
      useCallback((): EveryNewEventRulesOfferKind => {
        return getEveryNewEventRulesOfferKind({
          ...facts.current,
          mayAddRules: mayAddEveryNewEventRules(),
        });
      }, []);

    const isOffered: () => boolean = useCallback((): boolean => {
      return getKind() !== EveryNewEventRulesOfferKind.None;
    }, [getKind]);

    const startsOn: () => boolean = useCallback((): boolean => {
      return doesEveryNewEventRulesOfferStartOn(getKind());
    }, [getKind]);

    const onPoliciesListed: (rowCount: number) => void = useCallback(
      (rowCount: number): void => {
        if (rowCount > 0) {
          const wasKnown: boolean = (facts.current.policyCount || 0) > 0;
          facts.current = { ...facts.current, policyCount: rowCount };

          // A later policy now: a dialog already open offers its switch.
          if (!wasKnown) {
            setRevision((revision: number): number => {
              return revision + 1;
            });
          }

          return;
        }

        if (isCounting.current || facts.current.policyCount !== null) {
          return;
        }

        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          return;
        }

        isCounting.current = true;

        Promise.all([
          ModelAPI.count<OnCallDutyPolicy>({
            modelType: OnCallDutyPolicy,
            query: { projectId: projectId },
          }),
          ModelAPI.count<IncidentOnCallRule>({
            modelType: IncidentOnCallRule,
            query: { projectId: projectId },
          }),
          ModelAPI.count<AlertOnCallRule>({
            modelType: AlertOnCallRule,
            query: { projectId: projectId },
          }),
        ])
          .then(
            ([
              policyCount,
              incidentRuleCount,
              alertRuleCount,
            ]: Array<number>) => {
              facts.current = {
                policyCount: policyCount ?? null,
                incidentRuleCount: incidentRuleCount ?? null,
                alertRuleCount: alertRuleCount ?? null,
              };
              setRevision((revision: number): number => {
                return revision + 1;
              });
            },
          )
          .catch(() => {
            // Unknown offers nothing: the form is what it always was.
          })
          .finally(() => {
            isCounting.current = false;
          });
      },
      [],
    );

    const prepareCreate: (miscDataProps: JSONObject) => void = useCallback(
      (miscDataProps: JSONObject): void => {
        if (!isOffered()) {
          delete miscDataProps[PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY];
          delete miscDataProps[EVERY_NEW_EVENT_RULES_LANGUAGE_KEY];
          return;
        }

        /*
         * The two rules are named in the language the form is read in
         * (#7995): the server words them in it.
         */
        if (miscDataProps[PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]) {
          miscDataProps[EVERY_NEW_EVENT_RULES_LANGUAGE_KEY] =
            getGlobalTranslator().language;
        }
      },
      [isOffered],
    );

    return { isOffered, startsOn, onPoliciesListed, prepareCreate };
  };

export default useEveryNewEventRulesOffer;
