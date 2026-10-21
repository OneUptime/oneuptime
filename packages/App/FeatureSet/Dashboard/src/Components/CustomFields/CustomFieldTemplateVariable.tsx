import { CustomFieldFormCopy } from "./CustomFieldSettingsCopy";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getCustomFieldTemplateVariableName,
  isValidCustomFieldVariableKey,
} from "Common/Types/CustomField/CustomFieldVariableKey";
import ObjectID from "Common/Types/ObjectID";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * An incident custom field's template variable, read only, with a button
 * that copies it: the last line of the field's Edit form, under Advanced.
 *
 * The settings table no longer has a Template Variable column (it lists a
 * field's name and type only), and the note and subscriber template editors
 * list every field's variable where it is placed. This is for whoever wants
 * it from the field itself - a webhook integration, say.
 *
 * The key is nobody's to type: made from the name when the field was
 * created, never changed, ignored when sent. So the form does not hold it -
 * a form value would be sent back on save - and it is read here, by the
 * field's id, on its own.
 */

export interface ComponentProps {
  // The definition model: one with a variableKey column (IncidentCustomField).
  modelType: DatabaseBaseModelType;
  // The field being edited.
  modelId: string | ObjectID | undefined;
}

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; variableKey: string }
  | { status: "failed" };

const CustomFieldTemplateVariable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const modelId: string | undefined = props.modelId
    ? props.modelId.toString()
    : undefined;

  useEffect(() => {
    let isMounted: boolean = true;

    if (!modelId) {
      setState({ status: "failed" });
      return;
    }

    setState({ status: "loading" });

    ModelAPI.getItem<BaseModel>({
      modelType: props.modelType,
      id: new ObjectID(modelId),
      select: {
        variableKey: true,
      } as never,
    })
      .then((item: BaseModel | null) => {
        if (!isMounted) {
          return;
        }

        const variableKey: unknown = item
          ? (item as unknown as Record<string, unknown>)["variableKey"]
          : undefined;

        if (
          typeof variableKey === "string" &&
          isValidCustomFieldVariableKey(variableKey)
        ) {
          setState({ status: "loaded", variableKey: variableKey });
          return;
        }

        setState({ status: "failed" });
      })
      .catch(() => {
        if (isMounted) {
          setState({ status: "failed" });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [modelId, props.modelType]);

  if (state.status === "loading") {
    return (
      <p
        className="mt-1 text-sm text-gray-400"
        data-testid="custom-field-template-variable-loading"
      >
        …
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid="custom-field-template-variable-not-loaded"
      >
        {translateString(CustomFieldFormCopy.templateVariableNotLoaded) ??
          CustomFieldFormCopy.templateVariableNotLoaded}
      </p>
    );
  }

  const variable: string = `{{${getCustomFieldTemplateVariableName(
    state.variableKey,
  )}}}`;

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <code
        className="min-w-0 flex-1 break-all font-mono text-xs text-gray-800"
        data-testid="custom-field-template-variable"
      >
        {variable}
      </code>
      <CopyTextButton
        textToBeCopied={variable}
        size="sm"
        title={translateString("Copy") ?? "Copy"}
      />
    </div>
  );
};

export default CustomFieldTemplateVariable;
