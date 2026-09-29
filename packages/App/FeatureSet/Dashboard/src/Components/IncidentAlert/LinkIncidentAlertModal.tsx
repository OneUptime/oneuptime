import { isAlreadyLinkedError } from "./IncidentAlertLink";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { INCIDENT_ALERT_ALREADY_LINKED_MESSAGE } from "Common/Types/Incident/IncidentAlertLink";
import { JSONValue } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The dialog that picks the incident (or alert) to link to. Every link entry
 * point opens this one: it lists recent records newest first, labelled with
 * their number - monitor-generated alerts and incidents share titles, so a
 * title alone cannot tell them apart - and still searches every record by
 * title on the server as the user types.
 *
 * The options are fetched when the dialog opens (it is only mounted while
 * open), not when the page loads: most visits never link anything.
 */

export interface LinkIncidentAlertFormData {
  linkedRecordId?: JSONValue | undefined;
}

export interface ComponentProps {
  title: string;
  description: string;
  submitButtonText: string;
  fieldTitle: string;
  fieldDescription: string;
  placeholder: string;
  // What the dropdown searches on the server: Alert or Incident.
  modelType: DatabaseBaseModelType;
  loadOptions: () => Promise<Array<DropdownOption>>;
  /*
   * Links the chosen record, by id. Throwing keeps the dialog open with the
   * error in it, so the user can pick another one.
   */
  onSubmit: (linkedRecordId: string) => Promise<void>;
  onClose: () => void;
}

type ToIdStringFunction = (value: JSONValue | undefined) => string;

/* The dropdown hands back either the raw id or the whole option. */
export const toIdString: ToIdStringFunction = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const optionValue: JSONValue | undefined = (
      value as { value?: JSONValue | undefined }
    ).value;

    if (optionValue !== undefined && optionValue !== null) {
      return optionValue.toString();
    }
  }

  return value.toString();
};

const LinkIncidentAlertModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  /*
   * The form is taken down while a link is being saved, so the choice is
   * carried back into it when the save fails.
   */
  const [selectedId, setSelectedId] = useState<string>("");
  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);

  const initialValues: LinkIncidentAlertFormData = useMemo(() => {
    return selectedId ? { linkedRecordId: selectedId } : {};
  }, [selectedId]);

  useEffect(() => {
    isMountedRef.current = true;

    props
      .loadOptions()
      .then((loadedOptions: Array<DropdownOption>) => {
        if (isMountedRef.current) {
          setOptions(loadedOptions);
        }
      })
      .catch(() => {
        /*
         * The dropdown still searches on the server as the user types, so a
         * failed prefetch only loses the numbered shortlist.
         */
        if (isMountedRef.current) {
          setOptions([]);
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsLoadingOptions(false);
        }
      });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const submit: (data: LinkIncidentAlertFormData) => Promise<void> = async (
    data: LinkIncidentAlertFormData,
  ): Promise<void> => {
    const linkedRecordId: string = toIdString(data.linkedRecordId);

    if (!linkedRecordId) {
      return;
    }

    setSelectedId(linkedRecordId);
    setError("");
    setIsSubmitting(true);

    try {
      await props.onSubmit(linkedRecordId);
    } catch (err) {
      const message: string = API.getFriendlyMessage(err);

      if (isMountedRef.current) {
        setError(
          isAlreadyLinkedError(message)
            ? INCIDENT_ALERT_ALREADY_LINKED_MESSAGE
            : message,
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <BasicFormModal<LinkIncidentAlertFormData>
      title={props.title}
      description={props.description}
      isLoading={isLoadingOptions || isSubmitting}
      onClose={props.onClose}
      submitButtonText={props.submitButtonText}
      onSubmit={async (data: LinkIncidentAlertFormData) => {
        // Never rejects: a failure is shown in the dialog.
        await submit(data);
      }}
      formProps={{
        /*
         * On the form rather than the modal: BasicFormModal hands its own
         * error to the modal body as well, which would show it twice.
         */
        error: error || undefined,
        initialValues: initialValues,
        fields: [
          {
            field: {
              linkedRecordId: true,
            },
            title: props.fieldTitle,
            description: props.fieldDescription,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: props.placeholder,
            dropdownModal: {
              type: props.modelType,
              labelField: "title",
              valueField: "_id",
            },
            dropdownOptions: options,
          },
        ],
      }}
    />
  );
};

export default LinkIncidentAlertModal;
