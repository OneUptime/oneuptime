import Color from "Common/Types/Color";
import { JSONValue } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import EpisodeFromRecords, {
  NewEpisodePrefill,
  RecordForNewEpisode,
} from "Common/Utils/Episode/EpisodeFromRecords";
import { SeverityForMapping } from "Common/Utils/Incident/IncidentFromAlerts";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { toIdString } from "../IncidentAlert/LinkIncidentAlertModal";
import { EpisodeMemberKindConfig } from "./EpisodeMemberKinds";
import {
  fetchRecordsForNewEpisode,
  fetchSeverities,
} from "./EpisodeMembersApi";

/*
 * "Add to New Episode" on an alerts or incidents list: an episode made for
 * the selected ones, which are added to it. It asks only what an episode
 * needs to exist - a title and a severity - and starts both from what is
 * selected (EpisodeFromRecords): the most severe one's severity, and its
 * title unless it is private. Owners, on-call policies, labels and notes
 * are added on the episode's own page.
 *
 * Asking is all this does: the list's bulk action creates the episode with
 * them, in one request, and reports it.
 */

export interface NewEpisodeValues {
  title: string;
  severityId: string | undefined;
}

export interface NewEpisodeFormData {
  title?: string | undefined;
  severityId?: JSONValue | undefined;
}

export interface ComponentProps {
  config: EpisodeMemberKindConfig;
  // What is being added, by id, in the order it was selected.
  recordIds: Array<string>;
  onClose: () => void;
  onCreate: (values: NewEpisodeValues) => void;
}

const AddToNewEpisodeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const config: EpisodeMemberKindConfig = props.config;
  const count: number = props.recordIds.length;

  const itemsName: TranslatableTerm = translatableTerm(config.pluralTitle, {
    inSentence: true,
  });
  const itemTitle: TranslatableTerm = translatableTerm(config.singularTitle);
  const itemsTitle: TranslatableTerm = translatableTerm(config.pluralTitle);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [severityOptions, setSeverityOptions] = useState<
    Array<DropdownOption>
  >([]);
  const [initialValues, setInitialValues] = useState<NewEpisodeFormData>({});
  const [inAnotherEpisode, setInAnotherEpisode] = useState<number>(0);

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * Each read can fail on its own: without the records the form starts
       * empty, without the severities it offers none. Either way it can
       * still be filled in.
       */
      const [records, severities] = await Promise.all([
        fetchRecordsForNewEpisode({ config: config, ids: props.recordIds })
          .then(
            (
              found: Array<RecordForNewEpisode & { otherEpisodeId?: string }>,
            ) => {
              return found;
            },
          )
          .catch(() => {
            return [] as Array<
              RecordForNewEpisode & { otherEpisodeId?: string }
            >;
          }),
        fetchSeverities({ config: config }).catch(() => {
          return [] as Array<SeverityForMapping & { color?: Color | undefined }>;
        }),
      ]);

      if (isCancelled) {
        return;
      }

      const prefill: NewEpisodePrefill = EpisodeFromRecords.getPrefill({
        records: records,
        severities: severities,
      });

      setSeverityOptions(
        severities.map(
          (
            severity: SeverityForMapping & { color?: Color | undefined },
          ): DropdownOption => {
            return {
              label: severity.name || "",
              value: severity.id,
              ...(severity.color ? { color: severity.color } : {}),
            };
          },
        ),
      );

      setInitialValues({
        title: prefill.title,
        ...(prefill.severityId ? { severityId: prefill.severityId } : {}),
      });

      setInAnotherEpisode(
        records.filter(
          (
            record: RecordForNewEpisode & { otherEpisodeId?: string },
          ): boolean => {
            return Boolean(record.otherEpisodeId);
          },
        ).length,
      );

      setIsLoading(false);
    };

    load().catch(() => {
      if (!isCancelled) {
        setIsLoading(false);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Two whole sentences, run together the way the reader's script does it.
  const description: string = joinSentences([
    translator.translateTemplate(
      "Creates an episode with the selected {{itemsName}} in it. You can add owners, on-call policies and notes on its page.",
      { itemsName },
    ),
    inAnotherEpisode > 0
      ? translator.translatePlural(
          {
            one: "{{count}} of them is already in another episode, and stays there too.",
            other:
              "{{count}} of them are already in another episode, and stay there too.",
          },
          inAnotherEpisode,
        )
      : "",
  ]);

  return (
    <BasicFormModal<NewEpisodeFormData>
      title={translator.translatePlural(
        {
          one: "Add {{count}} {{itemName}} to a New Episode",
          other: "Add {{count}} {{itemsName}} to a New Episode",
        },
        count,
        { itemName: itemTitle, itemsName: itemsTitle },
      )}
      name="Add to New Episode"
      description={description}
      isLoading={isLoading}
      onClose={props.onClose}
      submitButtonText="Create Episode"
      onSubmit={(data: FormValues<NewEpisodeFormData>) => {
        const severityId: string = toIdString(
          (data as NewEpisodeFormData).severityId,
        );

        props.onCreate({
          title: ((data as NewEpisodeFormData).title || "").trim(),
          severityId: severityId || undefined,
        });
      }}
      formProps={{
        id: "add-to-new-episode-form",
        initialValues: initialValues as FormValues<NewEpisodeFormData>,
        fields: [
          {
            field: {
              title: true,
            },
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Episode title",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              severityId: true,
            },
            title: "Severity",
            description: translator.translateTemplate(
              "Starts as the most severe of the selected {{itemsName}}.",
              { itemsName },
            ),
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: severityOptions,
            required: false,
            placeholder: "Select a severity",
          },
        ],
      }}
    />
  );
};

export default AddToNewEpisodeModal;
