import AppLink from "../AppLink/AppLink";
import { DECLARED_CODE_VIEW_TASK } from "../AutoRemediation/DeclaredCodeChangeWords";
import DataSecurityApi from "./DataSecurityApi";
import {
  FIX_ON_ITS_WAY,
  LEAKS_TITLE,
  LEAK_HEADING,
  MORE_PLACES,
  NO_REPOSITORY_TO_PICK,
  NO_REPOSITORY_TO_PICK_APPLICATION,
  PICK_REPOSITORY_HINT,
  PICK_REPOSITORY_HINT_APPLICATION,
  PLACE_PAGE,
  PICK_REPOSITORY_LABEL,
  PICK_REPOSITORY_PLACEHOLDER,
  PLACE_RECORDS,
  REDACTION_KEYS_LABEL,
  REPOSITORY_LINE,
  REPOSITORY_LINE_IN_FOLDER,
  REPOSITORY_LINE_IN_FOLDER_APPLICATION,
  ROTATE_SECRET,
  START_FILES,
  TELEMETRY_FIX_DESCRIPTION,
  TELEMETRY_FIX_DESCRIPTION_APPLICATION,
  TELEMETRY_FIX_ISSUES,
  TELEMETRY_FIX_ISSUES_OF_APPLICATION,
  TELEMETRY_FIX_NOT_LOADED,
  TELEMETRY_FIX_SUBMIT,
  TELEMETRY_FIX_TEST_ID,
  TELEMETRY_FIX_TITLE,
  TELEMETRY_LEAK_HANDLING_WORDS,
  TELEMETRY_LEAK_PLACE_WORDS,
  TELEMETRY_LEAK_SIGNAL_LABELS,
  TelemetryFixStrategyWords,
  TelemetryLeakPlaceKind,
  TelemetryLeakPlaceShown,
  getRepositoryChoiceWords,
  getTelemetryFixStrategyWords,
  isApplicationTelemetryFix,
  getTelemetryLeakPlacesShown,
  isTelemetryFixOnItsWay,
} from "./TelemetryFixCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  DataSecurityFixRepository,
  DataSecurityFixResult,
  DataSecurityTelemetryFixPlanJSON,
  DataSecurityTelemetryFixPlanResult,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
} from "Common/Types/DataSecurity/TelemetryLeakFix";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { Translator, formatList } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * FIX WITH AI ON A SERVICE'S TELEMETRY ISSUE (#10367): ONE PULL REQUEST FOR
 * EVERY LEAK OF THE SERVICE, SHOWN BEFORE IT IS ASKED FOR.
 *
 * Read for the reader before anything starts (TelemetryLeakFix.planForIssue):
 * how the code is changed - where the data is written, in a handful of
 * places, or one redaction step with a test - each leak and where its
 * records say it is written, the repository the pull request goes to and
 * why that one (or the reader picks it), the files OneUptime AI starts
 * from and, for a secret, that it must be rotated too. Open Pull Request
 * asks for exactly this plan: a plan that changed since it was shown
 * starts nothing, and is shown again.
 *
 * Places, keys, data types and masked templates only: never a value or a
 * record.
 */

export interface ComponentProps {
  issueId: ObjectID;
  onClose: () => void;
  // OneUptime AI was asked: the page says so and reads the issue again.
  onStarted: (result: DataSecurityFixResult) => void;
}

type PlanState =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "read"; result: DataSecurityTelemetryFixPlanResult };

const CODE_CLASS_NAME: string =
  "rounded bg-gray-100 px-1 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]";

// A file, a key or a template, as the code writes it.
const Code: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return (
    <code dir="ltr" className={CODE_CLASS_NAME}>
      {props.text}
    </code>
  );
};

// One place a leak is written, as its records name it.
const PlaceLine: FunctionComponent<{
  place: TelemetryLeakPlaceShown;
}> = (props: { place: TelemetryLeakPlaceShown }): ReactElement => {
  const translator: Translator = useTranslator();
  const place: TelemetryLeakPlaceShown = props.place;

  return (
    <li
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-gray-600"
      data-place-kind={place.kind}
    >
      {place.kind === TelemetryLeakPlaceKind.File ? (
        <>
          <Code text={place.name} />
          {place.functionName ? (
            <span dir="ltr" className="font-mono text-gray-600">
              {place.functionName}
            </span>
          ) : (
            <></>
          )}
        </>
      ) : (
        <span>
          <TranslatedSentence
            template={TELEMETRY_LEAK_PLACE_WORDS[place.kind]}
            slots={{ name: <Code text={place.name} /> }}
          />
        </span>
      )}
      {place.page ? (
        <span
          className="text-gray-500"
          data-testid={`${TELEMETRY_FIX_TEST_ID}-place-page`}
        >
          <TranslatedSentence
            template={PLACE_PAGE}
            slots={{ page: <Code text={place.page} /> }}
          />
        </span>
      ) : (
        <></>
      )}
      {place.recordCount > 0 ? (
        <span className="text-gray-500">
          {translator.translatePlural(PLACE_RECORDS, place.recordCount)}
        </span>
      ) : (
        <></>
      )}
    </li>
  );
};

// One leak: its data type and key, the signal it was seen in, and its places.
const LeakRow: FunctionComponent<{
  leak: TelemetryLeakFixLeak;
  showsHandling: boolean;
}> = (props: {
  leak: TelemetryLeakFixLeak;
  showsHandling: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const leak: TelemetryLeakFixLeak = props.leak;
  const places: { shown: Array<TelemetryLeakPlaceShown>; more: number } =
    getTelemetryLeakPlacesShown(leak);

  return (
    <li className="py-2.5" data-leak-signal={leak.signal}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm text-gray-900 [overflow-wrap:anywhere]">
          <TranslatedSentence
            template={LEAK_HEADING}
            slots={{
              dataType: (
                <span className="font-medium">
                  <IsolatedText text={leak.dataTypeName || leak.dataTypeId} />
                </span>
              ),
              location: <Code text={leak.key || leak.location} />,
            }}
          />
        </p>
        <Pill
          text={TELEMETRY_LEAK_SIGNAL_LABELS[leak.signal]}
          tone={PillTone.Neutral}
        />
      </div>
      {props.showsHandling ? (
        <p className="mt-0.5 text-xs text-gray-500">
          {translator.translateText(
            TELEMETRY_LEAK_HANDLING_WORDS[leak.handling],
          )}
        </p>
      ) : (
        <></>
      )}
      <ul className="mt-1.5 space-y-1">
        {places.shown.map(
          (place: TelemetryLeakPlaceShown, index: number): ReactElement => {
            return <PlaceLine key={`${place.kind}-${index}`} place={place} />;
          },
        )}
        {places.more > 0 ? (
          <li className="text-xs text-gray-500">
            {translator.translatePlural(MORE_PLACES, places.more)}
          </li>
        ) : (
          <></>
        )}
      </ul>
    </li>
  );
};

const TelemetryFixModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<PlanState>({ kind: "loading" });
  const [repositoryId, setRepositoryId] = useState<string>("");
  const [isFixing, setIsFixing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: DataSecurityTelemetryFixPlanResult =
          await DataSecurityApi.getIssueFixPlan(props.issueId);

        if (isCurrent) {
          setState({ kind: "read", result });
        }
      } catch (err) {
        if (isCurrent) {
          setState({ kind: "failed", error: API.getFriendlyMessage(err) });
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [props.issueId.toString()]);

  const result: DataSecurityTelemetryFixPlanResult | null =
    state.kind === "read" ? state.result : null;
  const plan: DataSecurityTelemetryFixPlanJSON | null = result?.plan || null;
  const repositories: Array<DataSecurityFixRepository> =
    plan && !plan.repository ? plan.repositories || [] : [];
  const picked: DataSecurityFixRepository | undefined = repositories.find(
    (repository: DataSecurityFixRepository): boolean => {
      return repository.id === repositoryId;
    },
  );
  const isOnItsWay: boolean = isTelemetryFixOnItsWay(plan?.existing);
  const canPress: boolean =
    Boolean(plan) &&
    !isOnItsWay &&
    (Boolean(plan?.repository) || Boolean(picked));
  const strategy: TelemetryFixStrategyWords | null = plan
    ? getTelemetryFixStrategyWords(plan)
    : null;
  // A RUM application's plan, in its front-end code (#10933).
  const isApplication: boolean = isApplicationTelemetryFix(plan);

  const say: (message: string) => string = (message: string): string => {
    return translator.translateText(message) || message;
  };

  const fix: () => Promise<void> = async (): Promise<void> => {
    if (!plan || !canPress) {
      return;
    }

    setIsFixing(true);
    setError("");

    try {
      const answer: DataSecurityFixResult =
        await DataSecurityApi.fixIssueWithAi(
          props.issueId,
          picked ? new ObjectID(picked.id) : undefined,
          plan.fingerprint,
        );

      if (answer.aiRunId) {
        setIsFixing(false);
        props.onStarted(answer);
        return;
      }

      // What it would change changed since it was shown: show it again.
      if (answer.plan) {
        setState({ kind: "read", result: { plan: answer.plan } });
      }

      setError(say(answer.message));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsFixing(false);
  };

  const repositoryOption: (
    repository: DataSecurityFixRepository,
  ) => DropdownOption = (
    repository: DataSecurityFixRepository,
  ): DropdownOption => {
    return {
      value: repository.id,
      label: repository.name || repository.id,
      isUserContent: true,
    };
  };

  return (
    <Modal
      title={TELEMETRY_FIX_TITLE}
      description={
        plan ? (
          isApplication ? (
            <TranslatedSentence
              template={TELEMETRY_FIX_DESCRIPTION_APPLICATION}
              slots={{
                application: (
                  <span className="font-medium">
                    <IsolatedText text={plan.serviceName} />
                  </span>
                ),
              }}
            />
          ) : (
            <TranslatedSentence
              template={TELEMETRY_FIX_DESCRIPTION}
              slots={{
                service: (
                  <span className="font-medium">
                    <IsolatedText text={plan.serviceName} />
                  </span>
                ),
              }}
            />
          )
        ) : undefined
      }
      submitButtonText={TELEMETRY_FIX_SUBMIT}
      onSubmit={() => {
        void fix();
      }}
      onClose={props.onClose}
      isLoading={isFixing}
      disableSubmitButton={!canPress}
      error={error || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-5" data-testid={TELEMETRY_FIX_TEST_ID}>
        {state.kind === "loading" ? <DetailListSkeleton /> : <></>}

        {state.kind === "failed" ? (
          <p className="text-sm text-red-700">
            {translator.translateText(TELEMETRY_FIX_NOT_LOADED)} {state.error}
          </p>
        ) : (
          <></>
        )}

        {result && !plan ? (
          <p
            className="text-sm text-gray-600"
            data-testid={`${TELEMETRY_FIX_TEST_ID}-nothing`}
          >
            {say(result.message || "")}
          </p>
        ) : (
          <></>
        )}

        {plan && strategy ? (
          <section
            className="space-y-2"
            data-testid={`${TELEMETRY_FIX_TEST_ID}-strategy`}
            data-strategy={plan.strategy}
          >
            {plan.issues.length > 1 ? (
              <p className="text-sm text-gray-700">
                {translator.translatePlural(
                  isApplication
                    ? TELEMETRY_FIX_ISSUES_OF_APPLICATION
                    : TELEMETRY_FIX_ISSUES,
                  plan.issues.length,
                )}
              </p>
            ) : (
              <></>
            )}
            <p className="flex items-start gap-2 text-sm text-gray-700">
              <Icon
                icon={IconProp.Code}
                className="mt-0.5 h-4 w-4 flex-none text-gray-400"
              />
              <span>
                {typeof strategy.sentence === "string"
                  ? translator.translateText(strategy.sentence)
                  : translator.translatePlural(
                      strategy.sentence,
                      strategy.count || 0,
                    )}{" "}
                {strategy.why
                  ? typeof strategy.why.sentence === "string"
                    ? translator.translateText(strategy.why.sentence)
                    : translator.translatePlural(
                        strategy.why.sentence,
                        strategy.why.count || 0,
                      )
                  : ""}
              </span>
            </p>
            {plan.strategy !== TelemetryLeakFixStrategy.CallSites &&
            plan.redactionKeys.length > 0 ? (
              <div className="ps-6">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText(REDACTION_KEYS_LABEL)}
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {plan.redactionKeys.map((key: string): ReactElement => {
                    return (
                      <li key={key}>
                        <Code text={key} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <></>
            )}
          </section>
        ) : (
          <></>
        )}

        {plan ? (
          <section
            className="border-t border-gray-200 pt-4"
            data-testid={`${TELEMETRY_FIX_TEST_ID}-leaks`}
          >
            <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
              <span>{translator.translateText(LEAKS_TITLE)}</span>
            </h4>
            <ul className="mt-1 divide-y divide-gray-100">
              {plan.leaks.map(
                (leak: TelemetryLeakFixLeak, index: number): ReactElement => {
                  return (
                    <LeakRow
                      key={`${leak.issueId}-${leak.location}-${index}`}
                      leak={leak}
                      showsHandling={
                        plan.strategy ===
                        TelemetryLeakFixStrategy.CallSitesAndRedactionStep
                      }
                    />
                  );
                },
              )}
            </ul>
          </section>
        ) : (
          <></>
        )}

        {plan ? (
          <section
            className="space-y-2 border-t border-gray-200 pt-4"
            data-testid={`${TELEMETRY_FIX_TEST_ID}-repository`}
          >
            {plan.repository ? (
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <Icon
                  icon={IconProp.Folder}
                  className="mt-0.5 h-4 w-4 flex-none text-gray-400"
                />
                <div>
                  <p className="[overflow-wrap:anywhere]">
                    <TranslatedSentence
                      template={
                        plan.folder
                          ? isApplication
                            ? REPOSITORY_LINE_IN_FOLDER_APPLICATION
                            : REPOSITORY_LINE_IN_FOLDER
                          : REPOSITORY_LINE
                      }
                      slots={{
                        repository: (
                          <span className="font-medium">
                            <IsolatedText text={plan.repository.name} />
                          </span>
                        ),
                        ...(plan.folder
                          ? { folder: <Code text={plan.folder} /> }
                          : {}),
                      }}
                    />
                  </p>
                  {getRepositoryChoiceWords(plan, plan.repository.choice) ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {translator.translateText(
                        getRepositoryChoiceWords(plan, plan.repository.choice),
                      )}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            ) : repositories.length > 0 ? (
              <div>
                <label
                  className="block text-xs font-medium text-gray-700"
                  htmlFor={`${TELEMETRY_FIX_TEST_ID}-repository-pick`}
                >
                  {translator.translateText(PICK_REPOSITORY_LABEL)}
                </label>
                <div className="mt-1">
                  <Dropdown
                    inputId={`${TELEMETRY_FIX_TEST_ID}-repository-pick`}
                    dataTestId={`${TELEMETRY_FIX_TEST_ID}-repository-pick`}
                    placeholder={PICK_REPOSITORY_PLACEHOLDER}
                    options={repositories.map(repositoryOption)}
                    value={picked ? repositoryOption(picked) : undefined}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      setRepositoryId(
                        typeof value === "string" ? value : String(value || ""),
                      );
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {translator.translateText(
                    isApplication
                      ? PICK_REPOSITORY_HINT_APPLICATION
                      : PICK_REPOSITORY_HINT,
                  )}
                </p>
              </div>
            ) : (
              <p className="flex items-start gap-2 text-sm text-gray-600">
                <Icon
                  icon={IconProp.Folder}
                  className="mt-0.5 h-4 w-4 flex-none text-gray-400"
                />
                <span>
                  {say(
                    isApplication
                      ? NO_REPOSITORY_TO_PICK_APPLICATION
                      : NO_REPOSITORY_TO_PICK,
                  )}
                </span>
              </p>
            )}
            {plan.startFiles.length > 0 ? (
              <p
                className="text-xs text-gray-500 [overflow-wrap:anywhere]"
                data-testid={`${TELEMETRY_FIX_TEST_ID}-start-files`}
              >
                <TranslatedSentence
                  template={START_FILES}
                  slots={{
                    files: (
                      <span dir="ltr" className="font-mono">
                        {formatList(plan.startFiles, translator)}
                      </span>
                    ),
                  }}
                />
              </p>
            ) : (
              <></>
            )}
          </section>
        ) : (
          <></>
        )}

        {plan?.hasSecrets ? (
          <p
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid={`${TELEMETRY_FIX_TEST_ID}-rotate`}
          >
            <Icon icon={IconProp.Key} className="mt-0.5 h-4 w-4 flex-none" />
            <span>{translator.translateText(ROTATE_SECRET)}</span>
          </p>
        ) : (
          <></>
        )}

        {plan?.existing && isOnItsWay ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700"
            data-testid={`${TELEMETRY_FIX_TEST_ID}-on-its-way`}
          >
            <span>{translator.translateText(FIX_ON_ITS_WAY)}</span>
            {plan.existing.taskId ? (
              <AppLink
                className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE_TASK_VIEW] as Route,
                  { modelId: new ObjectID(plan.existing.taskId) },
                )}
              >
                <span>{translator.translateText(DECLARED_CODE_VIEW_TASK)}</span>
              </AppLink>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default TelemetryFixModal;
