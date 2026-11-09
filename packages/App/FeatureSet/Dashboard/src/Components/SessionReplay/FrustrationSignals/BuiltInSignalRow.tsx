import IconProp from "Common/Types/Icon/IconProp";
import {
  getDefaultSessionReplayFrustrationSettings,
  SessionReplayFrustrationSettings,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FOLDED_SECTION_LINE } from "Common/UI/Components/FoldedSection/FoldedSectionVariant";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import {
  BUILT_IN_SIGNAL_EXAMPLES,
  BUILT_IN_SIGNAL_TITLES,
  BuiltInSignalKey,
  CHANGE_RULE_TITLE,
  describeBuiltInSignal,
  describeIgnoredSelectors,
  getDefaultRuleFieldTexts,
  getIgnoredSelectorsProblem,
  hasIgnoredSelectors,
  IGNORE_SELECTORS_HINT,
  IGNORE_SELECTORS_LABEL,
  readFieldText,
  readSelectorLines,
  RULE_NUMBER_FIELDS,
  RuleNumberField,
  SAVE_RULE_TEXT,
  SelectorCheck,
  toFieldText,
  USE_DEFAULTS_TEXT,
  withBuiltInSignalEnabled,
} from "./FrustrationSignalsCopy";

/*
 * One built-in signal: its switch, which saves the moment it is flipped,
 * what it flags in one sentence built from its own numbers, an example, and
 * its rule folded away under "Change the rule" - most applications never
 * need to open it.
 *
 * The switch moves at once and says "Saving…", then "Saved"; refused, it
 * goes back and says why under the row. The rule is saved with its own
 * button, after every number in it is checked here (the server checks them
 * again). "Use the defaults" puts the default numbers in the fields without
 * saving them, so they can be looked at first.
 */

export interface ComponentProps {
  signalKey: BuiltInSignalKey;
  settings: SessionReplayFrustrationSettings;
  canEdit: boolean;
  // Another change on the page is being saved: nothing here starts one.
  isSaving: boolean;
  save: (next: SessionReplayFrustrationSettings) => Promise<string | null>;
  // A test seam: the browser's own reading of a selector.
  acceptsSelector?: SelectorCheck | undefined;
}

function getRuleTexts(
  signalKey: BuiltInSignalKey,
  settings: SessionReplayFrustrationSettings,
): Record<string, string> {
  const texts: Record<string, string> = {};

  for (const field of RULE_NUMBER_FIELDS[signalKey]) {
    texts[field.id] = toFieldText(field, field.read(settings));
  }

  return texts;
}

export function getIgnoredSelectors(
  signalKey: BuiltInSignalKey,
  settings: SessionReplayFrustrationSettings,
): Array<string> {
  if (signalKey === "rageClick") {
    return settings.rageClick.ignoreSelectors;
  }

  if (signalKey === "deadClick") {
    return settings.deadClick.ignoreSelectors;
  }

  return [];
}

function withIgnoredSelectors(
  signalKey: BuiltInSignalKey,
  settings: SessionReplayFrustrationSettings,
  selectors: Array<string>,
): SessionReplayFrustrationSettings {
  if (signalKey === "rageClick") {
    return {
      ...settings,
      rageClick: { ...settings.rageClick, ignoreSelectors: selectors },
    };
  }

  if (signalKey === "deadClick") {
    return {
      ...settings,
      deadClick: { ...settings.deadClick, ignoreSelectors: selectors },
    };
  }

  return settings;
}

const BuiltInSignalRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const titleId: string = useId();
  const testId: string = `frustration-signal-${props.signalKey}`;

  const savedIsOn: boolean = props.settings[props.signalKey].isEnabled;
  const ruleSource: string = JSON.stringify(props.settings[props.signalKey]);

  // Where the switch is going while its change is saved.
  const [pendingIsOn, setPendingIsOn] = useState<boolean | null>(null);
  const [switchState, setSwitchState] = useState<SaveState>(SaveState.Idle);
  const [switchError, setSwitchError] = useState<string>("");

  const [ruleState, setRuleState] = useState<SaveState>(SaveState.Idle);
  const [ruleError, setRuleError] = useState<string>("");
  const [fieldTexts, setFieldTexts] = useState<Record<string, string>>(
    getRuleTexts(props.signalKey, props.settings),
  );
  const [fieldProblems, setFieldProblems] = useState<Record<string, string>>(
    {},
  );
  const [selectorText, setSelectorText] = useState<string>(
    getIgnoredSelectors(props.signalKey, props.settings).join("\n"),
  );
  const [selectorProblem, setSelectorProblem] = useState<string>("");

  // The rule as saved is what the editor starts from, after every save.
  useEffect(() => {
    setFieldTexts(getRuleTexts(props.signalKey, props.settings));
    setSelectorText(
      getIgnoredSelectors(props.signalKey, props.settings).join("\n"),
    );
    setFieldProblems({});
    setSelectorProblem("");
  }, [ruleSource]);

  const isOn: boolean = pendingIsOn ?? savedIsOn;

  const flip: (value: boolean) => void = (value: boolean): void => {
    if (props.isSaving || !props.canEdit) {
      return;
    }

    setPendingIsOn(value);
    setSwitchError("");
    setSwitchState(SaveState.Saving);

    void props
      .save(withBuiltInSignalEnabled(props.settings, props.signalKey, value))
      .then((problem: string | null): void => {
        setPendingIsOn(null);

        if (problem) {
          setSwitchError(problem);
          setSwitchState(SaveState.Idle);
          return;
        }

        setSwitchState(SaveState.Saved);
      });
  };

  const saveRule: () => void = (): void => {
    if (props.isSaving || !props.canEdit) {
      return;
    }

    let next: SessionReplayFrustrationSettings = props.settings;
    const problems: Record<string, string> = {};

    for (const field of RULE_NUMBER_FIELDS[props.signalKey]) {
      const read: { value: number | null; problem: string | null } =
        readFieldText(field, fieldTexts[field.id] ?? "", translator);

      if (read.problem || read.value === null) {
        problems[field.id] = read.problem || "";
        continue;
      }

      next = field.write(next, read.value);
    }

    let selectorIssue: string = "";

    if (hasIgnoredSelectors(props.signalKey)) {
      const selectors: Array<string> = readSelectorLines(selectorText);

      selectorIssue =
        getIgnoredSelectorsProblem(
          selectors,
          translator,
          props.acceptsSelector,
        ) || "";

      next = withIgnoredSelectors(props.signalKey, next, selectors);
    }

    setFieldProblems(problems);
    setSelectorProblem(selectorIssue);
    setRuleError("");

    if (Object.keys(problems).length > 0 || selectorIssue) {
      setRuleState(SaveState.Idle);
      return;
    }

    setRuleState(SaveState.Saving);

    void props.save(next).then((problem: string | null): void => {
      if (problem) {
        setRuleError(problem);
        setRuleState(SaveState.Idle);
        return;
      }

      setRuleState(SaveState.Saved);
    });
  };

  const useDefaults: () => void = (): void => {
    const defaults: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();

    setFieldTexts(getDefaultRuleFieldTexts(props.signalKey, defaults));

    if (hasIgnoredSelectors(props.signalKey)) {
      setSelectorText("");
    }

    setFieldProblems({});
    setSelectorProblem("");
    setRuleError("");
    setRuleState(SaveState.Idle);
  };

  const ignoredLine: string = describeIgnoredSelectors(
    getIgnoredSelectors(props.signalKey, props.settings),
    translator,
  );

  return (
    <div className="py-5 first:pt-0 last:pb-0" data-testid={testId}>
      {/*
       * The switch shares a line with the title only, so on a phone the
       * sentences under it keep the row's whole width, "Saving…" included.
       */}
      <div className="flex items-center justify-between gap-3">
        <h3
          id={titleId}
          className="min-w-0 text-sm font-semibold text-gray-900"
        >
          {translator.translateText(BUILT_IN_SIGNAL_TITLES[props.signalKey])}
        </h3>
        <div className="flex shrink-0 items-center gap-3">
          <SaveStatus state={switchState} dataTestId={`${testId}-status`} />
          <Toggle
            value={isOn}
            disabled={!props.canEdit || props.isSaving}
            ariaLabelledby={titleId}
            dataTestId={`${testId}-switch`}
            onChange={(value: boolean): void => {
              if (value !== isOn) {
                flip(value);
              }
            }}
          />
        </div>
      </div>

      <div className="mt-1 max-w-3xl space-y-1 text-sm">
        <p
          className={isOn ? "text-gray-700" : "text-gray-500"}
          data-testid={`${testId}-definition`}
        >
          {describeBuiltInSignal(props.signalKey, props.settings, translator)}
        </p>
        <p className="text-gray-500">
          {translator.translateText(BUILT_IN_SIGNAL_EXAMPLES[props.signalKey])}
        </p>
        {ignoredLine && (
          <p className="text-gray-500" data-testid={`${testId}-ignored`}>
            {ignoredLine}
          </p>
        )}
      </div>

      {switchError && (
        <p
          className="mt-2 text-sm text-red-700"
          role="alert"
          data-testid={`${testId}-error`}
        >
          {switchError}
        </p>
      )}

      {props.canEdit && (
        <div className="mt-3">
          <FoldedSection
            title={CHANGE_RULE_TITLE}
            variant={FOLDED_SECTION_LINE}
            dataTestId={`${testId}-rule`}
          >
            <div className="space-y-4 pt-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {RULE_NUMBER_FIELDS[props.signalKey].map(
                  (field: RuleNumberField): ReactElement => {
                    const inputId: string = `${testId}-${field.id}`;

                    return (
                      <div key={field.id}>
                        <label
                          htmlFor={inputId}
                          className="mb-1.5 block text-sm font-medium text-gray-700"
                        >
                          {translator.translateText(field.label)}
                        </label>
                        <div className="flex items-start gap-2">
                          <Input
                            id={inputId}
                            type={InputType.NUMBER}
                            value={fieldTexts[field.id] ?? ""}
                            disabled={props.isSaving}
                            outerDivClassName="w-24 shrink-0"
                            dataTestId={inputId}
                            error={fieldProblems[field.id] || undefined}
                            onChange={(value: string): void => {
                              setFieldTexts(
                                (
                                  current: Record<string, string>,
                                ): Record<string, string> => {
                                  return { ...current, [field.id]: value };
                                },
                              );
                              setRuleState(SaveState.Idle);
                            }}
                          />
                          <span className="pt-2 text-sm text-gray-500">
                            {translator.translateText(field.unitLabel)}
                          </span>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>

              {hasIgnoredSelectors(props.signalKey) && (
                <div>
                  <label
                    htmlFor={`${testId}-ignore`}
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    {translator.translateText(IGNORE_SELECTORS_LABEL)}
                  </label>
                  <TextArea
                    id={`${testId}-ignore`}
                    value={selectorText}
                    placeholder=".quantity-stepper"
                    rows={3}
                    dataTestId={`${testId}-ignore`}
                    disableSpellCheck={true}
                    error={selectorProblem || undefined}
                    onChange={(value: string): void => {
                      setSelectorText(value);
                      setRuleState(SaveState.Idle);
                    }}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    {translator.translateText(IGNORE_SELECTORS_HINT)}
                  </p>
                </div>
              )}

              {ruleError && (
                <p
                  className="text-sm text-red-700"
                  role="alert"
                  data-testid={`${testId}-rule-error`}
                >
                  {ruleError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  title={SAVE_RULE_TEXT}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  buttonSize={ButtonSize.Small}
                  icon={IconProp.Check}
                  isLoading={ruleState === SaveState.Saving}
                  disabled={props.isSaving}
                  dataTestId={`${testId}-save-rule`}
                  onClick={saveRule}
                />
                <Button
                  title={USE_DEFAULTS_TEXT}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  disabled={props.isSaving}
                  dataTestId={`${testId}-use-defaults`}
                  onClick={useDefaults}
                />
                <SaveStatus
                  state={
                    ruleState === SaveState.Saved
                      ? SaveState.Saved
                      : SaveState.Idle
                  }
                  dataTestId={`${testId}-rule-status`}
                />
              </div>
            </div>
          </FoldedSection>
        </div>
      )}
    </div>
  );
};

export default BuiltInSignalRow;
