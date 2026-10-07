import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import FilterQueryBuilderField from "../FilterQueryBuilder/FilterQueryBuilderField";
import LogFilterConfig from "../FilterQueryBuilder/LogFilterConfig";
import SeverityMappingRow, { SeverityMapping } from "./SeverityMappingRow";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import {
  CompiledGrokPattern,
  GrokValue,
  compileGrokPattern,
  matchGrokPattern,
} from "Common/Utils/Grok/Grok";
import { getGrokPatternNames } from "Common/Utils/Grok/GrokPatterns";
import {
  DEFAULT_KEY_VALUE_DELIMITER,
  KeyValueParserOptions,
  ResolvedKeyValueParserOptions,
  parseKeyValuePairs,
  resolveKeyValueParserOptions,
} from "Common/Utils/Log/KeyValueParser";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  pipelineId: ObjectID;
  onProcessorCreated: () => void;
  onCancel: () => void;
}

type ProcessorType =
  | "GrokParser"
  | "KeyValueParser"
  | "SeverityRemapper"
  | "AttributeRemapper"
  | "CategoryProcessor"
  | "";

const processorTypeOptions: Array<DropdownOption> = [
  {
    value: "GrokParser",
    label: "Grok Parser",
    description:
      "Pulls structured fields out of an unstructured log line (e.g. an nginx access line) and stores them as log attributes",
  },
  {
    value: "KeyValueParser",
    label: "Key=Value Parser",
    description:
      "Splits key=value lines (e.g. Sophos XGS, Fortinet or logfmt) into log attributes, whatever order the fields arrive in",
  },
  {
    value: "SeverityRemapper",
    label: "Severity Remapper",
    description:
      "Reads a raw value (e.g. 'warn') from a log attribute and maps it to a standard severity level (e.g. WARNING)",
  },
  {
    value: "AttributeRemapper",
    label: "Attribute Remapper",
    description:
      "Renames or copies a log attribute key to a new key (e.g. rename 'src_ip' to 'source_ip')",
  },
  {
    value: "CategoryProcessor",
    label: "Category Processor",
    description:
      "Tags logs with a category name based on filter rules. Stored in log attributes for easy searching.",
  },
];

interface CategoryRule {
  name: string;
  filterQuery: string;
}

interface GrokTestResult {
  /** The pattern compiles, but there is no sample line to run it on yet. */
  compiledOnly?: boolean;
  error?: string;
  matched?: boolean;
  fields?: Record<string, GrokValue>;
}

interface KeyValueTestResult {
  // The delimiters do not validate.
  error?: string;
  // The pairs the sample line holds - empty when it holds none.
  fields?: Record<string, string>;
}

/*
 * A prefix names a namespace, so the separator is implied unless the
 * user typed one. Mirrors LogPipelineService.normalizeTargetPrefix -
 * this is only used to render the preview of the resulting keys.
 */
function previewAttributeKey(targetPrefix: string, fieldName: string): string {
  const prefix: string = targetPrefix.trim();

  if (!prefix) {
    return fieldName;
  }

  if (
    prefix.endsWith(".") ||
    prefix.endsWith("_") ||
    prefix.endsWith("-") ||
    prefix.endsWith(":")
  ) {
    return `${prefix}${fieldName}`;
  }

  return `${prefix}.${fieldName}`;
}

const ProcessorForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Common fields
  const [name, setName] = useState<string>("");
  const [processorType, setProcessorType] = useState<ProcessorType>("");
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  // Grok Parser fields
  const [grokSource, setGrokSource] = useState<string>("body");
  const [grokPattern, setGrokPattern] = useState<string>("");
  const [grokTargetPrefix, setGrokTargetPrefix] = useState<string>("");
  const [grokSample, setGrokSample] = useState<string>("");
  const [showGrokPatternList, setShowGrokPatternList] =
    useState<boolean>(false);

  /*
   * Key=Value Parser fields. A blank pair delimiter means "any
   * whitespace", which is what Sophos, Fortinet and logfmt use, so it is
   * left out of the saved configuration rather than saved as "".
   */
  const [keyValueSource, setKeyValueSource] = useState<string>("body");
  const [keyValueTargetPrefix, setKeyValueTargetPrefix] = useState<string>("");
  const [keyValuePairDelimiter, setKeyValuePairDelimiter] =
    useState<string>("");
  const [keyValueDelimiter, setKeyValueDelimiter] = useState<string>(
    DEFAULT_KEY_VALUE_DELIMITER,
  );
  const [keyValueOverrideOnConflict, setKeyValueOverrideOnConflict] =
    useState<boolean>(false);
  const [keyValueSample, setKeyValueSample] = useState<string>("");

  // Severity Remapper fields
  const [severitySourceKey, setSeveritySourceKey] = useState<string>("level");
  const [severityMappings, setSeverityMappings] = useState<
    Array<SeverityMapping>
  >([{ matchValue: "", severityText: "", severityNumber: 0 }]);

  // Attribute Remapper fields
  const [attrSourceKey, setAttrSourceKey] = useState<string>("");
  const [attrTargetKey, setAttrTargetKey] = useState<string>("");
  const [preserveSource, setPreserveSource] = useState<boolean>(false);
  const [overrideOnConflict, setOverrideOnConflict] = useState<boolean>(true);

  // Category Processor fields
  const [categoryTargetKey, setCategoryTargetKey] =
    useState<string>("category");
  const [categories, setCategories] = useState<Array<CategoryRule>>([
    { name: "", filterQuery: "" },
  ]);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * Live pattern tester. The same compiler the ingest pipeline uses runs
   * here on whatever sample line the user pastes, so "does my pattern
   * actually pull these fields out?" is answered before the processor is
   * saved rather than after logs have flowed past it.
   */
  const grokTestResult: GrokTestResult | null = useMemo(() => {
    if (processorType !== "GrokParser") {
      return null;
    }

    if (!grokPattern.trim()) {
      return null;
    }

    let compiled: CompiledGrokPattern;

    try {
      compiled = compileGrokPattern(grokPattern.trim());
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!grokSample) {
      return { compiledOnly: true };
    }

    const fields: Record<string, GrokValue> | null = matchGrokPattern(
      compiled,
      grokSample,
    );

    if (!fields) {
      return { matched: false };
    }

    return { matched: true, fields: fields };
  }, [processorType, grokPattern, grokSample]);

  /*
   * The delimiters as the processor will read them: blank means the
   * default (any whitespace between pairs, = between key and value).
   * Delimiters are not trimmed - " | " is a different delimiter from "|".
   */
  const getKeyValueParserOptions: () => KeyValueParserOptions =
    (): KeyValueParserOptions => {
      return {
        pairDelimiter: keyValuePairDelimiter || undefined,
        keyValueDelimiter: keyValueDelimiter || undefined,
      };
    };

  /*
   * Live tester for the key=value parser. It runs the parser ingest runs
   * (Common/Utils/Log/KeyValueParser), so what it shows is exactly what
   * the processor will add.
   */
  const keyValueTestResult: KeyValueTestResult | null = useMemo(() => {
    if (processorType !== "KeyValueParser") {
      return null;
    }

    let options: ResolvedKeyValueParserOptions;

    try {
      options = resolveKeyValueParserOptions(getKeyValueParserOptions());
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!keyValueSample.trim()) {
      return null;
    }

    return { fields: parseKeyValuePairs(keyValueSample, options) };
  }, [processorType, keyValuePairDelimiter, keyValueDelimiter, keyValueSample]);

  const buildConfiguration: () => JSONObject = (): JSONObject => {
    switch (processorType) {
      case "GrokParser":
        return {
          source: grokSource.trim() || "body",
          pattern: grokPattern.trim(),
          targetPrefix: grokTargetPrefix.trim(),
        };
      case "KeyValueParser":
        return {
          source: keyValueSource.trim() || "body",
          targetPrefix: keyValueTargetPrefix.trim(),
          keyValueDelimiter: keyValueDelimiter || DEFAULT_KEY_VALUE_DELIMITER,
          overrideOnConflict: keyValueOverrideOnConflict,
          ...(keyValuePairDelimiter
            ? { pairDelimiter: keyValuePairDelimiter }
            : {}),
        };
      case "SeverityRemapper":
        return {
          sourceKey: severitySourceKey,
          mappings: severityMappings.filter((m: SeverityMapping) => {
            return m.matchValue && m.severityText;
          }) as unknown as JSONValue,
        };
      case "AttributeRemapper":
        return {
          sourceKey: attrSourceKey,
          targetKey: attrTargetKey,
          preserveSource,
          overrideOnConflict,
        };
      case "CategoryProcessor":
        return {
          targetKey: categoryTargetKey,
          categories: categories.filter((c: CategoryRule) => {
            return c.name && c.filterQuery;
          }) as unknown as JSONValue,
        };
      default:
        return {};
    }
  };

  const validate: () => string | null = (): string | null => {
    if (!name.trim()) {
      return "Name is required.";
    }
    if (!processorType) {
      return "Please select a processor type.";
    }

    switch (processorType) {
      case "GrokParser": {
        if (!grokSource.trim()) {
          return "Source field is required.";
        }
        if (!grokPattern.trim()) {
          return "Grok pattern is required.";
        }

        /*
         * Compile before saving. The API rejects an uncompilable pattern
         * too, but the message reads better next to the field that
         * produced it.
         */
        try {
          compileGrokPattern(grokPattern.trim());
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        break;
      }
      case "KeyValueParser": {
        if (!keyValueSource.trim()) {
          return "Source field is required.";
        }

        /*
         * The same check the API makes, so a delimiter clash reads next
         * to the delimiter fields instead of as a failed save.
         */
        try {
          resolveKeyValueParserOptions(getKeyValueParserOptions());
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        break;
      }
      case "SeverityRemapper": {
        if (!severitySourceKey.trim()) {
          return "Source key is required for Severity Remapper.";
        }
        const validMappings: Array<SeverityMapping> = severityMappings.filter(
          (m: SeverityMapping) => {
            return m.matchValue && m.severityText;
          },
        );
        if (validMappings.length === 0) {
          return "At least one severity mapping is required.";
        }
        break;
      }
      case "AttributeRemapper":
        if (!attrSourceKey.trim()) {
          return "Source key is required.";
        }
        if (!attrTargetKey.trim()) {
          return "Target key is required.";
        }
        break;
      case "CategoryProcessor": {
        if (!categoryTargetKey.trim()) {
          return "Target key is required.";
        }
        const validCategories: Array<CategoryRule> = categories.filter(
          (c: CategoryRule) => {
            return c.name && c.filterQuery;
          },
        );
        if (validCategories.length === 0) {
          return "At least one category rule is required.";
        }
        break;
      }
    }

    return null;
  };

  const handleSave: () => Promise<void> = async (): Promise<void> => {
    const validationError: string | null = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const processor: LogPipelineProcessor = new LogPipelineProcessor();
      processor.name = name;
      processor.processorType = processorType;
      processor.configuration = buildConfiguration();
      processor.isEnabled = isEnabled;
      processor.logPipelineId = props.pipelineId;
      processor.sortOrder = 1;

      await ModelAPI.create({
        model: processor,
        modelType: LogPipelineProcessor,
      });

      props.onProcessorCreated();
    } catch (err) {
      /*
       * The API validates the grok pattern too, and ModelAPI throws an
       * HTTPErrorResponse rather than an Error - getFriendlyMessage
       * reads both. "Unknown grok pattern %{IPV44}" is worth showing;
       * "please try again" is not.
       */
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Add Processor"
      description="Processors transform logs as they flow through the pipeline. They run in order after the filter conditions match. Each processor modifies the log before it is stored."
      modalWidth={ModalWidth.Large}
      submitButtonText="Create Processor"
      onSubmit={handleSave}
      isLoading={isSaving}
      onClose={props.onCancel}
    >
      <div className="p-2 space-y-5">
        {error && (
          <Alert
            type={AlertType.DANGER}
            title={error}
            onClose={() => {
              setError("");
            }}
          />
        )}

        {/* Name */}
        <div>
          <FieldLabelElement title="Processor Name" />
          <div className="mt-1">
            <Input
              type={InputType.TEXT}
              placeholder="e.g. Remap severity levels"
              value={name}
              onChange={setName}
            />
          </div>
        </div>

        {/* Processor Type */}
        <div>
          <FieldLabelElement
            title="Processor Type"
            description="Choose what this processor does"
          />
          <div className="mt-1">
            <Dropdown
              options={processorTypeOptions}
              value={
                processorType
                  ? processorTypeOptions.find((opt: DropdownOption) => {
                      return opt.value === processorType;
                    })
                  : undefined
              }
              placeholder="Select processor type..."
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setProcessorType((value?.toString() as ProcessorType) || "");
              }}
            />
          </div>
        </div>

        {/* === Grok Parser Configuration === */}
        {processorType === "GrokParser" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Grok Parser Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template={
                  'Extracts structured fields out of an unstructured log line and stores them in the log\'s {{attributes}} object, so you can search and filter on them. A grok pattern is regex with names: {{example}} means "match an IPv4 address and store it as client_ip".'
                }
                slots={{
                  attributes: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      attributes
                    </code>
                  ),
                  example: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      %&#123;IPV4:client_ip&#125;
                    </code>
                  ),
                }}
              />
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the text from the Source Field (usually the log {{field}})."
                    slots={{
                      field: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          body
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. Runs your pattern against it. The pattern does not have to match the whole line.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. Every named capture becomes a log attribute. Add {{int}} or {{float}} to a capture to store it as a number."
                    slots={{
                      int: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          :int
                        </code>
                      ),
                      float: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          :float
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "4. If the line does not match, the log passes through unchanged.",
                  )}
                </p>
              </div>
              <code className="mt-2 block p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed overflow-x-auto">
                <span className="text-gray-500">// Log body</span>
                <br />
                <span className="text-sky-400">10.0.1.5 - GET /health 200</span>
                <br />
                <span className="text-gray-500">// Pattern</span>
                <br />
                <span className="text-emerald-400">
                  %&#123;IPV4:client_ip&#125; - %&#123;WORD:method&#125;
                  %&#123;NOTSPACE:path&#125; %&#123;NUMBER:status:int&#125;
                </span>
                <br />
                <span className="text-gray-500">// Attributes added</span>
                <br />
                <span className="text-amber-400">client_ip</span>:{" "}
                <span className="text-sky-400">&quot;10.0.1.5&quot;</span>,{" "}
                <span className="text-amber-400">method</span>:{" "}
                <span className="text-sky-400">&quot;GET&quot;</span>,{" "}
                <span className="text-amber-400">path</span>:{" "}
                <span className="text-sky-400">&quot;/health&quot;</span>,{" "}
                <span className="text-amber-400">status</span>:{" "}
                <span className="text-sky-400">200</span>
              </code>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabelElement
                  title="Source Field"
                  description="The field to parse. Use 'body' for the log message, or an attribute key like 'attributes.raw_line'."
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="body"
                    value={grokSource}
                    onChange={setGrokSource}
                  />
                </div>
              </div>
              <div>
                <FieldLabelElement
                  title="Target Prefix (optional)"
                  description="Namespace for the extracted attributes. 'http' stores status as http.status."
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="e.g. http"
                    value={grokTargetPrefix}
                    onChange={setGrokTargetPrefix}
                  />
                </div>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Grok Pattern"
                description="Named patterns like %{IPV4:client_ip}, mixed with any literal text or regex."
              />
              <div className="mt-1">
                <TextArea
                  placeholder={
                    '%{IPV4:client_ip} %{USER:ident} %{USER:auth} [%{HTTPDATE:timestamp}] "%{WORD:verb} %{NOTSPACE:request} HTTP/%{NUMBER:http_version}" %{NUMBER:status:int} %{NUMBER:bytes:int}'
                  }
                  value={grokPattern}
                  onChange={setGrokPattern}
                  disableSpellCheck={true}
                  className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-xs font-mono placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y min-h-24"
                />
              </div>
              <div className="mt-2">
                <Button
                  title={
                    showGrokPatternList
                      ? "Hide available patterns"
                      : "Show available patterns"
                  }
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setShowGrokPatternList(!showGrokPatternList);
                  }}
                />
              </div>
              {showGrokPatternList && (
                <div className="mt-2 max-h-40 overflow-y-auto p-2 bg-white rounded-md border border-indigo-100">
                  <div className="flex flex-wrap gap-1">
                    {getGrokPatternNames().map((patternName: string) => {
                      return (
                        <code
                          key={patternName}
                          className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]"
                        >
                          {`%{${patternName}}`}
                        </code>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Pattern tester */}
            <div>
              <FieldLabelElement
                title="Test Your Pattern"
                description="Paste a real log line here to see exactly which attributes this processor would add."
              />
              <div className="mt-1">
                <TextArea
                  placeholder='10.0.1.5 - - [10/Oct/2023:13:55:36 -0700] "GET /health HTTP/1.1" 200 1234'
                  value={grokSample}
                  onChange={setGrokSample}
                  disableSpellCheck={true}
                  className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-xs font-mono placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y min-h-16"
                />
              </div>

              {grokTestResult?.error && (
                <div className="mt-2 p-2 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
                  {grokTestResult.error}
                </div>
              )}

              {grokTestResult?.compiledOnly && (
                <div className="mt-2 p-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-500">
                  {translator.translateText(
                    "Pattern is valid. Paste a sample log line above to see what it extracts.",
                  )}
                </div>
              )}

              {grokTestResult?.matched === false && (
                <div className="mt-2 p-2 rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-700">
                  {translator.translateText(
                    "This pattern does not match the sample line. Logs that do not match are left unchanged.",
                  )}
                </div>
              )}

              {grokTestResult?.matched === true && (
                <div className="mt-2 p-2 rounded-md border border-emerald-200 bg-emerald-50">
                  {Object.keys(grokTestResult.fields || {}).length === 0 ? (
                    <p className="text-xs text-emerald-700">
                      <TranslatedSentence
                        template="Matches, but captures nothing. Name your captures like {{example}} to store them."
                        slots={{
                          example: <code>%&#123;WORD:my_field&#125;</code>,
                        }}
                      />
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-700">
                        {translator.translateText(
                          "Attributes this processor would add",
                        )}
                      </p>
                      {Object.entries(grokTestResult.fields || {}).map(
                        ([fieldName, fieldValue]: [string, GrokValue]) => {
                          return (
                            <div
                              key={fieldName}
                              className="text-[11px] font-mono text-gray-700"
                            >
                              <span className="text-indigo-700">
                                {previewAttributeKey(
                                  grokTargetPrefix,
                                  fieldName,
                                )}
                              </span>
                              {": "}
                              <span className="text-gray-600">
                                {typeof fieldValue === "string"
                                  ? `"${fieldValue}"`
                                  : String(fieldValue)}
                              </span>
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === Key=Value Parser Configuration === */}
        {processorType === "KeyValueParser" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Key=Value Parser Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template={
                  "Splits a line of key=value pairs into the log's {{attributes}} object, whatever order the fields arrive in. Firewalls such as Sophos XGS and Fortinet log every event this way, so their fields become searchable and filterable - and usable as a log monitor's group-by - without writing a pattern."
                }
                slots={{
                  attributes: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      attributes
                    </code>
                  ),
                }}
              />
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the text from the Source Field (usually the log {{field}})."
                    slots={{
                      field: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          body
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  <TranslatedSentence
                    template={
                      "2. Every {{pair}} becomes an attribute. Quoted values keep their spaces, and text that is not a pair - such as a syslog header - is skipped."
                    }
                    slots={{
                      pair: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          key=value
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "3. Values are stored as text. If a key appears twice, the first value is kept.",
                  )}
                </p>
                <p>
                  {translator.translateText(
                    "4. An attribute the log already has is left alone unless Override on Conflict is on. A line with no pairs passes through unchanged.",
                  )}
                </p>
              </div>
              <code className="mt-2 block p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed overflow-x-auto">
                <span className="text-gray-500">// Log body (Sophos XGS)</span>
                <br />
                <span className="text-sky-400">
                  log_component=&quot;IPSec&quot;
                  con_name=&quot;HQ-Branch1&quot; status=&quot;Terminated&quot;
                </span>
                <br />
                <span className="text-gray-500">
                  // Attributes added (target prefix &quot;sophos&quot;)
                </span>
                <br />
                <span className="text-amber-400">
                  sophos.log_component
                </span>: <span className="text-sky-400">&quot;IPSec&quot;</span>
                , <span className="text-amber-400">sophos.con_name</span>:{" "}
                <span className="text-sky-400">&quot;HQ-Branch1&quot;</span>,{" "}
                <span className="text-amber-400">sophos.status</span>:{" "}
                <span className="text-sky-400">&quot;Terminated&quot;</span>
              </code>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabelElement
                  title="Source Field"
                  description="The field to parse. Use 'body' for the log message, or an attribute key like 'attributes.raw_line'."
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="body"
                    value={keyValueSource}
                    onChange={setKeyValueSource}
                  />
                </div>
              </div>
              <div>
                <FieldLabelElement
                  title="Target Prefix (optional)"
                  description="Namespace for the extracted attributes. 'sophos' stores con_name as sophos.con_name."
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="e.g. sophos"
                    value={keyValueTargetPrefix}
                    onChange={setKeyValueTargetPrefix}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabelElement
                  title="Pair Delimiter (optional)"
                  description="What separates one pair from the next. Leave blank to split on any whitespace, which is what Sophos, Fortinet and logfmt use."
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="Any whitespace"
                    value={keyValuePairDelimiter}
                    onChange={setKeyValuePairDelimiter}
                  />
                </div>
              </div>
              <div>
                <FieldLabelElement
                  title="Key-Value Delimiter"
                  description="What separates a key from its value. Must differ from the pair delimiter."
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="="
                    value={keyValueDelimiter}
                    onChange={setKeyValueDelimiter}
                  />
                </div>
              </div>
            </div>

            <div className="mb-4">
              <Toggle
                title="Override on Conflict"
                description="Overwrite an attribute the log already has under the same key. Off by default, so a line cannot replace attributes set at ingest, such as the device it came from."
                value={keyValueOverrideOnConflict}
                onChange={setKeyValueOverrideOnConflict}
              />
            </div>

            {/* Parser tester */}
            <div>
              <FieldLabelElement
                title="Test With a Sample Line"
                description="Paste a real log line here to see exactly which attributes this processor would add."
              />
              <div className="mt-1">
                <TextArea
                  placeholder='device_name="SFW" log_component="IPSec" con_name="HQ-Branch1" status="Terminated"'
                  value={keyValueSample}
                  onChange={setKeyValueSample}
                  disableSpellCheck={true}
                  className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-xs font-mono placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y min-h-16"
                />
              </div>

              {keyValueTestResult?.error && (
                <div className="mt-2 p-2 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
                  {keyValueTestResult.error}
                </div>
              )}

              {keyValueTestResult?.fields &&
                Object.keys(keyValueTestResult.fields).length === 0 && (
                  <div className="mt-2 p-2 rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-700">
                    {translator.translateText(
                      "No key=value pairs found in the sample line. Logs like this are left unchanged.",
                    )}
                  </div>
                )}

              {keyValueTestResult?.fields &&
                Object.keys(keyValueTestResult.fields).length > 0 && (
                  <div className="mt-2 p-2 rounded-md border border-emerald-200 bg-emerald-50">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-700">
                        {translator.translateText(
                          "Attributes this processor would add",
                        )}
                      </p>
                      {Object.entries(keyValueTestResult.fields).map(
                        ([fieldName, fieldValue]: [string, string]) => {
                          return (
                            <div
                              key={fieldName}
                              className="text-[11px] font-mono text-gray-700"
                            >
                              <span className="text-indigo-700">
                                {previewAttributeKey(
                                  keyValueTargetPrefix,
                                  fieldName,
                                )}
                              </span>
                              {": "}
                              <span className="text-gray-600">
                                {`"${fieldValue}"`}
                              </span>
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                )}
            </div>
          </div>
        )}

        {/* === Severity Remapper Configuration === */}
        {processorType === "SeverityRemapper" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Severity Remapper Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template="Normalizes raw severity values from your logs into standard levels (TRACE, DEBUG, INFO, WARNING, ERROR, FATAL). This processor reads a value from a log attribute and maps it to the log's {{field}} field."
                slots={{
                  field: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      severityText
                    </code>
                  ),
                }}
              />
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. The processor reads the value from the Source Attribute in your log's {{attributes}} object."
                    slots={{
                      attributes: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. It looks up the value in your mappings below.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. If a match is found, the log's {{field}} is updated to the mapped severity level."
                    slots={{
                      field: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          severityText
                        </code>
                      ),
                    }}
                  />
                </p>
              </div>
              <code className="mt-2 block p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed">
                <span className="text-gray-500">// Example: incoming log</span>
                <br />
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;level&quot;</span>:{" "}
                <span className="text-sky-400">&quot;warn&quot;</span> {"}"}
                <br />
                <span className="text-gray-500">
                  // After processing (with mapping: warn → WARNING)
                </span>
                <br />
                <span className="text-amber-400">severityText</span>:{" "}
                <span className="text-sky-400">&quot;WARNING&quot;</span>
              </code>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Source Attribute"
                description={
                  'The key in your log\'s attributes object that contains the raw severity value. Many logging libraries (Pino, Winston, Bunyan) use "level" by default.'
                }
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. level"
                  value={severitySourceKey}
                  onChange={setSeveritySourceKey}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                <TranslatedSentence
                  template="Common values: {{values}}"
                  slots={{
                    values: (
                      <>
                        <code className="text-gray-500">level</code>,{" "}
                        <code className="text-gray-500">log_level</code>,{" "}
                        <code className="text-gray-500">severity</code>,{" "}
                        <code className="text-gray-500">priority</code>
                      </>
                    ),
                  }}
                />
              </p>
            </div>

            <div>
              <FieldLabelElement
                title="Mappings"
                description="Define how raw attribute values map to standard severity levels. The match value should be exactly what your application emits."
              />
              <div className="mt-2 space-y-2">
                {severityMappings.map(
                  (mapping: SeverityMapping, index: number) => {
                    return (
                      <SeverityMappingRow
                        key={index}
                        mapping={mapping}
                        canDelete={severityMappings.length > 1}
                        onChange={(updated: SeverityMapping) => {
                          const newMappings: Array<SeverityMapping> = [
                            ...severityMappings,
                          ];
                          newMappings[index] = updated;
                          setSeverityMappings(newMappings);
                        }}
                        onDelete={() => {
                          setSeverityMappings(
                            severityMappings.filter(
                              (_: SeverityMapping, i: number) => {
                                return i !== index;
                              },
                            ),
                          );
                        }}
                      />
                    );
                  },
                )}
              </div>
              <div className="mt-2">
                <Button
                  title="Add Mapping"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setSeverityMappings([
                      ...severityMappings,
                      {
                        matchValue: "",
                        severityText: "",
                        severityNumber: 0,
                      },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* === Attribute Remapper Configuration === */}
        {processorType === "AttributeRemapper" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Attribute Remapper Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template="Renames or copies a key inside the log's {{attributes}} object. Useful for standardizing attribute names across services or cleaning up legacy key names."
                slots={{
                  attributes: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      attributes
                    </code>
                  ),
                }}
              />
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Reads the value from {{key}}."
                    slots={{
                      key: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes[sourceKey]
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  <TranslatedSentence
                    template="2. Writes that value to {{key}}."
                    slots={{
                      key: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes[targetKey]
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "3. Optionally removes the original source key (if Preserve Source is off).",
                  )}
                </p>
              </div>
              <code className="mt-2 block p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed">
                <span className="text-gray-500">
                  // Before: attributes has &quot;src_ip&quot;
                </span>
                <br />
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;src_ip&quot;</span>:{" "}
                <span className="text-sky-400">&quot;10.0.1.5&quot;</span> {"}"}
                <br />
                <span className="text-gray-500">
                  // After: renamed to &quot;source_ip&quot;
                </span>
                <br />
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;source_ip&quot;</span>:{" "}
                <span className="text-sky-400">&quot;10.0.1.5&quot;</span> {"}"}
              </code>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabelElement
                  title="Source Key"
                  description="The attribute key to read the value from"
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="e.g. src_ip"
                    value={attrSourceKey}
                    onChange={setAttrSourceKey}
                  />
                </div>
              </div>
              <div>
                <FieldLabelElement
                  title="Target Key"
                  description="The new attribute key to write the value to"
                />
                <div className="mt-1">
                  <Input
                    type={InputType.TEXT}
                    placeholder="e.g. source_ip"
                    value={attrTargetKey}
                    onChange={setAttrTargetKey}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Toggle
                title="Preserve Source"
                description="Keep the original source attribute after remapping. If off, the source key is removed."
                value={preserveSource}
                onChange={setPreserveSource}
              />
              <Toggle
                title="Override on Conflict"
                description="If the target key already exists, overwrite its value. If off and the target exists, the remap is skipped."
                value={overrideOnConflict}
                onChange={setOverrideOnConflict}
              />
            </div>
          </div>
        )}

        {/* === Category Processor Configuration === */}
        {processorType === "CategoryProcessor" && (
          <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50/30">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">
              {translator.translateText("Category Processor Configuration")}
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              <TranslatedSentence
                template="Tags each log with a category name based on filter rules. The category value is stored in the log's {{attributes}} object under the Target Attribute key. Rules are evaluated in order and {{firstMatch}}."
                slots={{
                  attributes: (
                    <code className="px-1 py-0.5 bg-indigo-100 rounded text-indigo-700 text-[11px]">
                      attributes
                    </code>
                  ),
                  firstMatch: (
                    <strong>
                      {translator.translateText("the first matching rule wins")}
                    </strong>
                  ),
                }}
              />
            </p>

            {/* How it works */}
            <div className="mb-4 p-3 bg-white rounded-md border border-indigo-100">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                {translator.translateText("How it works")}
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <TranslatedSentence
                    template="1. Each category rule has a filter condition (e.g. {{example}})."
                    slots={{
                      example: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          severityText = &apos;Error&apos;
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "2. The processor evaluates rules top to bottom. The first rule that matches the log is applied.",
                  )}
                </p>
                <p>
                  <TranslatedSentence
                    template="3. The category name is stored at {{key}} on the log."
                    slots={{
                      key: (
                        <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-600 text-[11px]">
                          attributes[targetAttribute]
                        </code>
                      ),
                    }}
                  />
                </p>
                <p>
                  {translator.translateText(
                    "4. You can then filter and search logs by this attribute in the Logs Viewer.",
                  )}
                </p>
              </div>
              <code className="mt-2 block p-2 bg-gray-900 rounded text-[11px] font-mono text-gray-300 leading-relaxed">
                <span className="text-gray-500">
                  // Rule: &quot;Critical Errors&quot; when severityText =
                  &apos;Error&apos;
                </span>
                <br />
                <span className="text-gray-500">
                  // Target Attribute: &quot;category&quot;
                </span>
                <br />
                <br />
                <span className="text-gray-500">// Before processing</span>
                <br />
                <span className="text-amber-400">severityText</span>:{" "}
                <span className="text-sky-400">&quot;Error&quot;</span>,{" "}
                <span className="text-amber-400">attributes</span>: {"{"} {"}"}
                <br />
                <span className="text-gray-500">// After processing</span>
                <br />
                <span className="text-amber-400">severityText</span>:{" "}
                <span className="text-sky-400">&quot;Error&quot;</span>,{" "}
                <span className="text-amber-400">attributes</span>: {"{"}{" "}
                <span className="text-emerald-400">&quot;category&quot;</span>:{" "}
                <span className="text-sky-400">
                  &quot;Critical Errors&quot;
                </span>{" "}
                {"}"}
              </code>
            </div>

            <div className="mb-4">
              <FieldLabelElement
                title="Target Attribute"
                description={
                  "The key in the log's attributes where the matched category name will be stored. You can search logs by this attribute in the Logs Viewer."
                }
              />
              <div className="mt-1 w-64">
                <Input
                  type={InputType.TEXT}
                  placeholder="e.g. category"
                  value={categoryTargetKey}
                  onChange={setCategoryTargetKey}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                <TranslatedSentence
                  template="The category will be accessible as {{key}} in your logs."
                  slots={{
                    key: (
                      <code className="text-gray-500">
                        attributes.{categoryTargetKey || "category"}
                      </code>
                    ),
                  }}
                />
              </p>
            </div>

            <div>
              <FieldLabelElement
                title="Category Rules"
                description="Define categories and the filter conditions that trigger them. Rules are evaluated top to bottom — the first match wins."
              />
              <div className="mt-2 space-y-3">
                {categories.map((cat: CategoryRule, index: number) => {
                  return (
                    <div
                      key={index}
                      className="p-3 bg-gray-50 rounded-md border border-gray-200 space-y-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                            {translator.translateText("Category name")}
                          </label>
                          <Input
                            type={InputType.TEXT}
                            placeholder="e.g. Error"
                            value={cat.name}
                            onChange={(value: string) => {
                              const newCats: Array<CategoryRule> = [
                                ...categories,
                              ];
                              newCats[index] = {
                                ...cat,
                                name: value,
                              };
                              setCategories(newCats);
                            }}
                          />
                        </div>
                        <div className="flex-shrink-0 pt-5">
                          <Button
                            icon={IconProp.Trash}
                            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                              setCategories(
                                categories.filter(
                                  (_: CategoryRule, i: number) => {
                                    return i !== index;
                                  },
                                ),
                              );
                            }}
                            disabled={categories.length <= 1}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                          {translator.translateText("When logs match")}
                        </label>
                        <FilterQueryBuilderField
                          initialValue={cat.filterQuery || ""}
                          onChange={(value: string) => {
                            const newCats: Array<CategoryRule> = [
                              ...categories,
                            ];
                            newCats[index] = {
                              ...cat,
                              filterQuery: value,
                            };
                            setCategories(newCats);
                          }}
                          config={LogFilterConfig}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2">
                <Button
                  title="Add Category Rule"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    setCategories([
                      ...categories,
                      { name: "", filterQuery: "" },
                    ]);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Enabled toggle */}
        {processorType && (
          <div>
            <Toggle
              title="Enabled"
              description="Enable this processor to start processing logs"
              value={isEnabled}
              onChange={setIsEnabled}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ProcessorForm;
