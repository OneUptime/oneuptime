import AccessLogFormatField from "./AccessLogFormatField";
import {
  ACCESS_LOG_FORMAT_FIELD_DESCRIPTION,
  ACCESS_LOG_FORMAT_FIELD_TITLE,
  ACCESS_LOG_FORMAT_TITLE,
  TRUSTED_PROXIES_TEST_IDS,
  getAccessLogFormatProblemText,
  getAccessLogFormatSummary,
} from "../SecurityTrustedProxiesCopy";
import {
  canUpdateProjectColumns,
  getProjectColumnsPermissionMessage,
} from "../../../Pages/Settings/ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  AccessLogFormat,
  readAccessLogFormat,
} from "Common/Utils/SecurityEvent/LogParsers/AccessLogFormat";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// The column the format is kept in.
const COLUMN: string = "securityAccessLogFormat";

/*
 * LOG FORMAT, ON ACCESS LOGS (#11048): the nginx log_format the project's
 * access logs are written in, under the card's switch. It says what
 * OneUptime reads of a line in it - where the address that connected is,
 * and where X-Forwarded-For is, or that it logs none - or that none is
 * given, and shows the format as it was given. Edit opens a dialog with
 * one field (AccessLogFormatField), saved as the switch beside it is set:
 * by a Project Owner, a Project Admin or a Security Admin; anyone else sees
 * Edit locked, with who may.
 */

export interface ComponentProps {
  // The format as the project holds it, when the card read it.
  value: string | null | undefined;
  // Told what was saved, for the fold's chip.
  onSaved?: ((value: string) => void) | undefined;
}

const AccessLogFormatDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [value, setValue] = useState<string>(props.value || "");
  const [isEditing, setIsEditing] = useState<boolean>(false);

  useEffect(() => {
    setValue(props.value || "");
  }, [props.value]);

  const format: AccessLogFormat | null = readAccessLogFormat(value).format;
  const isEditable: boolean = canUpdateProjectColumns([COLUMN]);

  return (
    <div
      className="mt-4 border-t border-gray-100 pt-4"
      data-testid={TRUSTED_PROXIES_TEST_IDS.accessLogFormat}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText(ACCESS_LOG_FORMAT_TITLE) ||
              ACCESS_LOG_FORMAT_TITLE}
          </p>
          <p
            className="text-sm text-gray-600"
            data-testid={`${TRUSTED_PROXIES_TEST_IDS.accessLogFormat}-reads`}
          >
            {getAccessLogFormatSummary(format, translator)}
          </p>
        </div>
        <Button
          title="Edit"
          icon={IconProp.Edit}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          disabled={!isEditable}
          tooltip={
            isEditable
              ? undefined
              : getProjectColumnsPermissionMessage([COLUMN])
          }
          dataTestId={TRUSTED_PROXIES_TEST_IDS.accessLogFormatEdit}
          onClick={() => {
            setIsEditing(true);
          }}
        />
      </div>

      {format ? (
        <pre
          className="mt-3 whitespace-pre-wrap break-all rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800"
          data-testid={`${TRUSTED_PROXIES_TEST_IDS.accessLogFormat}-text`}
        >
          {value.trim()}
        </pre>
      ) : (
        <></>
      )}

      {isEditing && projectId ? (
        <ModelFormModal<Project>
          modelType={Project}
          name="security-access-log-format"
          title={ACCESS_LOG_FORMAT_TITLE}
          submitButtonText="Save"
          modelIdToEdit={projectId}
          onClose={() => {
            setIsEditing(false);
          }}
          onSuccess={(project: Project) => {
            const saved: string = (
              project.securityAccessLogFormat || ""
            ).trim();

            setIsEditing(false);
            setValue(saved);
            props.onSaved?.(saved);
          }}
          formProps={{
            name: "security-access-log-format-form",
            modelType: Project,
            id: "security-access-log-format-form",
            formType: FormType.Update,
            fields: [
              {
                field: { securityAccessLogFormat: true },
                title: ACCESS_LOG_FORMAT_FIELD_TITLE,
                description: ACCESS_LOG_FORMAT_FIELD_DESCRIPTION,
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                customValidation: (
                  values: FormValues<Project>,
                ): string | null => {
                  return getAccessLogFormatProblemText(
                    (values as Record<string, unknown>)[COLUMN] as
                      | string
                      | undefined,
                    translator,
                  );
                },
                getCustomElement: (
                  values: FormValues<Project>,
                  elementProps: CustomElementProps,
                ): ReactElement => {
                  const current: unknown = (values as Record<string, unknown>)[
                    COLUMN
                  ];

                  return (
                    <AccessLogFormatField
                      value={typeof current === "string" ? current : ""}
                      error={elementProps.error}
                      ariaLabelledby={elementProps.ariaLabelledby}
                      ariaDescribedby={elementProps.ariaDescribedby}
                      onChange={(next: string) => {
                        elementProps.onChange?.(next);
                      }}
                    />
                  );
                },
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default AccessLogFormatDetails;
