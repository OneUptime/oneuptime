import { isCaseAboutAStore, isExposureReadRefusal } from "./CaseExposureRead";
import {
  ASSESS_EXPOSURE,
  ASSESSED_TOAST,
  EXPOSURE_CARD_PLACE,
  EXPOSURE_TEST_IDS,
  NOT_ASSESSED_DESCRIPTION,
  NOT_ASSESSED_READ_ONLY,
  NOT_ASSESSED_TITLE,
  STORE_TO_ASSESS,
  WAS_IT_A_BREACH,
  WAS_IT_A_BREACH_DESCRIPTION,
} from "./ExposureAssessmentCopy";
import ExposureAssessmentCard from "./ExposureAssessmentCard";
import ExposureNoticesCard from "./ExposureNoticesCard";
import DataSecurityApi from "../../DataSecurity/DataSecurityApi";
import {
  DataSecurityExposureAssessmentResponse,
  DataSecurityExposureCaseStore,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
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
 * WAS IT A BREACH? A SECURITY CASE ABOUT A DATA STORE, ASSESSED (#10377).
 *
 * Drawn on the Overview of a case whose entities name a data store, for a
 * reader who may read the store's findings - the server refuses everyone
 * else, and the cards are then not drawn at all. Two cards:
 *
 *   Was It a Breach?   what plain code worked out from what OneUptime
 *                      recorded: the law due first and its deadline, the
 *                      line on whether reads were logged, how long the
 *                      store was open, whose data it was, the secrets to
 *                      rotate, every law of the table with what a person
 *                      still checks, where the people live, and the case's
 *                      checklist answered;
 *   Breach Notices     OneUptime AI's write-up of it - what it means, and a
 *                      notice to the regulator, to the people and an
 *                      internal summary, each folded until opened - for a
 *                      person to edit and copy.
 *
 * Data Security assesses a Critical exposure of Restricted or Confidential
 * data on its own; any other case about a store waits for Assess This
 * Exposure. Nothing on either card sends anything anywhere, and each says
 * it is not legal advice.
 */

export interface ComponentProps {
  caseId: ObjectID;
  // The case's entities: the cards are drawn only for a case about a data store.
  entities: JSONArray | undefined;
  refreshToggle?: string | undefined;
}

// Whether a case's entities name a data store: only then is the assessment read.
export { isCaseAboutAStore };

const SecurityCaseExposureAssessment: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAboutAStore: boolean = isCaseAboutAStore(props.entities);
  const [answer, setAnswer] =
    useState<DataSecurityExposureAssessmentResponse | null>(null);
  const [isRefused, setIsRefused] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [pickedStoreId, setPickedStoreId] = useState<string>("");
  const [isAssessing, setIsAssessing] = useState<boolean>(false);
  const [assessError, setAssessError] = useState<string>("");

  useEffect(() => {
    if (!isAboutAStore) {
      return;
    }

    let isCurrent: boolean = true;

    setError("");
    DataSecurityApi.getExposureAssessment(props.caseId)
      .then((read: DataSecurityExposureAssessmentResponse) => {
        if (isCurrent) {
          setAnswer(read);
          setIsRefused(false);
        }
      })
      .catch((err: unknown) => {
        if (!isCurrent) {
          return;
        }

        if (isExposureReadRefusal(err)) {
          setIsRefused(true);
          return;
        }

        setError(API.getFriendlyMessage(err));
      });

    return () => {
      isCurrent = false;
    };
  }, [props.caseId.toString(), props.refreshToggle, readCount, isAboutAStore]);

  if (!isAboutAStore || isRefused) {
    return <></>;
  }

  if (error) {
    return (
      <Card
        id={EXPOSURE_CARD_PLACE}
        title={WAS_IT_A_BREACH}
        description={WAS_IT_A_BREACH_DESCRIPTION}
      >
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
      <Card
        id={EXPOSURE_CARD_PLACE}
        title={WAS_IT_A_BREACH}
        description={WAS_IT_A_BREACH_DESCRIPTION}
      >
        <DetailListSkeleton />
      </Card>
    );
  }

  // A case about no store the reader may read: nothing to assess here.
  if (!answer.assessment && answer.stores.length === 0) {
    return <></>;
  }

  if (!answer.assessment || !answer.view) {
    const assess: () => Promise<void> = async (): Promise<void> => {
      setIsAssessing(true);
      setAssessError("");

      try {
        setAnswer(
          await DataSecurityApi.assessExposure({
            securityCaseId: props.caseId,
            dataStoreId:
              answer.stores.length > 1 ? pickedStoreId || undefined : undefined,
          }),
        );
        Toast.success(translator.translateText(ASSESSED_TOAST) || "");
      } catch (err) {
        setAssessError(API.getFriendlyMessage(err));
      } finally {
        setIsAssessing(false);
      }
    };
    const storeOptions: Array<DropdownOption> = answer.stores.map(
      (store: DataSecurityExposureCaseStore): DropdownOption => {
        return {
          value: store.dataStoreId,
          // A store's name is the cloud's: drawn as it is.
          label: store.name,
          isUserContent: true,
        };
      },
    );

    return (
      <Card
        id={EXPOSURE_CARD_PLACE}
        title={WAS_IT_A_BREACH}
        description={WAS_IT_A_BREACH_DESCRIPTION}
      >
        <EmptyState
          id={EXPOSURE_TEST_IDS.notAssessed}
          size={EmptyStateSize.Inline}
          icon={IconProp.Scale}
          title={NOT_ASSESSED_TITLE}
          description={
            answer.canChange ? NOT_ASSESSED_DESCRIPTION : NOT_ASSESSED_READ_ONLY
          }
          footer={
            answer.canChange ? (
              <div className="flex flex-col items-center gap-3">
                {answer.stores.length > 1 ? (
                  <div className="w-full max-w-xs text-start">
                    <Dropdown
                      options={storeOptions}
                      placeholder={STORE_TO_ASSESS}
                      ariaLabel={STORE_TO_ASSESS}
                      dataTestId={EXPOSURE_TEST_IDS.storePicker}
                      value={storeOptions.find(
                        (option: DropdownOption): boolean => {
                          return option.value === pickedStoreId;
                        },
                      )}
                      onChange={(
                        value: DropdownValue | Array<DropdownValue> | null,
                      ) => {
                        setPickedStoreId(
                          typeof value === "string" ? value : "",
                        );
                      }}
                    />
                  </div>
                ) : (
                  <></>
                )}
                {assessError ? <ErrorLine message={assessError} /> : <></>}
                <Button
                  title={ASSESS_EXPOSURE}
                  icon={IconProp.Scale}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  isLoading={isAssessing}
                  disabled={answer.stores.length > 1 && !pickedStoreId}
                  dataTestId={EXPOSURE_TEST_IDS.assess}
                  onClick={() => {
                    void assess();
                  }}
                />
              </div>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <Fragment>
      <ExposureAssessmentCard
        caseId={props.caseId}
        answer={answer}
        onChanged={setAnswer}
      />
      <ExposureNoticesCard
        caseId={props.caseId}
        answer={answer}
        onChanged={setAnswer}
      />
    </Fragment>
  );
};

export default SecurityCaseExposureAssessment;
