import {
  NOT_LEGAL_ADVICE,
  RECORD_CARD_DESCRIPTION,
  RECORD_CARD_TITLE,
  UNSAVED_RECORD,
} from "./ComplianceDraftsCopy";
import DataSecurityApi from "./DataSecurityApi";
import {
  DraftRecordButton,
  ImpactAssessmentLink,
  StoreRecordFields,
  writeRecordField,
} from "./StoreRecord";
import LeaveWithoutSavingQuestion from "../UnsavedChanges/LeaveWithoutSavingQuestion";
import usePendingEdits, {
  PendingEdits,
} from "../UnsavedChanges/UsePendingEdits";
import {
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  RecordField,
  RecordFieldStatus,
  RecordFieldValue,
  RecordFieldView,
} from "Common/Types/DataSecurity/RecordOfProcessing";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useLeaveGuard, { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FOUND STORE'S RECORD OF PROCESSING, ON ITS SETTINGS (#10375).
 *
 * The four fields GDPR Article 30 asks of it - Purpose, Retention, Legal
 * Basis and People It Is About - each with where it stands, OneUptime AI's
 * draft confirmed or edited with one press (StoreRecordFields), then its
 * recipients and transfers, worked out from its flows and regions. Under
 * them, Draft with OneUptime AI for what nobody wrote, and its impact
 * assessment, for a store that needs one.
 *
 * A store with no personal data is not in the record: this draws nothing,
 * and says so (onIsInRecordChange), so its Settings draw the plain purpose
 * and retention they always had beside it - never a card inside this one.
 */

export const STORE_RECORD_CARD_TEST_ID: string =
  "data-security-store-record-card";

const StoreRecordCard: FunctionComponent<{
  dataStoreId: ObjectID;
  onIsInRecordChange: (isInRecord: boolean) => void;
}> = (props: {
  dataStoreId: ObjectID;
  onIsInRecordChange: (isInRecord: boolean) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] =
    useState<DataSecurityRecordOfProcessingResponse | null>(null);
  const [row, setRow] = useState<DataSecurityRecordOfProcessingRow | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  // The fields a person is mid-edit on, with the value each one's Save would write.
  const pending: PendingEdits<RecordFieldValue | null> =
    usePendingEdits<RecordFieldValue | null>();
  const hasUnsaved: boolean = pending.hasUnsaved;
  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsaved);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");
    DataSecurityApi.getRecordOfProcessing({ dataStoreId: props.dataStoreId })
      .then((read: DataSecurityRecordOfProcessingResponse) => {
        if (isCurrent) {
          setAnswer(read);
          setRow(read.rows?.[0] || null);
          props.onIsInRecordChange(Boolean(read.rows?.[0]));
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.dataStoreId.toString(), readCount]);

  if (error) {
    return (
      <Card title={RECORD_CARD_TITLE} description={RECORD_CARD_DESCRIPTION}>
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setAnswer(null);
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      </Card>
    );
  }

  if (!answer) {
    return (
      <Card title={RECORD_CARD_TITLE} description={RECORD_CARD_DESCRIPTION}>
        <DetailListSkeleton />
      </Card>
    );
  }

  // Not in the record: the page draws its plain card instead (onIsInRecordChange).
  if (!row) {
    return <></>;
  }

  const dataStoreId: string = row.dataStoreId;

  // "Not legal advice" where OneUptime AI's words wait for a person.
  const hasDrafts: boolean = (row.fields || []).some(
    (view: RecordFieldView): boolean => {
      return (
        view.status === RecordFieldStatus.Drafted ||
        view.status === RecordFieldStatus.ChangeProposed
      );
    },
  );

  return (
    <Fragment>
      <Card title={RECORD_CARD_TITLE} description={RECORD_CARD_DESCRIPTION}>
        <div className="space-y-2" data-testid={STORE_RECORD_CARD_TEST_ID}>
          {hasDrafts ? (
            <p className="text-xs text-gray-600">
              {translator.translateText(NOT_LEGAL_ADVICE)}
            </p>
          ) : (
            <></>
          )}
          <StoreRecordFields
            row={row}
            canEdit={answer.canEdit !== false}
            onRowChange={setRow}
            pending={pending}
          />
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-gray-100 pt-4 empty:hidden">
            <DraftRecordButton
              row={row}
              canDraft={answer.canDraft === true}
              disabled={hasUnsaved}
              onRowChange={setRow}
              dataTestId={`${STORE_RECORD_CARD_TEST_ID}-draft`}
            />
            <ImpactAssessmentLink row={row} />
          </div>
        </div>
      </Card>
      <LeaveWithoutSavingQuestion
        prompt={leavePrompt}
        description={UNSAVED_RECORD}
        onSaveChanges={pending.saveAllWith(
          async (field: string, value: RecordFieldValue | null) => {
            await writeRecordField({
              dataStoreId,
              field: field as RecordField,
              value,
            });
          },
        )}
      />
    </Fragment>
  );
};

export default StoreRecordCard;
