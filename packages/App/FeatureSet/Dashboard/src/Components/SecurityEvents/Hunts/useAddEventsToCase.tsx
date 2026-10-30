import {
  ADDED_TO_CASE,
  ADD_TO_CASE,
  ALREADY_ON_CASE_COUNT,
  ADD_TO_CASE_CAP_TOOLTIP,
  NOT_ADDED_TO_CASE,
  OPEN_CASE_NUMBER,
  OPEN_THE_CASE,
} from "./HuntsCopy";
import {
  CaseEventReference,
  getCaseEventOutcome,
  getCaseEventReferences,
} from "./AddToCaseModel";
import AddToCaseModal, { PickedCase } from "./AddToCaseModal";
import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import Route from "Common/Types/API/Route";
import GenericObject from "Common/Types/GenericObject";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD,
  SecurityCaseEventsAddResult,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import {
  BulkItemOutcome,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { MutableRefObject, ReactElement, useRef, useState } from "react";

/*
 * "Add to Case" on a list of security events (Events, a hunt's page): the
 * events ticked are kept on the case picked, as evidence, in one request
 * (SecurityCaseApi.addEventsToCase) - read by OneUptime as the person, so
 * only events they can read are kept - and the result says what happened
 * to each: kept, kept on the case already, or not found. Its last line
 * opens the case's Evidence page.
 *
 * Gated on what the server asks: adding evidence to cases, and reading
 * them to pick one. More than SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD
 * ticked: it stays on the menu, locked, saying why.
 */

type SecurityEventRow = SecurityEvent & GenericObject;

export interface AddEventsToCaseActions {
  bulkActions: Array<BulkActionButtonSchema<SecurityEventRow>>;
  modals: ReactElement;
}

// A case's Evidence page, where events kept on it are listed.
export function getCaseEvidenceRoute(caseId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_CASE_VIEW_EVIDENCE] as Route,
    { modelId: new ObjectID(caseId) },
  );
}

/*
 * Whether the reader may keep events on a case: add evidence, and read
 * cases to pick one. The first refusal wins, with its reason.
 */
export function getAddToCaseGate(): PermissionGateResult {
  const evidenceGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseEvidence(),
    ModelAction.Create,
  );

  if (!evidenceGate.isAllowed && evidenceGate.disabledReason) {
    return evidenceGate;
  }

  return PermissionGate.check(new SecurityCase(), ModelAction.Read);
}

export default function useAddEventsToCase(options: {
  // The hunt the events were found by, when the list is a hunt's.
  huntId?: ObjectID | undefined;
}): AddEventsToCaseActions {
  const translator: Translator = useTranslator();
  const [actionProps, setActionProps] =
    useState<BulkActionOnClickProps<SecurityEventRow> | null>(null);

  /*
   * The case the last run kept events on, for the result's link. A ref,
   * not state: the result reads it when it is drawn, after the run.
   */
  const resultCaseRef: MutableRefObject<PickedCase | null> =
    useRef<PickedCase | null>(null);

  const closeDialog: () => void = (): void => {
    setActionProps(null);
  };

  const resultDetails: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const picked: PickedCase | null = resultCaseRef.current;

    if (!picked?.id) {
      return undefined;
    }

    return (
      <Link
        to={getCaseEvidenceRoute(picked.id)}
        className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <span>
          {picked.number
            ? translator.translateTemplate(OPEN_CASE_NUMBER, {
                number: picked.number,
              })
            : translator.translateText(OPEN_THE_CASE) || OPEN_THE_CASE}
        </span>
        <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
      </Link>
    );
  };

  const runAdd: (picked: PickedCase) => Promise<void> = async (
    picked: PickedCase,
  ): Promise<void> => {
    const props: BulkActionOnClickProps<SecurityEventRow> | null = actionProps;
    closeDialog();

    if (!props) {
      return;
    }

    const references: Array<CaseEventReference> = getCaseEventReferences(
      props.items,
    );
    resultCaseRef.current = null;

    // One request for every selected event; each reads its own outcome.
    let request: Promise<SecurityCaseEventsAddResult> | null = null;

    await runBulkAction<SecurityEventRow>({
      actionProps: props,
      concurrency: Math.max(1, props.items.length),
      // One request for all of them: there is nothing left to stop.
      isStoppable: false,
      step: async (item: SecurityEventRow): Promise<BulkItemOutcome> => {
        if (!request) {
          request = SecurityCaseApi.addEventsToCase({
            caseId: new ObjectID(picked.id),
            events: references,
            huntId: options.huntId,
          }).then((result: SecurityCaseEventsAddResult) => {
            // The way to the case, once some of them are on it.
            if (result.added.length > 0 || result.alreadyOnCase.length > 0) {
              resultCaseRef.current = picked;
            }

            return result;
          });
        }

        return getCaseEventOutcome({
          eventUid: item.eventUid?.toString() || "",
          result: await request,
        });
      },
    });
  };

  const gate: PermissionGateResult = getAddToCaseGate();

  const addToCaseAction: BulkActionButtonSchema<SecurityEventRow> = {
    title: ADD_TO_CASE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.PaperClip,
    resultLabels: {
      succeeded: ADDED_TO_CASE,
      failed: NOT_ADDED_TO_CASE,
      unchanged: ALREADY_ON_CASE_COUNT,
    },
    resultDetails: resultDetails,
    onClick: async (
      props: BulkActionOnClickProps<SecurityEventRow>,
    ): Promise<void> => {
      if (props.items.length > SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD) {
        return;
      }

      setActionProps(props);
    },
  };

  const capTooltip: string = translator.translateTemplate(
    ADD_TO_CASE_CAP_TOOLTIP,
    {
      count: translator.formatNumber(SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD),
    },
  );

  /*
   * A known missing permission locks the action and says which one, as
   * every bulk action does. Otherwise two entries, exactly one of which is
   * shown for a selection: the working one up to the cap, and a locked twin
   * with the reason above it.
   */
  const bulkActions: Array<BulkActionButtonSchema<SecurityEventRow>> =
    !gate.isAllowed && gate.disabledReason
      ? [
          {
            ...addToCaseAction,
            disabled: true,
            tooltip: gate.disabledReason,
          },
        ]
      : [
          {
            ...addToCaseAction,
            isVisible: (items: Array<SecurityEventRow>): boolean => {
              return items.length <= SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD;
            },
          },
          {
            ...addToCaseAction,
            isVisible: (items: Array<SecurityEventRow>): boolean => {
              return items.length > SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD;
            },
            disabled: true,
            tooltip: capTooltip,
          },
        ];

  const modals: ReactElement = actionProps ? (
    <AddToCaseModal
      eventCount={getCaseEventReferences(actionProps.items).length}
      onClose={closeDialog}
      onPick={(picked: PickedCase) => {
        void runAdd(picked);
      }}
    />
  ) : (
    <></>
  );

  return {
    bulkActions,
    modals,
  };
}
