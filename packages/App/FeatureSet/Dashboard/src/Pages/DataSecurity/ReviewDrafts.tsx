import PageComponentProps from "../PageComponentProps";
import {
  BACK_TO_COMPLIANCE,
  NEXT_STORE,
  NOT_IN_THE_RECORD,
  NOT_LEGAL_ADVICE,
  NOTHING_TO_REVIEW_DESCRIPTION,
  NOTHING_TO_REVIEW_TITLE,
  OPEN_STORE,
  PREVIOUS_STORE,
  REVIEW_DRAFTS,
  REVIEW_DRAFTS_DESCRIPTION,
  STORE_OF,
  UNSAVED_RECORD,
} from "../../Components/DataSecurity/ComplianceDraftsCopy";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import {
  DraftRecordButton,
  ImpactAssessmentLink,
  StoreRecordFields,
} from "../../Components/DataSecurity/StoreRecord";
import StoreNameCell from "../../Components/DataSecurity/StoreNameCell";
import AppLink from "../../Components/AppLink/AppLink";
import LeaveWithoutSavingQuestion from "../../Components/UnsavedChanges/LeaveWithoutSavingQuestion";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import {
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
  RecordRowState,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { isDataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import useLeaveGuard, { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * REVIEW DRAFTS (#10375): THE RECORD OF PROCESSING'S DRAFTS, ONE STORE AT A
 * TIME.
 *
 * Every store with a draft waiting, or a change proposed for a confirmed
 * field, in the record's order - or, from a store's own link
 * (?store=<id>), that store first. For each, its four fields as they
 * stand, each confirmed or edited with one press, the facts a draft rests
 * on one click away (StoreRecordFields), and its recipients and transfers,
 * worked out by plain code. Where its fields are empty, Draft with
 * OneUptime AI drafts them now; Draft Again drafts again what no person
 * confirmed. "Not legal advice" is said once, under the title. The last
 * store's Next is Back to Compliance, and a field being edited holds the
 * reader on the page until it is saved or let go.
 */

export const REVIEW_DRAFTS_TEST_ID: string = "data-security-review-drafts";

function asStore(row: DataSecurityRecordOfProcessingRow): DataStore {
  const store: DataStore = new DataStore();

  store._id = row.dataStoreId;
  store.name = row.name;

  if (isDataStoreKind(row.kind)) {
    store.kind = row.kind;
  }

  store.region = row.region;

  return store;
}

// The stores to walk through: those waiting for a person, a linked one first.
export function getStoresToReview(
  rows: ReadonlyArray<DataSecurityRecordOfProcessingRow>,
  linkedStoreId: string | null,
): Array<string> {
  const ids: Array<string> = rows
    .filter((row: DataSecurityRecordOfProcessingRow): boolean => {
      return row.state === RecordRowState.ToReview;
    })
    .map((row: DataSecurityRecordOfProcessingRow): string => {
      return row.dataStoreId;
    });
  const linked: string = (linkedStoreId || "").toLowerCase();
  const isLinkedInRecord: boolean = rows.some(
    (row: DataSecurityRecordOfProcessingRow): boolean => {
      return row.dataStoreId.toLowerCase() === linked;
    },
  );

  if (!linked || !isLinkedInRecord) {
    return ids;
  }

  return [
    rows.find((row: DataSecurityRecordOfProcessingRow): boolean => {
      return row.dataStoreId.toLowerCase() === linked;
    })!.dataStoreId,
    ...ids.filter((id: string): boolean => {
      return id.toLowerCase() !== linked;
    }),
  ];
}

const ReviewDraftsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [record, setRecord] =
    useState<DataSecurityRecordOfProcessingResponse | null>(null);
  const [storeIds, setStoreIds] = useState<Array<string>>([]);
  const [index, setIndex] = useState<number>(0);
  const [row, setRow] = useState<DataSecurityRecordOfProcessingRow | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [rowError, setRowError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [hasUnsaved, setHasUnsaved] = useState<boolean>(false);
  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsaved);

  // The record once: which stores wait for a person.
  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");
    DataSecurityApi.getRecordOfProcessing()
      .then((answer: DataSecurityRecordOfProcessingResponse) => {
        if (!isCurrent) {
          return;
        }

        setRecord(answer);
        setStoreIds(
          getStoresToReview(
            answer.rows || [],
            Navigation.getQueryStringByName("store"),
          ),
        );
        setIndex(0);
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const currentId: string | undefined = storeIds[index];

  // The store in front of the person, with the facts its drafts rest on.
  useEffect(() => {
    if (!currentId) {
      setRow(null);
      return undefined;
    }

    let isCurrent: boolean = true;

    setRow(null);
    setRowError("");
    DataSecurityApi.getRecordOfProcessing({
      dataStoreId: new ObjectID(currentId),
    })
      .then((answer: DataSecurityRecordOfProcessingResponse) => {
        if (!isCurrent) {
          return;
        }

        const read: DataSecurityRecordOfProcessingRow | undefined =
          answer.rows?.[0];

        // Its personal data was gone by the time it was opened.
        if (read) {
          setRow(read);
        } else {
          setRowError(translator.translateText(NOT_IN_THE_RECORD) || "");
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setRowError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [currentId]);

  const complianceRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_COMPLIANCE] as Route,
  );
  const canEdit: boolean = record?.canEdit !== false;
  const canDraft: boolean = record?.canDraft === true;
  const progress: ReactElement =
    storeIds.length > 0 ? (
      <span
        className="text-sm text-gray-600"
        data-testid={`${REVIEW_DRAFTS_TEST_ID}-progress`}
      >
        {translator.translateTemplate(STORE_OF, {
          index: translator.formatNumber(index + 1),
          count: translator.formatNumber(storeIds.length),
        })}
      </span>
    ) : (
      <></>
    );

  // From store to store: the last one's way on is back to Compliance.
  const navigation: ReactElement = (
    <div className="flex flex-wrap gap-2">
      <Button
        title={PREVIOUS_STORE}
        icon={IconProp.ChevronLeft}
        buttonStyle={ButtonStyleType.OUTLINE}
        disabled={index === 0 || hasUnsaved}
        dataTestId={`${REVIEW_DRAFTS_TEST_ID}-previous`}
        onClick={() => {
          setIndex(index - 1);
        }}
      />
      {index < storeIds.length - 1 ? (
        <Button
          title={NEXT_STORE}
          icon={IconProp.ChevronRight}
          buttonStyle={ButtonStyleType.PRIMARY}
          disabled={hasUnsaved}
          dataTestId={`${REVIEW_DRAFTS_TEST_ID}-next`}
          onClick={() => {
            setIndex(index + 1);
          }}
        />
      ) : (
        <Button
          title={BACK_TO_COMPLIANCE}
          icon={IconProp.Check}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId={`${REVIEW_DRAFTS_TEST_ID}-done`}
          onClick={() => {
            Navigation.navigate(complianceRoute);
          }}
        />
      )}
    </div>
  );

  let body: ReactElement;

  if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setRecord(null);
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!record) {
    body = <DetailListSkeleton />;
  } else if (storeIds.length === 0) {
    body = (
      <EmptyState
        id={`${REVIEW_DRAFTS_TEST_ID}-empty`}
        icon={IconProp.CheckCircle}
        title={NOTHING_TO_REVIEW_TITLE}
        description={NOTHING_TO_REVIEW_DESCRIPTION}
        footer={
          <AppLink
            to={complianceRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText(BACK_TO_COMPLIANCE) || BACK_TO_COMPLIANCE}
          </AppLink>
        }
      />
    );
  } else if (rowError) {
    body = (
      <div className="space-y-4">
        <ErrorLine message={rowError} />
        <div className="flex justify-end border-t border-gray-100 pt-4">
          {navigation}
        </div>
      </div>
    );
  } else if (!row) {
    body = <DetailListSkeleton />;
  } else {
    const storeRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS] as Route,
      { modelId: new ObjectID(row.dataStoreId) },
    );

    body = (
      <div className="space-y-2" data-testid={`${REVIEW_DRAFTS_TEST_ID}-store`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <div className="min-w-0">
            <StoreNameCell store={asStore(row)} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ImpactAssessmentLink row={row} />
            <AppLink
              to={storeRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText(OPEN_STORE) || OPEN_STORE}
            </AppLink>
          </div>
        </div>
        <StoreRecordFields
          row={row}
          canEdit={canEdit}
          onRowChange={setRow}
          onUnsavedChange={setHasUnsaved}
        />
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-gray-100 pt-4">
          <DraftRecordButton
            row={row}
            canDraft={canDraft}
            disabled={hasUnsaved}
            onRowChange={setRow}
            dataTestId={`${REVIEW_DRAFTS_TEST_ID}-draft`}
          />
          {navigation}
        </div>
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title={REVIEW_DRAFTS}
        description={REVIEW_DRAFTS_DESCRIPTION}
        rightElement={progress}
      >
        <div className="space-y-4" data-testid={REVIEW_DRAFTS_TEST_ID}>
          <p className="text-xs text-gray-600">
            {translator.translateText(NOT_LEGAL_ADVICE)}
          </p>
          {body}
        </div>
      </Card>
      <LeaveWithoutSavingQuestion
        prompt={leavePrompt}
        description={UNSAVED_RECORD}
      />
    </Fragment>
  );
};

export default ReviewDraftsPage;
