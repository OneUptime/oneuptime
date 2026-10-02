import { FormPaletteState } from "../FormBuilderState";
import FormsCopy, { FORM_QUESTION_TYPE_TEXT } from "../FormsCopy";
import { FORM_ANSWER_TYPE_ICONS } from "./QuestionInputPreview";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  FORM_QUESTION_TYPES,
  FORM_SUBMITTER_FIELD_DEFINITIONS,
  FormSubmitterField,
} from "Common/Types/Form/FormField";
import { FormCustomFieldDefinition } from "Common/Types/Form/FormPublic";
import { FormTargetFieldDefinition } from "Common/Types/Form/FormTargetCatalog";
import FormTargetType from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The form builder's "Add a Question" list: questions of the form's own by
 * how they are answered, the fields of what the form creates (an incident's
 * title, its severity, a maintenance window's start), the target's custom
 * fields, and who is submitting. A linked field is asked once, so once a
 * question asks it, it shows as added.
 */

export type PaletteItem =
  | { kind: "question"; type: CustomFieldType; label: string }
  | { kind: "target"; definition: FormTargetFieldDefinition }
  | { kind: "customField"; definition: FormCustomFieldDefinition }
  | { kind: "submitter"; submitterField: FormSubmitterField };

export interface ComponentProps {
  targetType: FormTargetType;
  palette: FormPaletteState;
  onAdd: (item: PaletteItem) => void;
}

interface EntryProps {
  icon: IconProp;
  title: string;
  description?: string | undefined;
  isAdded: boolean;
  isDisabled: boolean;
  dataTestId: string;
  onClick: () => void;
}

const PaletteEntry: FunctionComponent<EntryProps> = (
  props: EntryProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        disabled={props.isAdded || props.isDisabled}
        data-testid={props.dataTestId}
        onClick={props.onClick}
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            props.isAdded || props.isDisabled
              ? "bg-gray-100 text-gray-400"
              : "bg-indigo-50 text-indigo-600 group-hover:bg-white"
          }`}
        >
          <Icon icon={props.icon} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`flex items-center gap-2 text-sm font-medium ${
              props.isAdded || props.isDisabled
                ? "text-gray-400"
                : "text-gray-900"
            }`}
          >
            <span className="truncate">{props.title}</span>
            {props.isAdded ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                <Icon icon={IconProp.Check} className="h-3 w-3" />
                {tx(FormsCopy.paletteAdded)}
              </span>
            ) : (
              <></>
            )}
          </span>
          {props.description ? (
            <span className="mt-0.5 block text-xs text-gray-500">
              {props.description}
            </span>
          ) : (
            <></>
          )}
        </span>
      </button>
    </li>
  );
};

interface GroupProps {
  title: string;
  children: ReactElement | Array<ReactElement>;
  dataTestId: string;
}

const PaletteGroup: FunctionComponent<GroupProps> = (
  props: GroupProps,
): ReactElement => {
  return (
    <section data-testid={props.dataTestId}>
      <h4 className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {props.title}
      </h4>
      <ul className="mt-1 space-y-0.5">{props.children}</ul>
    </section>
  );
};

const QuestionPalette: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const isFull: boolean = props.palette.isFull;
  const isIncident: boolean = props.targetType === FormTargetType.Incident;

  const customFieldsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[
      isIncident
        ? PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS
        : PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
    ] as Route,
  );

  return (
    <div className="space-y-5" data-testid="form-question-palette">
      {isFull ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {tx(FormsCopy.paletteFull)}
        </p>
      ) : (
        <></>
      )}

      <PaletteGroup
        title={tx(FormsCopy.paletteQuestions)}
        dataTestId="form-palette-questions"
      >
        {FORM_QUESTION_TYPES.map((type: CustomFieldType): ReactElement => {
          return (
            <PaletteEntry
              key={type}
              icon={FORM_ANSWER_TYPE_ICONS[type]}
              title={tx(FORM_QUESTION_TYPE_TEXT[type].title)}
              description={tx(FORM_QUESTION_TYPE_TEXT[type].description)}
              isAdded={false}
              isDisabled={isFull}
              dataTestId={`form-palette-question-${type}`}
              onClick={() => {
                props.onAdd({
                  kind: "question",
                  type: type,
                  label: tx(FormsCopy.newQuestionLabel),
                });
              }}
            />
          );
        })}
      </PaletteGroup>

      <PaletteGroup
        title={tx(
          isIncident
            ? FormsCopy.paletteIncidentFields
            : FormsCopy.paletteScheduledMaintenanceFields,
        )}
        dataTestId="form-palette-target-fields"
      >
        {props.palette.targetFields.map(
          (entry: {
            definition: FormTargetFieldDefinition;
            isAdded: boolean;
          }): ReactElement => {
            return (
              <PaletteEntry
                key={entry.definition.key}
                icon={FORM_ANSWER_TYPE_ICONS[entry.definition.inputType]}
                title={tx(entry.definition.title)}
                description={tx(entry.definition.description)}
                isAdded={entry.isAdded}
                isDisabled={isFull}
                dataTestId={`form-palette-target-${entry.definition.key}`}
                onClick={() => {
                  props.onAdd({ kind: "target", definition: entry.definition });
                }}
              />
            );
          },
        )}
      </PaletteGroup>

      <PaletteGroup
        title={tx(FormsCopy.paletteCustomFields)}
        dataTestId="form-palette-custom-fields"
      >
        {props.palette.customFields.length > 0 ? (
          props.palette.customFields.map(
            (entry: {
              definition: FormCustomFieldDefinition;
              isAdded: boolean;
            }): ReactElement => {
              const type: CustomFieldType = (
                Object.values(CustomFieldType) as Array<string>
              ).includes(String(entry.definition.customFieldType))
                ? (entry.definition.customFieldType as CustomFieldType)
                : CustomFieldType.Text;

              return (
                <PaletteEntry
                  key={entry.definition.id}
                  icon={FORM_ANSWER_TYPE_ICONS[type]}
                  title={entry.definition.name}
                  description={tx(FORM_QUESTION_TYPE_TEXT[type].title)}
                  isAdded={entry.isAdded}
                  isDisabled={isFull}
                  dataTestId={`form-palette-custom-field-${entry.definition.id}`}
                  onClick={() => {
                    props.onAdd({
                      kind: "customField",
                      definition: entry.definition,
                    });
                  }}
                />
              );
            },
          )
        ) : (
          <li className="px-2 py-1 text-xs text-gray-500">
            <p>
              {tx(
                isIncident
                  ? FormsCopy.noCustomFieldsIncident
                  : FormsCopy.noCustomFieldsScheduledMaintenance,
              )}
            </p>
            <Link
              className="mt-1 inline-block font-medium text-indigo-600 hover:text-indigo-500"
              to={customFieldsRoute}
            >
              {tx(FormsCopy.manageCustomFields)}
            </Link>
          </li>
        )}
      </PaletteGroup>

      <PaletteGroup
        title={tx(FormsCopy.paletteSubmitter)}
        dataTestId="form-palette-submitter"
      >
        {props.palette.submitterFields.map(
          (entry: {
            submitterField: FormSubmitterField;
            isAdded: boolean;
          }): ReactElement => {
            return (
              <PaletteEntry
                key={entry.submitterField}
                icon={
                  entry.submitterField === FormSubmitterField.Email
                    ? IconProp.Email
                    : IconProp.User
                }
                title={tx(
                  FORM_SUBMITTER_FIELD_DEFINITIONS[entry.submitterField].title,
                )}
                description={tx(
                  FORM_SUBMITTER_FIELD_DEFINITIONS[entry.submitterField]
                    .description,
                )}
                isAdded={entry.isAdded}
                isDisabled={isFull}
                dataTestId={`form-palette-submitter-${entry.submitterField}`}
                onClick={() => {
                  props.onAdd({
                    kind: "submitter",
                    submitterField: entry.submitterField,
                  });
                }}
              />
            );
          },
        )}
      </PaletteGroup>
    </div>
  );
};

export default QuestionPalette;
