import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import DataSecurityApi from "../../../Components/DataSecurity/DataSecurityApi";
import { getIssueViewRoute } from "../../../Components/DataSecurity/IssueListRoute";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  DATA_SECURITY_AI_FEATURES,
  DATA_SECURITY_AI_LOGS_KEEP,
  DATA_SECURITY_AI_LOGS_KEEP_PROVIDER_ERRORS,
  DataSecurityAiFeatureInfo,
  DataSecurityAiModelSource,
  NEVER_SENT_TO_ONEUPTIME_AI,
} from "Common/Types/DataSecurity/DataSecurityAiFeatures";
import {
  DataSecurityAiExampleUnavailableReason,
  DataSecurityAiInputExample,
  DataSecurityAiInputResponse,
  DataSecurityAiModelSummary,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import {
  getInlineSeparator,
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Data Security > Settings > OneUptime AI: what OneUptime AI sees (#10365).
 *
 * A data security product that sends its findings to a model has made a
 * new copy of what it protects, so this page says exactly what is sent,
 * for a security reviewer to read:
 *
 *   - What OneUptime AI Sees: what no feature ever sends, then each feature
 *     (the catalog, Common/Types/DataSecurity/DataSecurityAiFeatures) - what
 *     it sends and never sends, what starts it and whether it runs on its
 *     own, the model it runs on, and what is kept of it. The model is the
 *     server's to say (DataSecurityAiSettings), and named only to who may
 *     read the project's LLM providers. Its buttons open the AI switches
 *     and the LLM providers, in Project Settings > AI;
 *   - Show an Example: the exact input Explain with AI would send for the
 *     project's riskiest open issue, built as Explain builds it
 *     (DataSecurityAiInput), with what Fix with AI would ask - read only
 *     when the reader asks for it, and only an issue they may read.
 *
 * With Enable AI off nothing is sent at all; the page says so, and still
 * says what each feature would send.
 */

export const AI_SETTINGS_FEATURES_TEST_ID: string =
  "data-security-ai-settings-features";
export const AI_SETTINGS_EXAMPLE_TEST_ID: string =
  "data-security-ai-settings-example";

const SEES_TITLE: string = translationKey("What OneUptime AI Sees");
const SEES_DESCRIPTION: string = translationKey(
  "What each OneUptime AI feature in Data Security sends a model, and what it never sends.",
);
const AI_OFF: string = translationKey(
  "Enable AI is off for this project, so OneUptime AI sends nothing. This is what each feature sends once it is on.",
);
const NEVER_SENT_HEADING: string = translationKey("Never sent, by any feature");
const SENDS: string = translationKey("Sends");
const NEVER_SENDS: string = translationKey("Never sends");
const STARTED_BY: string = translationKey("Started by");
const RUNS_ON: string = translationKey("Runs on");
const KEEPS: string = translationKey("Keeps");
const RUNS_ON_ITS_OWN: string = translationKey("Runs on its own");
const ONLY_WHEN_ASKED: string = translationKey("Only when a person asks");
const AI_SWITCHES: string = translationKey("AI Switches");
const LLM_PROVIDERS: string = translationKey("LLM Providers");

// Which provider a feature's calls go to, before its name is known.
const MODEL_SOURCE: Record<DataSecurityAiModelSource, string> = {
  [DataSecurityAiModelSource.ProjectProvider]: translationKey(
    "The LLM provider an AI rule picks, else your project's default one.",
  ),
  [DataSecurityAiModelSource.CodeAgent]: translationKey(
    "The LLM provider an AI rule picks, else one of your project's own, else this server's.",
  ),
  [DataSecurityAiModelSource.Chat]: translationKey(
    "The LLM provider picked in Ask AI, else your project's default one.",
  ),
};

const MODEL_NOT_READABLE: string = translationKey(
  "Who may read this project's LLM providers sees which one it is.",
);
const NO_MODEL: string = translationKey(
  "No LLM provider is set up yet, so nothing can be sent.",
);
const PROJECT_PROVIDER: string = translationKey("Your project's");
const SERVER_PROVIDER: string = translationKey("This server's");
const SELF_HOSTED: string = translationKey("Self-hosted");

const EXAMPLE_TITLE: string = translationKey("Show an Example");
const EXAMPLE_DESCRIPTION: string = translationKey(
  "The exact input Explain with AI would send for your riskiest open issue, and what Fix with AI would ask.",
);
const EXAMPLE_BUTTON: string = translationKey("Show an Example");
const EXAMPLE_FOR: string = translationKey("For the issue");
const EXAMPLE_SYSTEM: string = translationKey("The system message");
const EXAMPLE_SYSTEM_HELP: string = translationKey(
  "Every instruction OneUptime AI is given, in OneUptime's own words.",
);
const EXAMPLE_DATA: string = translationKey("The data");
const EXAMPLE_DATA_HELP: string = translationKey(
  "Everything your clouds, code and telemetry named, sent as data and never as instructions.",
);
const EXAMPLE_FIX: string = translationKey("What Fix with AI asks");
const EXAMPLE_AI_CONTEXT: PluralTemplate = {
  one: "Your project's AI context comes first in the system message: {{count}} character, set under Project Settings → AI → AI Features.",
  other:
    "Your project's AI context comes first in the system message: {{count}} characters, set under Project Settings → AI → AI Features.",
};
const EXAMPLE_NO_ISSUE: string = translationKey(
  "No open issue to show an example for yet. One shows here once a check finds an issue.",
);
const EXAMPLE_NO_PERMISSION: string = translationKey(
  "Seeing an example takes permission to read this project's Data Security issues.",
);
const EXAMPLE_FAILED: string = translationKey("The example was not loaded.");
const MODELS_FAILED: string = translationKey(
  "Which model each feature runs on was not loaded.",
);

function routeOf(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

// The model a feature's calls run on, as the server named it.
function modelOf(
  answer: DataSecurityAiInputResponse,
  source: DataSecurityAiModelSource,
): DataSecurityAiModelSummary | null {
  return source === DataSecurityAiModelSource.CodeAgent
    ? answer.codeAgentModel
    : answer.projectModel;
}

const BulletList: FunctionComponent<{
  items: ReadonlyArray<string>;
  translator: Translator;
}> = (props: {
  items: ReadonlyArray<string>;
  translator: Translator;
}): ReactElement => {
  return (
    <ul className="list-disc space-y-1 ps-5 text-sm text-gray-700">
      {props.items.map((item: string): ReactElement => {
        return <li key={item}>{props.translator.translateText(item)}</li>;
      })}
    </ul>
  );
};

// One fact of a feature: its label, then what it is.
const FeatureFact: FunctionComponent<{
  label: string;
  children: ReactElement | Array<ReactElement>;
}> = (props: {
  label: string;
  children: ReactElement | Array<ReactElement>;
}): ReactElement => {
  return (
    <div className="py-2 sm:grid sm:grid-cols-4 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{props.label}</dt>
      <dd className="mt-1 text-sm text-gray-700 sm:col-span-3 sm:mt-0">
        {props.children}
      </dd>
    </div>
  );
};

const ModelLine: FunctionComponent<{
  info: DataSecurityAiFeatureInfo;
  answer: DataSecurityAiInputResponse | null;
  isFailed: boolean;
  translator: Translator;
}> = (props: {
  info: DataSecurityAiFeatureInfo;
  answer: DataSecurityAiInputResponse | null;
  isFailed: boolean;
  translator: Translator;
}): ReactElement => {
  const translator: Translator = props.translator;
  const source: string =
    translator.translateText(MODEL_SOURCE[props.info.modelSource]) || "";

  if (!props.answer) {
    return (
      <div className="space-y-1">
        <p>{source}</p>
        {props.isFailed ? <></> : <InlineValueSkeleton widthClassName="w-40" />}
      </div>
    );
  }

  if (!props.answer.canReadModels) {
    return (
      <div className="space-y-1">
        <p>{source}</p>
        <p className="text-gray-500">
          {translator.translateText(MODEL_NOT_READABLE)}
        </p>
      </div>
    );
  }

  const model: DataSecurityAiModelSummary | null = modelOf(
    props.answer,
    props.info.modelSource,
  );

  if (!model) {
    return (
      <div className="space-y-1">
        <p>{source}</p>
        <p className="text-gray-500">{translator.translateText(NO_MODEL)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p>{source}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">
          {model.modelName
            ? [model.name, model.modelName].join(
                getInlineSeparator(translator.language),
              )
            : model.name}
        </span>
        <Pill
          text={model.isProjectProvider ? PROJECT_PROVIDER : SERVER_PROVIDER}
          tone={PillTone.Neutral}
          isDotHidden={true}
        />
        {model.isSelfHosted ? (
          <Pill text={SELF_HOSTED} tone={PillTone.Success} isDotHidden={true} />
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

const FeatureSection: FunctionComponent<{
  info: DataSecurityAiFeatureInfo;
  answer: DataSecurityAiInputResponse | null;
  isFailed: boolean;
  translator: Translator;
}> = (props: {
  info: DataSecurityAiFeatureInfo;
  answer: DataSecurityAiInputResponse | null;
  isFailed: boolean;
  translator: Translator;
}): ReactElement => {
  const translator: Translator = props.translator;
  const info: DataSecurityAiFeatureInfo = props.info;

  return (
    <section
      className="border-t border-gray-200 pt-4"
      data-testid={`data-security-ai-feature-${info.feature}`}
    >
      <h3 className="text-base font-semibold text-gray-900">
        {translator.translateText(info.title)}
      </h3>
      <dl className="mt-2 divide-y divide-gray-100">
        <FeatureFact label={translator.translateText(SENDS) || ""}>
          <BulletList items={info.sends} translator={translator} />
        </FeatureFact>
        <FeatureFact label={translator.translateText(NEVER_SENDS) || ""}>
          <BulletList items={info.neverSends} translator={translator} />
        </FeatureFact>
        <FeatureFact label={translator.translateText(STARTED_BY) || ""}>
          <div className="flex flex-wrap items-center gap-2">
            <span>{translator.translateText(info.startedBy)}</span>
            <Pill
              text={info.runsOnItsOwn ? RUNS_ON_ITS_OWN : ONLY_WHEN_ASKED}
              tone={info.runsOnItsOwn ? PillTone.Info : PillTone.Neutral}
              isDotHidden={true}
            />
          </div>
        </FeatureFact>
        <FeatureFact label={translator.translateText(RUNS_ON) || ""}>
          <ModelLine
            info={info}
            answer={props.answer}
            isFailed={props.isFailed}
            translator={translator}
          />
        </FeatureFact>
        <FeatureFact label={translator.translateText(KEEPS) || ""}>
          <div className="space-y-1">
            <p>{translator.translateText(info.keeps)}</p>
            <p>{translator.translateText(DATA_SECURITY_AI_LOGS_KEEP)}</p>
            {info.keepsProviderErrors ? (
              <p className="text-gray-500">
                {translator.translateText(
                  DATA_SECURITY_AI_LOGS_KEEP_PROVIDER_ERRORS,
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
        </FeatureFact>
      </dl>
    </section>
  );
};

const ExampleBody: FunctionComponent<{
  example: DataSecurityAiInputExample;
  translator: Translator;
}> = (props: {
  example: DataSecurityAiInputExample;
  translator: Translator;
}): ReactElement => {
  const translator: Translator = props.translator;
  const example: DataSecurityAiInputExample = props.example;

  return (
    <div className="space-y-5" data-testid={AI_SETTINGS_EXAMPLE_TEST_ID}>
      <div>
        <h3 className="text-sm font-medium text-gray-500">
          {translator.translateText(EXAMPLE_FOR)}
        </h3>
        <AppLink
          to={getIssueViewRoute(example.dataSecurityIssueId)}
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          {example.issueTitle}
        </AppLink>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText(EXAMPLE_SYSTEM)}
        </h3>
        <p className="text-sm text-gray-600">
          {translator.translateText(EXAMPLE_SYSTEM_HELP)}
        </p>
        {example.aiContextCharacterCount > 0 ? (
          <p className="text-sm text-gray-600">
            {translator.translatePlural(
              EXAMPLE_AI_CONTEXT,
              example.aiContextCharacterCount,
            )}
          </p>
        ) : (
          <></>
        )}
        <CodeBlock
          code={example.system}
          language="plaintext"
          wrapLongLines={true}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText(EXAMPLE_DATA)}
        </h3>
        <p className="text-sm text-gray-600">
          {translator.translateText(EXAMPLE_DATA_HELP)}
        </p>
        <CodeBlock
          code={JSON.stringify(example.data, null, 2)}
          language="json"
          wrapLongLines={true}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText(EXAMPLE_FIX)}
        </h3>
        <CodeBlock
          code={example.fixRequest}
          language="markdown"
          wrapLongLines={true}
        />
      </div>
    </div>
  );
};

const ExampleCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [isAsked, setIsAsked] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [answer, setAnswer] = useState<DataSecurityAiInputResponse | null>(
    null,
  );
  const [error, setError] = useState<string>("");

  const load: () => void = (): void => {
    setIsAsked(true);
    setIsLoading(true);
    setError("");

    DataSecurityApi.getAiInput({ withExample: true })
      .then((response: DataSecurityAiInputResponse) => {
        setAnswer(response);
      })
      .catch((err: unknown) => {
        setError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const body: () => ReactElement = (): ReactElement => {
    if (!isAsked) {
      return <></>;
    }

    if (isLoading) {
      return <DetailListSkeleton fields={3} />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          whatFailed={translator.translateText(EXAMPLE_FAILED)}
          onRefreshClick={load}
        />
      );
    }

    if (answer?.example) {
      return <ExampleBody example={answer.example} translator={translator} />;
    }

    return (
      <p className="text-sm text-gray-600">
        {translator.translateText(
          answer?.exampleUnavailableReason ===
            DataSecurityAiExampleUnavailableReason.NoPermission
            ? EXAMPLE_NO_PERMISSION
            : EXAMPLE_NO_ISSUE,
        )}
      </p>
    );
  };

  return (
    <Card
      title={EXAMPLE_TITLE}
      description={EXAMPLE_DESCRIPTION}
      buttons={
        isAsked
          ? []
          : [
              {
                title: EXAMPLE_BUTTON,
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Eye,
                onClick: load,
              },
            ]
      }
    >
      {body()}
    </Card>
  );
};

const DataSecurityAiSettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<DataSecurityAiInputResponse | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    DataSecurityApi.getAiInput()
      .then((response: DataSecurityAiInputResponse) => {
        if (isCurrent) {
          setAnswer(response);
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
  }, [readCount]);

  return (
    <>
      <Card
        title={SEES_TITLE}
        description={SEES_DESCRIPTION}
        buttons={[
          {
            title: AI_SWITCHES,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Settings,
            onClick: () => {
              Navigation.navigate(routeOf(PageMap.SETTINGS_AI_FEATURES));
            },
          },
          {
            title: LLM_PROVIDERS,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Brain,
            onClick: () => {
              Navigation.navigate(routeOf(PageMap.SETTINGS_AI_LLM_PROVIDERS));
            },
          },
        ]}
      >
        <div className="space-y-4" data-testid={AI_SETTINGS_FEATURES_TEST_ID}>
          {error ? (
            <ErrorMessage
              message={error}
              whatFailed={translator.translateText(MODELS_FAILED)}
              onRefreshClick={() => {
                setReadCount((count: number): number => {
                  return count + 1;
                });
              }}
            />
          ) : (
            <></>
          )}

          {answer && !answer.isAiEnabled ? (
            <p className="text-sm text-gray-700">
              {translator.translateText(AI_OFF)}
            </p>
          ) : (
            <></>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText(NEVER_SENT_HEADING)}
            </h3>
            <div className="mt-2">
              <BulletList
                items={NEVER_SENT_TO_ONEUPTIME_AI}
                translator={translator}
              />
            </div>
          </div>

          {DATA_SECURITY_AI_FEATURES.map(
            (info: DataSecurityAiFeatureInfo): ReactElement => {
              return (
                <FeatureSection
                  key={info.feature}
                  info={info}
                  answer={answer}
                  isFailed={Boolean(error)}
                  translator={translator}
                />
              );
            },
          )}
        </div>
      </Card>

      <ExampleCard />
    </>
  );
};

export default DataSecurityAiSettingsPage;
