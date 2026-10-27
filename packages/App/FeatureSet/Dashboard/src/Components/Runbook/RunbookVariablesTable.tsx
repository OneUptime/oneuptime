import RunnersElement from "../Runner/Runners";
import RunnerChoicesLoader, { GlobalRunnerRow } from "../Runner/RunnerChoices";
import {
  ACCESS_STEP_TITLE,
  COPY_REFERENCE_TITLE,
  EVERY_RUNNER_TEXT,
  GLOBAL_RUNNERS_CAN_USE_DESCRIPTION,
  GLOBAL_RUNNERS_CAN_USE_TITLE,
  GLOBAL_RUNNERS_TEXT,
  GLOBAL_VARIABLES_DESCRIPTION,
  GLOBAL_VARIABLES_EMPTY,
  GLOBAL_VARIABLES_EMPTY_READ_ONLY,
  GLOBAL_VARIABLES_TITLE,
  NAME_DESCRIPTION,
  NEW_VALUE_TITLE,
  REPLACE_VALUE_DESCRIPTION,
  REPLACE_VALUE_OF_TITLE,
  REPLACE_VALUE_TITLE,
  RUNBOOK_VARIABLES_DESCRIPTION,
  RUNBOOK_VARIABLES_EMPTY,
  RUNBOOK_VARIABLES_TITLE,
  SECRET_DESCRIPTION,
  SECRET_TITLE,
  SECRET_VALUE_DESCRIPTION,
  SECRET_VALUE_HIDDEN_TEXT,
  SECRET_VALUE_PLACEHOLDER,
  SECRET_VALUE_TITLE,
  VALUE_DESCRIPTION,
  VALUE_TITLE,
  VARIABLE_STEP_TITLE,
  YOUR_RUNNERS_DESCRIPTION,
  YOUR_RUNNERS_TITLE,
  getValueShown,
  getVariableReferenceText,
} from "./RunbookVariableCopy";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import { useAsyncEffect } from "use-async-effect";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * THE RUNBOOK VARIABLES LIST - the project's own (Runbooks > Settings >
 * Global Variables) or one runbook's (its Settings > Variables).
 *
 * A row is the variable's name - with a button that copies what a step
 * writes to use it ({{global.variables.NAME}}), and its description under
 * it - then its value, or for a secret only that it is one, then which
 * Runners get it. Three columns and the row's button fit a laptop's card
 * beside the side menu: the card's description says once how a step writes
 * a variable, rather than every row repeating it, and the description has
 * no column of its own. Create asks the name, whether it is a secret and
 * the value, the description folded under More fields; for a secret, a
 * second step asks who may use it, as the runbook secrets page did. A
 * secret's value is never read back: Replace Value sets a new one.
 */

export interface ComponentProps {
  // The runbook whose own variables these are; left out, the global ones.
  runbookId?: ObjectID | undefined;
}

// What the page knows about global Runners, for the Who can use it step.
interface GlobalRunnerAccess {
  hasGlobalRunners: boolean;
  projectUsesGlobalRunners: boolean;
}

function isSecretValue(values: FormValues<RunbookVariable>): boolean {
  return Boolean((values as JSONObject)["isSecret"]);
}

const RunbookVariablesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isGlobal: boolean = !props.runbookId;
  const translator: Translator = useTranslator();

  const [replacing, setReplacing] = useState<RunbookVariable | null>(null);
  const [isReplacing, setIsReplacing] = useState<boolean>(false);
  const [replaceError, setReplaceError] = useState<string>("");

  const [globalRunnerAccess, setGlobalRunnerAccess] =
    useState<GlobalRunnerAccess | null>(null);

  /*
   * Replace Value writes through ModelAPI directly, which the table's own
   * edit gating never sees: it is offered as Edit would be - locked, saying
   * why, to someone who may read variables but not change them.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new RunbookVariable(),
    ModelAction.Update,
  );

  /*
   * Whether the reader may add a variable: an empty list tells someone who
   * may not (a Runbook Admin, who reads variables to pick them in steps)
   * who adds them, rather than to add one. Before the permission snapshot
   * lands, nobody is told they may not.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new RunbookVariable(),
    ModelAction.Create,
  );
  const mayCreate: boolean = createGate.isAllowed || !createGate.disabledReason;

  useAsyncEffect(async () => {
    const [globalRunners, projectUsesGlobalRunners]: [
      Array<GlobalRunnerRow>,
      boolean,
    ] = await Promise.all([
      RunnerChoicesLoader.loadGlobalRunners(),
      RunnerChoicesLoader.loadProjectUsesGlobalRunners(
        ProjectUtil.getCurrentProjectId()!,
      ),
    ]);

    setGlobalRunnerAccess({
      hasGlobalRunners: globalRunners.length > 0,
      projectUsesGlobalRunners,
    });
  }, []);

  if (!globalRunnerAccess) {
    return <ComponentLoader />;
  }

  const hasGlobalRunners: boolean = globalRunnerAccess.hasGlobalRunners;

  // What most people leave alone: the description.
  const moreFields: FormFieldCollapsibleSection<RunbookVariable> =
    getAdvancedFormSection<RunbookVariable>();

  /*
   * Who may use a secret: the global Runners - asked only on a server that
   * has them - and the project's own Runners. A plain value reaches every
   * Runner, so the step is not shown for one.
   */
  const accessFields: Array<Field<RunbookVariable>> = [
    ...(hasGlobalRunners
      ? [
          {
            field: {
              isAvailableToGlobalRunners: true,
            },
            title: GLOBAL_RUNNERS_CAN_USE_TITLE,
            stepId: "access",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: GLOBAL_RUNNERS_CAN_USE_DESCRIPTION,
            showIf: isSecretValue,
          } as Field<RunbookVariable>,
        ]
      : []),
    {
      field: {
        runners: true,
      },
      title: YOUR_RUNNERS_TITLE,
      stepId: "access",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Runner,
        labelField: "name",
        valueField: "_id",
      },
      /*
       * A secret no Runner may use would fill in nothing: it needs Runners
       * of the project's own unless global Runners may use it - and on a
       * server with none, always.
       */
      required: (values: FormValues<RunbookVariable>): boolean => {
        return (
          isSecretValue(values) &&
          !(
            hasGlobalRunners &&
            Boolean((values as JSONObject)["isAvailableToGlobalRunners"])
          )
        );
      },
      description: YOUR_RUNNERS_DESCRIPTION,
      placeholder: "Select Runners",
      showIf: isSecretValue,
    },
  ];

  return (
    <Fragment>
      <ModelTable<RunbookVariable>
        userPreferencesKey={
          isGlobal
            ? "runbook-global-variables-table"
            : "runbook-variables-table"
        }
        modelType={RunbookVariable}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          runbookId: props.runbookId ? props.runbookId : new IsNull(),
        }}
        id={
          isGlobal
            ? "runbook-global-variables-table"
            : "runbook-variables-table"
        }
        name={isGlobal ? "Runbooks > Global Variables" : "Runbook > Variables"}
        singularName="Variable"
        pluralName="Variables"
        saveFilterProps={{
          tableId: isGlobal
            ? "runbook-global-variables-table"
            : "runbook-variables-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        actionButtons={[
          {
            title: REPLACE_VALUE_TITLE,
            icon: IconProp.Key,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: RunbookVariable): boolean => {
              return (
                Boolean(item.isSecret) &&
                (updateGate.isAllowed || Boolean(updateGate.disabledReason))
              );
            },
            disabled: !updateGate.isAllowed,
            ...(updateGate.isAllowed
              ? {}
              : { tooltip: updateGate.disabledReason }),
            onClick: async (
              item: RunbookVariable,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setReplacing(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        cardProps={{
          title: isGlobal ? GLOBAL_VARIABLES_TITLE : RUNBOOK_VARIABLES_TITLE,
          description: (
            <TranslatedSentence
              template={
                isGlobal
                  ? GLOBAL_VARIABLES_DESCRIPTION
                  : RUNBOOK_VARIABLES_DESCRIPTION
              }
              slots={{
                reference: (
                  <code
                    className="font-mono text-xs text-gray-700"
                    data-testid="runbook-variables-reference-syntax"
                  >
                    {getVariableReferenceText({ name: "NAME", isGlobal })}
                  </code>
                ),
              }}
            />
          ),
        }}
        noItemsMessage={
          isGlobal
            ? mayCreate
              ? GLOBAL_VARIABLES_EMPTY
              : GLOBAL_VARIABLES_EMPTY_READ_ONLY
            : RUNBOOK_VARIABLES_EMPTY
        }
        /*
         * A new variable starts secret: what runbooks keep here is mostly
         * keys, passwords and tokens, and a value made plain by mistake
         * would already have been read. A new secret is open to the global
         * Runners while the project uses them, as a JavaScript step that
         * picks no Runner runs there.
         */
        createInitialValues={{
          isSecret: true,
          isAvailableToGlobalRunners:
            hasGlobalRunners && globalRunnerAccess.projectUsesGlobalRunners,
        }}
        onBeforeCreate={(item: RunbookVariable): Promise<RunbookVariable> => {
          if (props.runbookId) {
            item.runbookId = props.runbookId;
          }

          return Promise.resolve(item);
        }}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: VARIABLE_STEP_TITLE, id: "variable" },
          {
            title: ACCESS_STEP_TITLE,
            id: "access",
            showIf: isSecretValue,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "variable",
            fieldType: FormFieldSchemaType.Text,
            description: NAME_DESCRIPTION,
            required: true,
            placeholder: "PROD_DB_SSH_KEY",
            validation: {
              minLength: 1,
              maxLength: 100,
              noSpaces: true,
              noSpecialCharacters: true,
            },
            disableSpellCheck: true,
          },
          /*
           * Fixed once made: a secret never becomes readable, and a value
           * shown once is not secret any more.
           */
          {
            field: {
              isSecret: true,
            },
            title: SECRET_TITLE,
            stepId: "variable",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: SECRET_DESCRIPTION,
            doNotShowWhenEditing: true,
          },
          {
            field: {
              value: true,
            },
            title: VALUE_TITLE,
            stepId: "variable",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            description: VALUE_DESCRIPTION,
            placeholder: "10.0.4.21",
            disableSpellCheck: true,
            showIf: (values: FormValues<RunbookVariable>): boolean => {
              return !isSecretValue(values);
            },
          },
          {
            field: {
              secretValue: true,
            },
            title: SECRET_VALUE_TITLE,
            stepId: "variable",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            description: SECRET_VALUE_DESCRIPTION,
            placeholder: SECRET_VALUE_PLACEHOLDER,
            disableSpellCheck: true,
            doNotShowWhenEditing: true,
            showIf: isSecretValue,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "variable",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            hideColumnDescription: true,
            placeholder: "Private key of the deploy user on the database hosts",
            collapsibleSection: moreFields,
          },
          ...accessFields,
        ]}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isSecret: true,
            },
            title: SECRET_TITLE,
            type: FieldType.Boolean,
          },
        ]}
        selectMoreFields={{
          isSecret: true,
          isAvailableToGlobalRunners: true,
          value: true,
          description: true,
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-md",
            getElement: (item: RunbookVariable): ReactElement => {
              const reference: string = getVariableReferenceText({
                name: item.name || "",
                isGlobal,
              });

              return (
                /*
                 * One grid track that may shrink (grid-cols-1 is
                 * minmax(0, 1fr)), never under 12rem: a long name or
                 * description never widens the column past the card. The
                 * name breaks anywhere - it has no spaces, and its end is
                 * often what tells two apart - and the description shows
                 * two lines.
                 */
                <div className="grid min-w-[12rem] grid-cols-1">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <span
                      className="min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere]"
                      data-testid="runbook-variable-name"
                    >
                      {item.name}
                    </span>
                    <span className="mt-0.5 flex shrink-0">
                      <CopyTextButton
                        textToBeCopied={reference}
                        iconOnly={true}
                        title={translator.translateTemplate(
                          COPY_REFERENCE_TITLE,
                          { reference },
                        )}
                      />
                    </span>
                  </div>
                  {item.description ? (
                    <p
                      className="line-clamp-2 text-sm font-normal text-gray-500 [overflow-wrap:anywhere]"
                      title={item.description}
                      data-testid="runbook-variable-description"
                    >
                      {item.description}
                    </p>
                  ) : null}
                </div>
              );
            },
          },
          {
            field: {
              value: true,
            },
            title: VALUE_TITLE,
            type: FieldType.Text,
            getElement: (item: RunbookVariable): ReactElement => {
              if (item.isSecret) {
                return (
                  <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    <Icon
                      icon={IconProp.Lock}
                      size={SizeProp.Smaller}
                      className="h-3 w-3"
                    />
                    {translator.translateText(SECRET_VALUE_HIDDEN_TEXT)}
                  </span>
                );
              }

              const shown: string = getValueShown(item.value);

              return (
                /*
                 * One line, cut to the room the column has (6rem at the
                 * least) rather than widening it, with the value under the
                 * pointer.
                 */
                <span className="grid min-w-[6rem] grid-cols-1">
                  <span
                    className="truncate font-mono text-xs text-gray-700"
                    title={shown}
                    data-testid="runbook-variable-value"
                  >
                    {shown}
                  </span>
                </span>
              );
            },
          },
          {
            field: {
              runners: {
                name: true,
                _id: true,
              },
            },
            title: "Runners",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: RunbookVariable): ReactElement => {
              if (!item.isSecret) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText(EVERY_RUNNER_TEXT)}
                  </span>
                );
              }

              return (
                <div className="flex flex-col gap-1">
                  {hasGlobalRunners && item.isAvailableToGlobalRunners ? (
                    <span className="text-sm text-gray-700">
                      {translator.translateText(GLOBAL_RUNNERS_TEXT)}
                    </span>
                  ) : null}
                  {(item.runners || []).length > 0 ||
                  !(hasGlobalRunners && item.isAvailableToGlobalRunners) ? (
                    <RunnersElement runners={item.runners || []} />
                  ) : null}
                </div>
              );
            },
          },
        ]}
      />

      {replacing ? (
        <BasicFormModal
          /*
           * Which variable it replaces: the dialog covers the row it was
           * opened from.
           */
          title={translator.translateTemplate(REPLACE_VALUE_OF_TITLE, {
            name: replacing.name || "",
          })}
          description={REPLACE_VALUE_DESCRIPTION}
          name="Runbook Variable > Replace Value"
          isLoading={isReplacing}
          error={replaceError || undefined}
          submitButtonText={REPLACE_VALUE_TITLE}
          onClose={() => {
            setIsReplacing(false);
            setReplaceError("");
            setReplacing(null);
          }}
          onSubmit={async (data: JSONObject) => {
            setIsReplacing(true);
            setReplaceError("");

            try {
              await ModelAPI.updateById<RunbookVariable>({
                modelType: RunbookVariable,
                id: replacing.id!,
                data: {
                  secretValue: data["secretValue"],
                },
              });

              setReplacing(null);
            } catch (err) {
              setReplaceError(API.getFriendlyMessage(err));
            } finally {
              setIsReplacing(false);
            }
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  secretValue: true,
                },
                /*
                 * No line under it: the dialog's own says the value is
                 * encrypted and the old one gone.
                 */
                title: NEW_VALUE_TITLE,
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder: SECRET_VALUE_PLACEHOLDER,
                disableSpellCheck: true,
              },
            ],
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default RunbookVariablesTable;
