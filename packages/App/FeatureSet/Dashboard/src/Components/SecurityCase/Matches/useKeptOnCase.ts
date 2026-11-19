import SecurityCaseApi from "../SecurityCaseApi";
import { getAddToCaseGate } from "../../SecurityEvents/Hunts/useAddEventsToCase";
import { KEPT_ON_CASE_DONE } from "./SecurityCaseMatchesCopy";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import {
  SECURITY_CASE_EVENTS_ADD_REASONS,
  SecurityCaseEventsAddResult,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import { SecurityCaseMatchedEventJson } from "Common/Types/SecurityCase/SecurityCaseMatches";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { translateText } from "Common/UI/Utils/TranslateTemplate";
import { useEffect, useState } from "react";

/*
 * KEEPING A MATCHED EVENT ON THE CASE, FROM "WHY THIS CASE WAS OPENED"
 * (#9622).
 *
 * An event a detection matched is kept on the case's Evidence page in one
 * click, the same evidence Add to Case keeps, naming the detection it was
 * matched by - and, past its retention, as the detection kept it. The card
 * knows which of its events the case keeps already, read once with the
 * case's evidence, so an event kept is shown kept, never kept twice: the
 * server leaves one kept already as it was. Whether the reader may keep
 * events is the Add to Case gate's to say.
 *
 * Saying it worked, or why it did not, is a toast: nothing blocks the page.
 */

// The most of the case's kept events read to know which are kept.
export const KEPT_EVENTS_READ_LIMIT: number = 500;

export interface KeptOnCase {
  // Whether the case keeps the event already.
  isKept: (event: Pick<SecurityCaseMatchedEventJson, "eventUid">) => boolean;
  // Whether this event is being kept now.
  isKeeping: (event: Pick<SecurityCaseMatchedEventJson, "eventUid">) => boolean;
  // Whether the reader may keep events, and why not.
  gate: PermissionGateResult;
  keep: (data: {
    event: Pick<SecurityCaseMatchedEventJson, "eventUid" | "time">;
    detectionId: string;
  }) => Promise<void>;
}

export default function useKeptOnCase(caseId: ObjectID): KeptOnCase {
  const [keptUids, setKeptUids] = useState<Set<string>>(new Set<string>());
  const [keepingUid, setKeepingUid] = useState<string>("");
  const caseIdText: string = caseId.toString();
  const gate: PermissionGateResult = getAddToCaseGate();

  // The events the case keeps already: none known when they cannot be read.
  useEffect(() => {
    let isCurrent: boolean = true;

    setKeptUids(new Set<string>());

    ModelAPI.getList<SecurityCaseEvidence>({
      modelType: SecurityCaseEvidence,
      query: {
        securityCaseId: new ObjectID(caseIdText),
        kind: SecurityCaseEvidenceKind.Event,
      },
      select: { eventUid: true },
      limit: KEPT_EVENTS_READ_LIMIT,
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<SecurityCaseEvidence>): void => {
        if (!isCurrent) {
          return;
        }

        setKeptUids(
          new Set<string>(
            result.data
              .map((item: SecurityCaseEvidence): string => {
                return item.eventUid || "";
              })
              .filter(Boolean),
          ),
        );
      })
      .catch((): void => {
        // Not known: keeping says so, as the server answers it.
      });

    return () => {
      isCurrent = false;
    };
  }, [caseIdText]);

  return {
    isKept: (
      event: Pick<SecurityCaseMatchedEventJson, "eventUid">,
    ): boolean => {
      return Boolean(event.eventUid) && keptUids.has(event.eventUid);
    },
    isKeeping: (
      event: Pick<SecurityCaseMatchedEventJson, "eventUid">,
    ): boolean => {
      return Boolean(event.eventUid) && keepingUid === event.eventUid;
    },
    gate,
    keep: async (data: {
      event: Pick<SecurityCaseMatchedEventJson, "eventUid" | "time">;
      detectionId: string;
    }): Promise<void> => {
      const { event } = data;

      if (!event.eventUid || !event.time || keepingUid) {
        return;
      }

      setKeepingUid(event.eventUid);

      try {
        const result: SecurityCaseEventsAddResult =
          await SecurityCaseApi.addEventsToCase({
            caseId: new ObjectID(caseIdText),
            events: [{ eventUid: event.eventUid, time: new Date(event.time) }],
            detectionId: ObjectID.isValidUUID(data.detectionId)
              ? new ObjectID(data.detectionId)
              : undefined,
          });

        if (
          result.added.includes(event.eventUid) ||
          result.alreadyOnCase.includes(event.eventUid)
        ) {
          setKeptUids((current: Set<string>): Set<string> => {
            return new Set<string>([...Array.from(current), event.eventUid]);
          });
          Toast.success(translateText(KEPT_ON_CASE_DONE) || KEPT_ON_CASE_DONE);
        } else {
          const message: string =
            SECURITY_CASE_EVENTS_ADD_REASONS.notFound.message;

          Toast.error(translateText(message) || message);
        }
      } catch (error) {
        Toast.error(API.getFriendlyMessage(error as Error));
      } finally {
        setKeepingUid("");
      }
    },
  };
}
