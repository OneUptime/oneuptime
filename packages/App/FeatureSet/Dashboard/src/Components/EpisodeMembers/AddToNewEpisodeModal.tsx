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
  fetchIsLimitedToOneEpisode,
  fetchRecordsForNewEpisode,
  fetchSeverities,
} from "./EpisodeMembersApi";
import NothingToAddToEpisodeModal from "./NothingToAddToEpisode";

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
 *
 * In a project that allows one in only one episode (EpisodeSingleMembership,
 * read when the dialog opens), the selected ones that are in an episode
 * already are left out of the new one - the description says how many, the
 * title and severity start from the rest, and the result lists them as not
 * added, with why. When every one is in an episode, there is nothing to
 * create an episode with: the dialog says so, with only Close.
 */

export interface NewEpisodeValues {
  title: string;
  severityId: string | undefined;
  /*
   * The selected ones left out because they are in an episode already and
   * the project allows one in only one: none when it allows several.
   */
  leftOutIds?: Array<string> | undefined;
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
  const [severityOptions, setSeverityOptions] = useState<Array<DropdownOption>>(
    [],
  );
  const [initialValues, setInitialValues] = useState<NewEpisodeFormData>({});
  const [inAnotherEpisode, setInAnotherEpisode] = useState<number>(0);
  /*
   * Whether the project allows one in only one episode, and - when it does
   * - the selected ones in an episode already, left out of the new one.
   */
  const [isLimitedToOneEpisode, setIsLimitedToOneEpisode] =
    useState<boolean>(false);
  const [leftOutIds, setLeftOutIds] = useState<Array<string>>([]);
  // Every selected one was read, so "all of them" is known, not assumed.
  const [areAllRead, setAreAllRead] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * Each read can fail on its own: without the records the form starts
       * empty, without the severities it offers none. Either way it can
       * still be filled in.
       */
      const [records, severities, isLimited] = await Promise.all([
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
          return [] as Array<
            SeverityForMapping & { color?: Color | undefined }
          >;
        }),
        // Never rejects: a project it cannot read allows several.
        fetchIsLimitedToOneEpisode({ config: config }),
      ]);

      if (isCancelled) {
        return;
      }

      /*
       * Allowed in only one episode: the ones in an episode already are left
       * out, and the new episode starts from the rest.
       */
      const heldRecords: Array<
        RecordForNewEpisode & { otherEpisodeId?: string }
      > = isLimited
        ? records.filter(
            (
              record: RecordForNewEpisode & { otherEpisodeId?: string },
            ): boolean => {
              return Boolean(record.otherEpisodeId);
            },
          )
        : [];

      const recordsToAdd: Array<
        RecordForNewEpisode & { otherEpisodeId?: string }
      > = records.filter(
        (
          record: RecordForNewEpisode & { otherEpisodeId?: string },
        ): boolean => {
          return !heldRecords.includes(record);
        },
      );

      const prefill: NewEpisodePrefill = EpisodeFromRecords.getPrefill({
        records: recordsToAdd,
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

      setIsLimitedToOneEpisode(isLimited);
      setLeftOutIds(
        heldRecords.map(
          (
            record: RecordForNewEpisode & { otherEpisodeId?: string },
          ): string => {
            return record.id;
          },
        ),
      );
      setAreAllRead(records.length === props.recordIds.length);

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

  /*
   * The title says what this does, so the description says only what the
   * form leaves out, and what happens to the ones in another episode:
   * whole sentences, run together the way the reader's script does it.
   */
  const description: string = joinSentences([
    translator.translateText(
      "You can add owners, on-call policies and notes on the episode's page.",
    ) || "",
    isLimitedToOneEpisode && leftOutIds.length > 0
      ? translator.translatePlural(
          config.singleMembershipCopy.newEpisodeLeftOut,
          leftOutIds.length,
        )
      : !isLimitedToOneEpisode && inAnotherEpisode > 0
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

  const title: string = translator.translatePlural(
    {
      one: "Add {{count}} {{itemName}} to a New Episode",
      other: "Add {{count}} {{itemsName}} to a New Episode",
    },
    count,
    { itemName: itemTitle, itemsName: itemsTitle },
  );

  /*
   * Allowed in only one episode, and every selected one is in an episode
   * already: there is nothing to create an episode with.
   */
  if (
    !isLoading &&
    isLimitedToOneEpisode &&
    areAllRead &&
    count > 0 &&
    leftOutIds.length === count
  ) {
    return (
      <NothingToAddToEpisodeModal
        config={config}
        title={title}
        count={count}
        dataTestId="add-to-new-episode-nothing-to-add"
        onClose={props.onClose}
      />
    );
  }

  return (
    <BasicFormModal<NewEpisodeFormData>
      title={title}
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
          leftOutIds: leftOutIds,
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
