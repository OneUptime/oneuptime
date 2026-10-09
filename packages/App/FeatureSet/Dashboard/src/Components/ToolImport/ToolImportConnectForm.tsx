import { startToolImportRead, toolImportDocsUrl } from "./ToolImportApi";
import ToolImportLogo from "./ToolImportLogo";
import { TOOL_IMPORT_BUTTON_ROW_CLASS_NAME } from "./ToolImportPlanView";
import {
  TOOL_IMPORT_TOOL_COPY,
  ToolImportRegionCopy,
  ToolImportToolCopy,
} from "./ToolImportText";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import {
  getToolImportSourceDefinition,
  ToolImportRegion,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FormEvent,
  FunctionComponent,
  ReactElement,
  useId,
  useState,
} from "react";

/*
 * Step two: connect the tool. How to make an API key in it (in its own
 * words for its screens, with a link to its page on keys), the region for a
 * tool that has them - picked, never typed, so the import can only call the
 * tool's own hosts - and the key itself.
 *
 * The key goes to the server once, with the read, and is never shown again:
 * the field is a password field password managers leave alone, and it is
 * emptied as soon as the read is under way.
 */

export interface ComponentProps {
  source: ToolImportSource;
  // The region picked last time, when trying the tool again.
  initialRegion?: string | undefined;
  // Shown instead of the start button's action when a read cannot start.
  blockedReason?: string | undefined;
  onBack: () => void;
  onStarted: (runId: string) => void;
}

const ToolImportConnectForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: ToolImportSourceDefinition = getToolImportSourceDefinition(
    props.source,
  );
  const copy: ToolImportToolCopy = TOOL_IMPORT_TOOL_COPY[props.source];
  const keyInputId: string = useId();
  const regionGroupId: string = useId();

  const [region, setRegion] = useState<string>((): string => {
    const isOneOfTheTools: boolean = definition.regions.some(
      (option: ToolImportRegion): boolean => {
        return option.value === props.initialRegion;
      },
    );

    return isOneOfTheTools && props.initialRegion
      ? props.initialRegion
      : definition.regions[0]?.value || "";
  });
  const [apiKey, setApiKey] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isStarting, setIsStarting] = useState<boolean>(false);

  const toolValues: { tool: string } = { tool: definition.title };

  const start: () => Promise<void> = async (): Promise<void> => {
    if (isStarting || props.blockedReason) {
      return;
    }

    if (!apiKey.trim()) {
      setError(
        translator.translateTemplate(
          "Paste your {{tool}} API key.",
          toolValues,
        ),
      );
      return;
    }

    setError("");
    setIsStarting(true);

    try {
      const runId: string = await startToolImportRead({
        source: props.source,
        region: region,
        apiKey: apiKey.trim(),
      });

      setApiKey("");
      props.onStarted(runId);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <form
      data-testid="tool-import-connect"
      noValidate={true}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void start();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ToolImportLogo source={props.source} size="lg" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900">
              {translator.translateTemplate("Connect {{tool}}", toolValues)}
            </p>
            <p className="text-sm text-gray-500">
              {translator.translateText(copy.description)}
            </p>
          </div>
        </div>
        <Button
          title="Choose another tool"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          icon={IconProp.ChevronLeft}
          onClick={props.onBack}
          dataTestId="tool-import-back"
        />
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-gray-900">
          {translator.translateTemplate(
            "Create a read-only API key in {{tool}}",
            toolValues,
          )}
        </p>
        <ol className="mt-3 space-y-3" data-testid="tool-import-key-steps">
          {copy.keySteps.map((step: string, index: number): ReactElement => {
            return (
              <li key={step} className="flex items-start gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                  {translator.formatNumber(index + 1)}
                </span>
                <span className="pt-0.5 text-sm text-gray-700">
                  {translator.translateText(step)}
                </span>
              </li>
            );
          })}
        </ol>
        <Link
          to={URL.fromString(definition.apiKeyDocsUrl)}
          openInNewTab={true}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          {translator.translateTemplate(
            "{{tool}}'s guide to API keys",
            toolValues,
          )}
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
        </Link>
      </div>

      {definition.regions.length > 0 && (
        <fieldset className="mt-6" aria-labelledby={regionGroupId}>
          <legend
            id={regionGroupId}
            className="text-sm font-medium text-gray-900"
          >
            {translator.translateText(
              copy.regionQuestion || "Where is your account?",
            )}
          </legend>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {definition.regions.map(
              (option: ToolImportRegion): ReactElement => {
                const regionCopy: ToolImportRegionCopy | undefined =
                  copy.regions?.[option.value];
                const isChecked: boolean = region === option.value;

                return (
                  <label
                    key={option.value}
                    data-testid={`tool-import-region-${option.value}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                      isChecked
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${regionGroupId}-region`}
                      value={option.value}
                      checked={isChecked}
                      onChange={() => {
                        setRegion(option.value);
                      }}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">
                        {regionCopy
                          ? translator.translateText(regionCopy.title)
                          : option.title}
                      </span>
                      {regionCopy && (
                        <span className="mt-0.5 block text-sm text-gray-500">
                          {translator.translateText(regionCopy.description)}
                        </span>
                      )}
                    </span>
                  </label>
                );
              },
            )}
          </div>
        </fieldset>
      )}

      <div className="mt-6">
        <label
          htmlFor={keyInputId}
          className="block text-sm font-medium text-gray-900"
        >
          {translator.translateText(copy.keyLabel)}
        </label>
        <div className="mt-2 max-w-xl">
          <Input
            id={keyInputId}
            type={InputType.PASSWORD}
            value={apiKey}
            placeholder="Paste the key here"
            disableSpellCheck={true}
            dataTestId="tool-import-api-key"
            onChange={(value: string) => {
              setApiKey(value);
              if (error) {
                setError("");
              }
            }}
            {...(error ? { error: error } : {})}
          />
        </div>
        <div
          className="mt-2 flex items-start gap-2 text-sm text-gray-500"
          data-testid="tool-import-key-privacy"
        >
          <div className="mt-0.5 flex-shrink-0">
            <Icon icon={IconProp.Lock} className="h-4 w-4" />
          </div>
          <p>
            {translator.translateTemplate(
              "The key is used once, to read your {{tool}} account. It is kept encrypted while the read runs, deleted as soon as it ends, and never shown again.",
              toolValues,
            )}
          </p>
        </div>
      </div>

      <div className={`mt-6 ${TOOL_IMPORT_BUTTON_ROW_CLASS_NAME}`}>
        <Button
          title={translator.translateTemplate(
            "Read my {{tool}} account",
            toolValues,
          )}
          type={ButtonType.Submit}
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={IconProp.InboxArrowDown}
          isLoading={isStarting}
          disabled={Boolean(props.blockedReason)}
          tooltip={props.blockedReason}
          dataTestId="tool-import-read"
        />
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "Nothing is brought over yet. You see what was found first, and choose what to bring over.",
          )}
        </p>
      </div>

      {props.blockedReason && (
        <p
          className="mt-3 text-sm text-gray-700"
          data-testid="tool-import-blocked"
        >
          {props.blockedReason}
        </p>
      )}

      <div className="mt-6 text-sm">
        <Link
          to={toolImportDocsUrl(definition.docsPath)}
          openInNewTab={true}
          className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-indigo-600"
        >
          {translator.translateTemplate(
            "Read the guide to moving from {{tool}}",
            toolValues,
          )}
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
        </Link>
      </div>
    </form>
  );
};

export default ToolImportConnectForm;
