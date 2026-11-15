import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../Icon/IconProp";
import Text from "../../Text";
import { getCreateFromTemplateArgument } from "../CreateFromTemplate";
import { getAffectedResourcesArgument } from "../AffectedResourcesSetting";
import { getOwnersOnCreateArguments } from "../OwnersOnCreateSetting";
import {
  WHAT_HAPPENED_ID,
  WHAT_HAPPENED_NAME,
  WhatHappened,
  getCreateOrUpdateTriggerId,
  hasCreateOrUpdateTrigger,
} from "../CreateOrUpdateTrigger";
import {
  DatabaseOperation,
  getDatabaseOperation,
  WRITE_DATABASE_OPERATIONS,
} from "../DatabaseOperation";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { composeWords } from "../../ComposedWords";
import { translationKey } from "../../Translator";

/*
 * What the record triggers' and Find steps' field lists are called, wherever
 * they are named: the settings dialog, the step's help, the run log, and the
 * value picker's note on a field a step does not pass on.
 */
export const SELECT_FIELDS_NAME: string = translationKey("Fields to pass on");
export const WATCHED_FIELDS_NAME: string = translationKey("Fields to watch");

export default class BaseModelComponent {
  public static getComponents(model: BaseModel): Array<ComponentMetadata> {
    const components: Array<ComponentMetadata> = [];

    if (!model.enableWorkflowOn) {
      return [];
    }

    /*
     * Each of a record step's words is a sentence with the model's name in
     * it ("Find One {{itemName}}"), built as the English it always was and
     * remembered as built from that sentence, so the builder words it in
     * the reader's language (ComposedWords, #8642). A title or a setting's
     * name keeps the name's case; a sentence lowers it where the reader's
     * language does.
     */
    type WordsFunction = (template: string, inSentence: boolean) => string;

    const words: WordsFunction = (
      template: string,
      inSentence: boolean,
    ): string => {
      return composeWords(
        template,
        {
          itemName: model.singularName || "",
          itemsName: model.pluralName || "",
        },
        { inSentence: inSentence },
      );
    };

    /*
     * Every one of these arguments is keyed on column names, and the single
     * most common way to get one wrong is to write "id" - which is what an ID
     * is called everywhere else in the product - when the column is "_id".
     * Both spellings work.
     *
     * Query, the field lists and the write payload all get an editor backed
     * by the model's real column list, so the names are offered rather than
     * remembered. The hint stays on Query and the payload because their
     * editors keep a JSON escape hatch for values rows cannot express, and
     * because it is still the only thing explaining the two spellings. The
     * field lists say it in their own JSON view instead (ModelFieldPicker).
     */
    const queryDescription: string = words(
      translationKey(
        'Query that selects which {{itemsName}} this component acts on. Keys are column names on {{itemName}}. The ID column is "_id" (the "id" spelling is accepted too).',
      ),
      true,
    );

    const queryPlaceholder: string =
      'Example: {"_id": "00000000-0000-0000-0000-000000000000"}';

    const selectPlaceholder: string = 'Example: {"_id": true, "name": true}';

    /*
     * The record triggers' and Find steps' two field lists, in words a
     * first-time builder reads without the docs. "Listen on" and "Select
     * Fields" were the maintainer's "very confusing" pair: two identical
     * checkbox lists under SQL-ish names, with column keys in their help.
     * Each now says what it decides and what leaving it empty means. The
     * column keys only matter to someone editing the JSON, which says so
     * itself (ModelFieldPicker); the finer points of a change are in the
     * step's How to use (DatabaseDocumentation).
     */
    const selectDescription: string = words(
      translationKey(
        "The {{itemName}} fields the next steps can use. A field you leave out is empty in later steps.",
      ),
      true,
    );

    const listenOnDescription: string = words(
      translationKey(
        "Run only when an update changes one of these fields. Leave it empty to run on every change to the {{itemName}}.",
      ),
      true,
    );

    /*
     * The same list on On Create or Update, which a create always runs:
     * Fields to watch is about updates only.
     */
    const createOrUpdateListenOnDescription: string = words(
      translationKey(
        "Run on an update only when it changes one of these fields. A new {{itemName}} always runs this workflow. Leave it empty to run on every change.",
      ),
      true,
    );

    /*
     * What every record trigger asks Run Workflow for: the record to run
     * with. The panel finds it by its number or name (RunRecordField). A
     * fresh copy for each trigger, so no trigger's metadata shares an object
     * with another's.
     */
    type RunRecordArgumentFunction = () => Argument;

    const runRecordArgument: RunRecordArgumentFunction = (): Argument => {
      return {
        type: ComponentInputType.Text,
        name: words(translationKey("{{itemName}} ID"), false),
        description: words(
          translationKey(
            "Please provide the ID of the {{itemName}}, if you wish to run this workflow manually.",
          ),
          true,
        ),
        required: true,
        id: "_id",
        placeholder: words(translationKey("ID of the {{itemName}}"), true),
      };
    };

    const dataDescription: string = words(
      translationKey(
        '{{itemName}} fields to write, as a JSON object. Keys are column names on {{itemName}}. The ID column is "_id" (the "id" spelling is accepted too).',
      ),
      true,
    );

    /*
     * Skip and Limit are the same on every component that has them, and they
     * are not what decides what a step does - so they sit behind the "advanced"
     * disclosure rather than competing with Query for attention.
     *
     * Limit is worded as a cap rather than as pagination. Read as pagination it
     * is why "Items Deleted: 10" gets taken to mean ten records matched: the
     * runtime defaults it to 10 and stops there (DeleteManyBaseModel,
     * UpdateManyBaseModel), so a query matching five hundred records still only
     * touches ten.
     */
    const skipDescription: string = words(
      translationKey(
        "Skip the first X {{itemsName}} the query matched. Defaults to 0.",
      ),
      true,
    );

    const limitDescription: string = words(
      translationKey(
        "The most {{itemsName}} this step will touch. Defaults to 10, so a query that matches 500 records still only affects 10. Raise this if you mean all of them.",
      ),
      true,
    );

    /*
     * Each of these steps has "How to use" help of its own, written for its
     * operation and its model: Types/Workflow/Documentation/
     * DatabaseDocumentation.ts. It, and the Add Component picker, read the
     * operation off the id suffixes below through
     * Types/Workflow/DatabaseOperation.ts. Rename a suffix there too.
     */

    if (model.enableWorkflowOn.read) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-find-one`,
        title: words(translationKey("Find One {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to find one {{itemName}}"),
          true,
        ),
        iconProp: IconProp.ArrowCircleDown,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: translationKey("Query"),
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            type: ComponentInputType.Select,
            name: SELECT_FIELDS_NAME,
            description: selectDescription,
            required: true,
            id: "select",
            placeholder: selectPlaceholder,
          },
        ],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: words(
              translationKey("{{itemName}} fetched from the database"),
              true,
            ),
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error fetching data from the database",
            ),
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-find-many`,
        title: words(translationKey("Find Many {{itemsName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to find many {{itemsName}}"),
          true,
        ),
        iconProp: IconProp.ArrowCircleDown,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: translationKey("Query"),
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            type: ComponentInputType.Select,
            name: SELECT_FIELDS_NAME,
            description: selectDescription,
            required: true,
            id: "select",
            placeholder: selectPlaceholder,
          },
          {
            type: ComponentInputType.Number,
            name: translationKey("Skip"),
            description: skipDescription,
            required: false,
            id: "skip",
            isAdvanced: true,
          },
          {
            type: ComponentInputType.Number,
            name: translationKey("Limit"),
            description: limitDescription,
            required: false,
            id: "limit",
            isAdvanced: true,
          },
        ],
        returnValues: [
          {
            id: "models",
            name: `${model.singularName}`,
            description: words(
              translationKey("{{itemName}} array fetched from the database"),
              true,
            ),
            type: ComponentInputType.BaseModelArray,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error fetching data from the database",
            ),
            id: "error",
          },
        ],
      });
    }

    if (model.enableWorkflowOn.delete) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-on-delete`,
        title: words(translationKey("On Delete {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("When the {{itemName}} is deleted..."),
          true,
        ),
        iconProp: IconProp.Bolt,
        tableName: model.tableName!,
        componentType: ComponentType.Trigger,
        runWorkflowManuallyArguments: [runRecordArgument()],
        arguments: [],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: words(
              translationKey("{{itemName}} deleted in the database"),
              true,
            ),
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: translationKey("Success"),
            // A trigger runs no query of its own; this fired on a delete.
            description: words(
              translationKey(
                "This is executed when the {{itemName}} is deleted.",
              ),
              true,
            ),
            id: "success",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-delete-one`,
        title: words(translationKey("Delete One {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to delete one {{itemName}}"),
          true,
        ),
        iconProp: IconProp.Trash,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: translationKey("Query"),
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
        ],
        returnValues: [
          {
            id: "items-deleted",
            name: translationKey("Items Deleted"),
            description: words(
              translationKey(
                "How many {{itemsName}} the query matched and deleted. Zero is not an error - it means nothing matched.",
              ),
              true,
            ),
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error deleting data from the database",
            ),
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-delete-many`,
        title: words(translationKey("Delete Many {{itemsName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Delete many {{itemsName}} that match a query."),
          true,
        ),
        iconProp: IconProp.Trash,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: translationKey("Query"),
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            type: ComponentInputType.Number,
            name: translationKey("Skip"),
            description: skipDescription,
            required: false,
            id: "skip",
            isAdvanced: true,
          },
          {
            type: ComponentInputType.Number,
            name: translationKey("Limit"),
            description: limitDescription,
            required: false,
            id: "limit",
            isAdvanced: true,
          },
        ],
        returnValues: [
          {
            id: "items-deleted",
            name: translationKey("Items Deleted"),
            description: words(
              translationKey(
                "How many {{itemsName}} the query matched and deleted. Zero is not an error - it means nothing matched.",
              ),
              true,
            ),
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error deleting data from the database",
            ),
            id: "error",
          },
        ],
      });
    }

    if (model.enableWorkflowOn.create) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-on-create`,
        title: words(translationKey("On Create {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("When the {{itemName}} is created..."),
          true,
        ),
        iconProp: IconProp.Bolt,
        tableName: model.tableName!,
        componentType: ComponentType.Trigger,
        runWorkflowManuallyArguments: [runRecordArgument()],
        arguments: [
          {
            type: ComponentInputType.Select,
            name: SELECT_FIELDS_NAME,
            description: selectDescription,
            required: true,
            id: "select",
            placeholder: selectPlaceholder,
          },
        ],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: words(
              translationKey("{{itemName}} created in the database"),
              true,
            ),
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the model is created successfully.",
            ),
            id: "success",
          },
        ],
      });

      /*
       * A record that can be declared from one of its templates (an
       * incident) gets the template as a setting of its own, first: picking
       * one is the quickest way to declare it, and with one picked the JSON
       * Object only needs what should differ from the template
       * (Types/Workflow/CreateFromTemplate).
       */
      const templateArgument: Argument | null = getCreateFromTemplateArgument(
        model.tableName || undefined,
      );

      const jsonArgument: Argument = {
        id: "json",
        placeholder: 'Example: {"columnName": "value", ...}',
        name: translationKey("JSON Object"),
        description: templateArgument
          ? words(
              translationKey(
                '{{itemName}} represented as JSON. With a template picked, only what should differ from it. Keys are column names on {{itemName}}. The ID column is "_id" (the "id" spelling is accepted too).',
              ),
              true,
            )
          : words(
              translationKey(
                '{{itemName}} represented as JSON. Keys are column names on {{itemName}}. The ID column is "_id" (the "id" spelling is accepted too).',
              ),
              true,
            ),
        type: ComponentInputType.JSON,
        required: true,
      };

      if (templateArgument) {
        jsonArgument.notRequiredWhen = { argumentId: templateArgument.id };
      }

      /*
       * An incident or an alert also takes what it is about by name - the
       * host, router or service an alert from another tool names - looked
       * up across every kind of resource it can be linked to and added to
       * its lists (Types/Workflow/AffectedResourcesSetting). Last, after the
       * record it adds to.
       */
      const affectedResourcesArgument: Argument | null =
        getAffectedResourcesArgument(model.tableName || undefined);

      /*
       * And who owns it from the start, so its Created notification reaches
       * them (Types/Workflow/OwnersOnCreateSetting). Last: who owns it is
       * picked once what it is has been said.
       */
      const ownersArguments: Array<Argument> = getOwnersOnCreateArguments(
        model.tableName || undefined,
      );

      const createOneArguments: Array<Argument> = [
        ...(templateArgument ? [templateArgument] : []),
        jsonArgument,
        ...(affectedResourcesArgument ? [affectedResourcesArgument] : []),
        ...ownersArguments,
      ];

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-create-one`,
        title: words(translationKey("Create One {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to create one {{itemName}}"),
          true,
        ),
        iconProp: IconProp.Database,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: createOneArguments,
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: words(
              translationKey(
                '{{itemName}} created in the database, including its new "_id"',
              ),
              true,
            ),
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error creating data from the database",
            ),
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-create-many`,
        title: words(translationKey("Create Many {{itemsName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to create many {{itemsName}}"),
          true,
        ),
        iconProp: IconProp.Database,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            id: "json-array",
            name: translationKey("JSON Array"),
            placeholder: 'Example: [{"columnName": "value", ...}, {...}]',
            description: words(
              translationKey(
                'List of {{itemsName}} represented as a JSON array. Keys are column names on {{itemName}}. The ID column is "_id" (the "id" spelling is accepted too).',
              ),
              true,
            ),
            type: ComponentInputType.JSONArray,
            required: true,
          },
        ],
        returnValues: [
          {
            id: "models",
            name: `${model.pluralName}`,
            description: words(
              translationKey("{{itemsName}} created in the database"),
              true,
            ),
            type: ComponentInputType.BaseModelArray,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error creating data from the database",
            ),
            id: "error",
          },
        ],
      });
    }

    if (model.enableWorkflowOn.update) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-on-update`,
        title: words(translationKey("On Update {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("When the {{itemName}} is updated..."),
          true,
        ),
        iconProp: IconProp.Bolt,
        tableName: model.tableName!,
        componentType: ComponentType.Trigger,
        runWorkflowManuallyArguments: [runRecordArgument()],
        arguments: [
          {
            type: ComponentInputType.Select,
            name: WATCHED_FIELDS_NAME,
            description: listenOnDescription,
            required: false,
            id: "listen-on",
            placeholder: 'Example: {"columnName": true, ...}',
          },
          {
            type: ComponentInputType.Select,
            name: SELECT_FIELDS_NAME,
            description: selectDescription,
            required: true,
            id: "select",
            placeholder: selectPlaceholder,
          },
        ],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: words(translationKey("Updated {{itemName}}"), true),
            type: ComponentInputType.BaseModel,
            required: true,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: translationKey("Success"),
            description: words(
              translationKey(
                "This is executed when the {{itemName}} is updated successfully.",
              ),
              true,
            ),
            id: "success",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-update-one`,
        title: words(translationKey("Update One {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to update one {{itemName}}"),
          true,
        ),
        iconProp: IconProp.ArrowCircleUp,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: translationKey("Query"),
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            id: "data",
            placeholder: 'Example: {"columnName": "value", ...}',
            name: translationKey("Data (JSON Object)"),
            description: dataDescription,
            type: ComponentInputType.JSON,
            required: true,
          },
        ],
        returnValues: [
          {
            id: "items-updated",
            name: translationKey("Items Updated"),
            description: words(
              translationKey(
                "How many {{itemsName}} the query matched and updated. Zero is not an error - it means nothing matched.",
              ),
              true,
            ),
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error updating data from the database",
            ),
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-update-many`,
        title: words(translationKey("Update Many {{itemsName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("Database query to update many {{itemsName}}"),
          true,
        ),
        iconProp: IconProp.ArrowCircleUp,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: translationKey("Query"),
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            id: "data",
            name: translationKey("Data (JSON Object)"),
            placeholder: 'Example: {"columnName": "value", ...}',
            description: dataDescription,
            type: ComponentInputType.JSON,
            required: true,
          },
          {
            type: ComponentInputType.Number,
            name: translationKey("Skip"),
            description: skipDescription,
            required: false,
            id: "skip",
            isAdvanced: true,
          },
          {
            type: ComponentInputType.Number,
            name: translationKey("Limit"),
            description: limitDescription,
            required: false,
            id: "limit",
            isAdvanced: true,
          },
        ],
        returnValues: [
          {
            id: "items-updated",
            name: translationKey("Items Updated"),
            description: words(
              translationKey(
                "How many {{itemsName}} the query matched and updated. Zero is not an error - it means nothing matched.",
              ),
              true,
            ),
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: translationKey("In"),
            description: translationKey(
              "Please connect components to this port for this component to work.",
            ),
            id: "in",
          },
        ],
        outPorts: [
          {
            title: translationKey("Success"),
            description: translationKey(
              "This is executed when the query executes successfully",
            ),
            id: "success",
          },
          {
            title: translationKey("Error"),
            description: translationKey(
              "This is executed when there is an error updating data from the database",
            ),
            id: "error",
          },
        ],
      });
    }

    /*
     * One trigger for a new record and a changed one, for every model with
     * both triggers it stands for (Types/Workflow/CreateOrUpdateTrigger). Its
     * settings are On Update's, under the same ids, so the field lists, the
     * value picker and the run treat them alike; only what Fields to watch
     * says differs, since a create always runs it. What Happened says which
     * of the two started the run, and Run Workflow asks which to test.
     */
    if (hasCreateOrUpdateTrigger(model.enableWorkflowOn)) {
      components.push({
        id: getCreateOrUpdateTriggerId(model.tableName!),
        title: words(translationKey("On Create or Update {{itemName}}"), false),
        category: `${model.singularName}`,
        description: words(
          translationKey("When the {{itemName}} is created or updated..."),
          true,
        ),
        iconProp: IconProp.Bolt,
        tableName: model.tableName!,
        componentType: ComponentType.Trigger,
        /*
         * What Happened first: the record's search opens on arrival with its
         * list under it, and a question under an open list moved away from
         * the press that closed the list, so its first press did nothing.
         */
        runWorkflowManuallyArguments: [
          {
            type: ComponentInputType.Choice,
            name: WHAT_HAPPENED_NAME,
            description: words(
              translationKey(
                "Run as if the {{itemName}} had just been created, or just been updated.",
              ),
              true,
            ),
            required: false,
            id: WHAT_HAPPENED_ID,
            // As Run Workflow words them (RunForm).
            choices: [
              {
                value: WhatHappened.Created,
                label: translationKey("Just created"),
              },
              {
                value: WhatHappened.Updated,
                label: translationKey("Just updated"),
              },
            ],
          },
          runRecordArgument(),
        ],
        arguments: [
          {
            type: ComponentInputType.Select,
            name: WATCHED_FIELDS_NAME,
            description: createOrUpdateListenOnDescription,
            required: false,
            id: "listen-on",
            placeholder: 'Example: {"columnName": true, ...}',
          },
          {
            type: ComponentInputType.Select,
            name: SELECT_FIELDS_NAME,
            description: selectDescription,
            required: true,
            id: "select",
            placeholder: selectPlaceholder,
          },
        ],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: words(
              translationKey("The {{itemName}} that was created or updated"),
              true,
            ),
            type: ComponentInputType.BaseModel,
            required: true,
          },
          {
            id: WHAT_HAPPENED_ID,
            name: WHAT_HAPPENED_NAME,
            /*
             * Short enough for one line of the value list.
             * Written out so the locales can word it; a test holds it to WhatHappened.
             */
            description: words(
              translationKey(
                '"created" for a new {{itemName}}, "updated" for a change to one.',
              ),
              true,
            ),
            type: ComponentInputType.Text,
            required: true,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: translationKey("Success"),
            description: words(
              translationKey(
                "This is executed when the {{itemName}} is created, and when it is updated.",
              ),
              true,
            ),
            id: "success",
          },
        ],
      });
    }

    /*
     * A table only OneUptime writes, such as a call log, keeps its triggers
     * and its Find steps but offers no step that writes its rows. See
     * EnableWorkflowOn.writeSteps.
     */
    if (model.enableWorkflowOn.writeSteps === false) {
      return components.filter((component: ComponentMetadata): boolean => {
        const operation: DatabaseOperation | null = getDatabaseOperation({
          componentId: component.id,
          tableName: model.tableName!,
        });

        return !operation || !WRITE_DATABASE_OPERATIONS.includes(operation);
      });
    }

    return components;
  }
}
