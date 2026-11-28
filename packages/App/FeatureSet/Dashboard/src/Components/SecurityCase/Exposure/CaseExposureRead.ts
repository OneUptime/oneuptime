import DataSecurityApi, {
  DataSecurityApiError,
} from "../../DataSecurity/DataSecurityApi";
import { DataSecurityExposureAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
  readSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";
import { useEffect, useState } from "react";

/*
 * A SECURITY CASE'S EXPOSURE ASSESSMENT, AS A PAGE OF THE CASE READS IT
 * (#10377, #10954): only for a case whose entities name a data store, and
 * only drawn for a reader the server lets read it - the case's readers who
 * may read the store and its findings too. Everyone else gets nothing, not
 * an error: the assessment names what the store holds.
 */

// Whether a case's entities name a data store: only then is the assessment read.
export function isCaseAboutAStore(entities: JSONArray | undefined): boolean {
  return readSecurityEntities(entities).some(
    (entity: SecurityEntity): boolean => {
      return entity.type === SecurityEntityType.DataStore;
    },
  );
}

// A refusal of the read: the reader may not read the store's findings.
export function isExposureReadRefusal(error: unknown): boolean {
  return (
    error instanceof DataSecurityApiError &&
    (error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.statusCode === 422)
  );
}

/*
 * Whether a page draws anything of an answer: an assessment worked out, or
 * one still to make of a store the reader may read. A case about no store
 * they may read has nothing to show - the Overview draws no card for it.
 */
export function isExposureAnswerShown(
  answer: DataSecurityExposureAssessmentResponse | null,
): answer is DataSecurityExposureAssessmentResponse {
  return Boolean(
    answer && ((answer.assessment && answer.view) || answer.stores.length > 0),
  );
}

/*
 * The case's assessment, read once for the page - again when the case
 * changes (refreshToken) - or null: a case about no store, a reader the
 * server refuses, a read that failed, or one still on its way. A page that
 * only adds to what it already shows (the Tasks page's answers) draws
 * nothing for null; the Overview's cards read it themselves, to say why.
 */
export function useCaseExposureAnswer(data: {
  caseId: ObjectID;
  entities: JSONArray | undefined;
  refreshToken?: string | undefined;
}): DataSecurityExposureAssessmentResponse | null {
  const isAboutAStore: boolean = isCaseAboutAStore(data.entities);
  const [answer, setAnswer] =
    useState<DataSecurityExposureAssessmentResponse | null>(null);

  useEffect(() => {
    if (!isAboutAStore) {
      setAnswer(null);
      return;
    }

    let isCurrent: boolean = true;

    DataSecurityApi.getExposureAssessment(data.caseId)
      .then((read: DataSecurityExposureAssessmentResponse) => {
        if (isCurrent) {
          setAnswer(read);
        }
      })
      .catch(() => {
        // Refused, or not read: the page shows what it shows without it.
        if (isCurrent) {
          setAnswer(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [data.caseId.toString(), data.refreshToken, isAboutAStore]);

  return answer;
}
