import AppLink from "../AppLink/AppLink";
import {
  REASON_HINT,
  REASON_QUESTION,
  REASON_SAVE_FAILED,
  getTurnedOffLine,
  readReasonInput,
} from "./ResourceComplianceModel";
import {
  RESOURCE_KIND_LABELS,
  getResourceComplianceRoute,
} from "./ResourceDataSecurityPages";
import Route from "Common/Types/API/Route";
import { DataSecurityComplianceTurnedOff } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * WHY A FRAMEWORK OR A REQUIREMENT DOES NOT APPLY (#9629).
 *
 * Turning one off saves at once, as every switch does; then a small form
 * under it asks why, which may be left empty (Not Now). What was turned off
 * then says who turned it off and when, and the reason written for it, with
 * Add Reason or Edit Reason for whoever may change it. The project's
 * Compliance page lists the same for every resource, each named and linked
 * to its own Compliance page.
 */

export const COMPLIANCE_REASON_FORM_TEST_ID: string = "compliance-reason-form";

export interface ReasonFormProps {
  initialReason: string;
  isSaving: boolean;
  error?: string | undefined;
  onSave: (reason: string) => void;
  onCancel: () => void;
  dataTestId?: string | undefined;
}

// The question, a box for the answer, and Save Reason or Not Now.
export const ComplianceReasonForm: FunctionComponent<ReasonFormProps> = (
  props: ReasonFormProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const inputId: string = useId();
  const hintId: string = `${inputId}-hint`;
  const [reason, setReason] = useState<string>(props.initialReason);

  const save: () => void = (): void => {
    if (!props.isSaving) {
      props.onSave(reason.trim());
    }
  };

  return (
    <div
      className="mt-2 max-w-xl space-y-2"
      data-testid={props.dataTestId || COMPLIANCE_REASON_FORM_TEST_ID}
    >
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-gray-700"
      >
        {translator.translateText(REASON_QUESTION)}
      </label>
      <Input
        id={inputId}
        value={reason}
        autoFocus={true}
        ariaDescribedby={hintId}
        onChange={(value: string): void => {
          setReason(readReasonInput(value));
        }}
        onEnterPress={save}
        dataTestId={`${props.dataTestId || COMPLIANCE_REASON_FORM_TEST_ID}-input`}
      />
      <p id={hintId} className="text-xs text-gray-500">
        {translator.translateText(REASON_HINT)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          title="Save Reason"
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          isLoading={props.isSaving}
          onClick={save}
          dataTestId={`${props.dataTestId || COMPLIANCE_REASON_FORM_TEST_ID}-save`}
        />
        <Button
          title="Not Now"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          disabled={props.isSaving}
          onClick={props.onCancel}
          dataTestId={`${props.dataTestId || COMPLIANCE_REASON_FORM_TEST_ID}-cancel`}
        />
      </div>
      {props.error ? (
        <ErrorMessage
          message={props.error}
          whatFailed={translator.translateText(REASON_SAVE_FAILED)}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export interface TurnedOffNoteProps {
  entry: DataSecurityComplianceTurnedOff;
  // Whoever reads the page may change the reason: the switches are theirs.
  isEditable: boolean;
  // Asked at once: it was just turned off.
  isAsking?: boolean | undefined;
  onSaveReason: (
    entry: DataSecurityComplianceTurnedOff,
    reason: string,
  ) => Promise<void>;
  // The question was answered or put off.
  onDone?: (() => void) | undefined;
  dataTestId: string;
}

/*
 * What is turned off where the resource's compliance is set: who turned it
 * off and when, the reason, and the form that writes it.
 */
export const ComplianceTurnedOffNote: FunctionComponent<TurnedOffNoteProps> = (
  props: TurnedOffNoteProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isEditing, setIsEditing] = useState<boolean>(
    Boolean(props.isAsking && props.isEditable),
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const save: (reason: string) => Promise<void> = async (
    reason: string,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await props.onSaveReason(props.entry, reason);
      setIsEditing(false);
      props.onDone?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  return (
    <div className="mt-1" data-testid={props.dataTestId}>
      <p
        className="text-xs text-gray-500"
        data-testid={`${props.dataTestId}-who`}
      >
        {getTurnedOffLine(props.entry, translator)}
      </p>
      {isEditing ? (
        <ComplianceReasonForm
          initialReason={props.entry.note}
          isSaving={isSaving}
          error={error}
          onSave={(reason: string): void => {
            void save(reason);
          }}
          onCancel={(): void => {
            setIsEditing(false);
            setError("");
            props.onDone?.();
          }}
          dataTestId={`${props.dataTestId}-form`}
        />
      ) : (
        <>
          {props.entry.note ? (
            <p
              className="mt-1 whitespace-pre-line break-words text-sm text-gray-700"
              data-testid={`${props.dataTestId}-reason`}
            >
              {props.entry.note}
            </p>
          ) : (
            <></>
          )}
          {props.isEditable ? (
            <div className="mt-1">
              <Button
                title={props.entry.note ? "Edit Reason" : "Add Reason"}
                buttonStyle={ButtonStyleType.LINK}
                buttonSize={ButtonSize.ExtraSmall}
                onClick={(): void => {
                  setIsEditing(true);
                }}
                dataTestId={`${props.dataTestId}-edit`}
              />
            </div>
          ) : (
            <></>
          )}
        </>
      )}
    </div>
  );
};

export interface TurnedOffListProps {
  entries: Array<DataSecurityComplianceTurnedOff>;
  dataTestId: string;
}

/*
 * The resources that turned a framework or a requirement off, on the
 * project's Compliance page: each named and linked to its own Compliance
 * page - by its kind alone when the reader may not read it - with who
 * turned it off, when, and why.
 */
export const ComplianceTurnedOffList: FunctionComponent<TurnedOffListProps> = (
  props: TurnedOffListProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul className="space-y-2" data-testid={props.dataTestId}>
      {props.entries.map(
        (entry: DataSecurityComplianceTurnedOff): ReactElement => {
          const kindLabel: string =
            RESOURCE_KIND_LABELS[entry.resource.kind] || "";
          const kind: string = translator.translateText(kindLabel) || kindLabel;
          const route: Route | null = entry.resource.name
            ? getResourceComplianceRoute(entry.resource.kind, entry.resource.id)
            : null;

          return (
            <li
              key={entry.id}
              className="text-sm"
              data-testid={`${props.dataTestId}-entry`}
            >
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                {route ? (
                  <AppLink
                    to={route}
                    className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    <span>{entry.resource.name}</span>
                  </AppLink>
                ) : (
                  <span className="font-medium text-gray-900">{kind}</span>
                )}
                {route ? (
                  <span className="text-xs text-gray-500">· {kind}</span>
                ) : (
                  <></>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {getTurnedOffLine(entry, translator)}
              </p>
              {entry.note ? (
                <p className="mt-0.5 whitespace-pre-line break-words text-gray-700">
                  {entry.note}
                </p>
              ) : (
                <></>
              )}
            </li>
          );
        },
      )}
    </ul>
  );
};
