import Input from "../Input/Input";
import {
  TemplateAround,
  translateTemplateAround,
} from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * "Type Acme Production to confirm." - for the few deletes that take
 * everything with them.
 *
 * Naming the record is enough for nearly every delete in the product: the
 * user reads which one it is and confirms. Deleting a project is different in
 * kind. It removes every monitor, incident, status page, on-call schedule and
 * byte of telemetry in it, for every member, and nothing brings it back - and
 * the dialog that does it looks exactly like the one that deletes a label. So
 * there the Delete button stays locked until the project's name has been
 * typed, which can only be done by reading it.
 */

export const TYPE_TO_CONFIRM_TEMPLATE: string = "Type {{name}} to confirm.";

/*
 * Whether what was typed is the name. Surrounding spaces are forgiven - they
 * are invisible, and pasting often brings one along - but nothing else is: the
 * point is that the user read this name.
 */
export const isTypedNameConfirmed: (data: {
  typed: string;
  name: string;
}) => boolean = (data: { typed: string; name: string }): boolean => {
  const name: string = data.name.trim();

  return name.length > 0 && data.typed.trim() === name;
};

export interface ComponentProps {
  // What has to be typed: the record's full name, never a shortened one.
  name: string;
  value: string;
  onChange: (value: string) => void;
  // Enter in the box, once it matches - the same as pressing Delete.
  onConfirm?: (() => void) | undefined;
}

const TypeToConfirmDelete: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const inputId: string = `type-to-confirm-${useId().replace(/:/g, "")}`;

  const around: TemplateAround = translateTemplateAround(
    TYPE_TO_CONFIRM_TEMPLATE,
    "name",
  );

  return (
    <div data-testid="delete-confirmation-type-to-confirm">
      <label htmlFor={inputId} className="block text-sm text-gray-700">
        {around.before}
        <strong
          data-testid="delete-confirmation-type-to-confirm-name"
          className="select-all break-words font-semibold text-gray-900"
        >
          {props.name}
        </strong>
        {around.after}
      </label>
      <Input
        id={inputId}
        value={props.value}
        dataTestId="delete-confirmation-type-to-confirm-input"
        autoComplete="off"
        disableSpellCheck={true}
        onChange={(value: string) => {
          props.onChange(value);
        }}
        onEnterPress={() => {
          if (
            props.onConfirm &&
            isTypedNameConfirmed({ typed: props.value, name: props.name })
          ) {
            props.onConfirm();
          }
        }}
      />
    </div>
  );
};

export default TypeToConfirmDelete;
