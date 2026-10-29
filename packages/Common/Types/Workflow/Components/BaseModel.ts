import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../Icon/IconProp";
import Text from "../../Text";
import { getCreateFromTemplateArgument } from "../CreateFromTemplate";
import { getAffectedResourcesArgument } from "../AffectedResourcesSetting";
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

/*
 * What the record triggers' and Find steps' field lists are called, wherever
 * they are named: the settings dialog, the step's help, the run log, and the
 * value picker's note on a field a step does not pass on.
 */
export const SELECT_FIELDS_NAME: string = "Fields to pass on";
export const WATCHED_FIELDS_NAME: string = "Fields to watch";

export default class BaseModelComponent {
  public static getComponents(model: BaseModel): Array<ComponentMetadata> {
    const components: Array<ComponentMetadata> = [];

    if (!model.enableWorkflowOn) {
      return [];
    }

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
    const columnHint: string = `Keys are column names on ${model.singularName}. The ID column is "_id" (the "id" spelling is accepted too).`;

    const queryDescription: string = `Query that selects which ${model.pluralName} this component acts on. ${columnHint}`;

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
    const selectDescription: string = `The ${model.singularName} fields the next steps can use. A field you leave out is empty in later steps.`;

    const listenOnDescription: string = `Run only when an update changes one of these fields. Leave it empty to run on every change to the ${model.singularName}.`;

    /*
     * The same list on On Create or Update, which a create always runs:
     * Fields to watch is about updates only.
     */
    const createOrUpdateListenOnDescription: string = `Run on an update only when it changes one of these fields. A new ${model.singularName} always runs this workflow. Leave it empty to run on every change.`;

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
        name: `${model.singularName} ID`,
        description: `Please provide the ID of the ${model.singularName}, if you wish to run this workflow manually.`,
        required: true,
        id: "_id",
        placeholder: `ID of the ${model.singularName}`,
      };
    };

    const dataDescription: string = `${model.singularName} fields to write, as a JSON object. ${columnHint}`;

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
    const skipDescription: string = `Skip the first X ${model.pluralName} the query matched. Defaults to 0.`;

    const limitDescription: string = `The most ${model.pluralName} this step will touch. Defaults to 10, so a query that matches 500 records still only affects 10. Raise this if you mean all of them.`;

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
        title: `Find One ${model.singularName}`,
        category: `${model.singularName}`,
        description: `Database query to find one ${model.singularName}`,
        iconProp: IconProp.ArrowCircleDown,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Query",
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
            description: `${model.singularName} fetched from the database`,
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error fetching data from the database",
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-find-many`,
        title: `Find Many ${model.pluralName}`,
        category: `${model.singularName}`,
        description: `Database query to find many ${model.pluralName}`,
        iconProp: IconProp.ArrowCircleDown,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Query",
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
            name: "Skip",
            description: skipDescription,
            required: false,
            id: "skip",
            isAdvanced: true,
          },
          {
            type: ComponentInputType.Number,
            name: "Limit",
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
            description: `${model.singularName} array fetched from the database`,
            type: ComponentInputType.BaseModelArray,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error fetching data from the database",
            id: "error",
          },
        ],
      });
    }

    if (model.enableWorkflowOn.delete) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-on-delete`,
        title: `On Delete ${model.singularName}`,
        category: `${model.singularName}`,
        description: `When the ${model.singularName} is deleted...`,
        iconProp: IconProp.Bolt,
        tableName: model.tableName!,
        componentType: ComponentType.Trigger,
        runWorkflowManuallyArguments: [runRecordArgument()],
        arguments: [],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: `${model.singularName} deleted in the database`,
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: "Success",
            // A trigger runs no query of its own; this fired on a delete.
            description: `This is executed when the ${model.singularName} is deleted.`,
            id: "success",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-delete-one`,
        title: `Delete One ${model.singularName}`,
        category: `${model.singularName}`,
        description: `Database query to delete one ${model.singularName}`,
        iconProp: IconProp.Trash,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Query",
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
        ],
        returnValues: [
          {
            id: "items-deleted",
            name: "Items Deleted",
            description: `How many ${model.pluralName} the query matched and deleted. Zero is not an error - it means nothing matched.`,
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error deleting data from the database",
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-delete-many`,
        title: `Delete Many ${model.pluralName}`,
        category: `${model.singularName}`,
        description: `Delete many ${model.pluralName} that match a query.`,
        iconProp: IconProp.Trash,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Query",
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            type: ComponentInputType.Number,
            name: "Skip",
            description: skipDescription,
            required: false,
            id: "skip",
            isAdvanced: true,
          },
          {
            type: ComponentInputType.Number,
            name: "Limit",
            description: limitDescription,
            required: false,
            id: "limit",
            isAdvanced: true,
          },
        ],
        returnValues: [
          {
            id: "items-deleted",
            name: "Items Deleted",
            description: `How many ${model.pluralName} the query matched and deleted. Zero is not an error - it means nothing matched.`,
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error deleting data from the database",
            id: "error",
          },
        ],
      });
    }

    if (model.enableWorkflowOn.create) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-on-create`,
        title: `On Create ${model.singularName}`,
        category: `${model.singularName}`,
        description: `When the ${model.singularName} is created...`,
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
            description: `${model.singularName} created in the database`,
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the model is created successfully.",
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
        name: "JSON Object",
        description: templateArgument
          ? `${model.singularName} represented as JSON. With a template picked, only what should differ from it. ${columnHint}`
          : `${model.singularName} represented as JSON. ${columnHint}`,
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

      const createOneArguments: Array<Argument> = [
        ...(templateArgument ? [templateArgument] : []),
        jsonArgument,
        ...(affectedResourcesArgument ? [affectedResourcesArgument] : []),
      ];

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-create-one`,
        title: `Create One ${model.singularName}`,
        category: `${model.singularName}`,
        description: `Database query to create one ${model.singularName}`,
        iconProp: IconProp.Database,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: createOneArguments,
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: `${model.singularName} created in the database, including its new "_id"`,
            type: ComponentInputType.BaseModel,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error creating data from the database",
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-create-many`,
        title: `Create Many ${model.pluralName}`,
        category: `${model.singularName}`,
        description: `Database query to create many ${model.pluralName}`,
        iconProp: IconProp.Database,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            id: "json-array",
            name: "JSON Array",
            placeholder: 'Example: [{"columnName": "value", ...}, {...}]',
            description: `List of ${model.pluralName} represented as a JSON array. ${columnHint}`,
            type: ComponentInputType.JSONArray,
            required: true,
          },
        ],
        returnValues: [
          {
            id: "models",
            name: `${model.pluralName}`,
            description: `${model.pluralName} created in the database`,
            type: ComponentInputType.BaseModelArray,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error creating data from the database",
            id: "error",
          },
        ],
      });
    }

    if (model.enableWorkflowOn.update) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-on-update`,
        title: `On Update ${model.singularName}`,
        category: `${model.singularName}`,
        description: `When the ${model.singularName} is updated...`,
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
            description: `Updated ${model.singularName}`,
            type: ComponentInputType.BaseModel,
            required: true,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: "Success",
            description: `This is executed when the ${model.singularName} is updated successfully.`,
            id: "success",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-update-one`,
        title: `Update One ${model.singularName}`,
        category: `${model.singularName}`,
        description: `Database query to update one ${model.singularName}`,
        iconProp: IconProp.ArrowCircleUp,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Query",
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            id: "data",
            placeholder: 'Example: {"columnName": "value", ...}',
            name: "Data (JSON Object)",
            description: dataDescription,
            type: ComponentInputType.JSON,
            required: true,
          },
        ],
        returnValues: [
          {
            id: "items-updated",
            name: "Items Updated",
            description: `How many ${model.pluralName} the query matched and updated. Zero is not an error - it means nothing matched.`,
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error updating data from the database",
            id: "error",
          },
        ],
      });

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-update-many`,
        title: `Update Many ${model.pluralName}`,
        category: `${model.singularName}`,
        description: `Database query to update many ${model.pluralName}`,
        iconProp: IconProp.ArrowCircleUp,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Query",
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            id: "data",
            name: "Data (JSON Object)",
            placeholder: 'Example: {"columnName": "value", ...}',
            description: dataDescription,
            type: ComponentInputType.JSON,
            required: true,
          },
          {
            type: ComponentInputType.Number,
            name: "Skip",
            description: skipDescription,
            required: false,
            id: "skip",
            isAdvanced: true,
          },
          {
            type: ComponentInputType.Number,
            name: "Limit",
            description: limitDescription,
            required: false,
            id: "limit",
            isAdvanced: true,
          },
        ],
        returnValues: [
          {
            id: "items-updated",
            name: "Items Updated",
            description: `How many ${model.pluralName} the query matched and updated. Zero is not an error - it means nothing matched.`,
            type: ComponentInputType.Number,
            required: false,
          },
        ],
        inPorts: [
          {
            title: "In",
            description:
              "Please connect components to this port for this component to work.",
            id: "in",
          },
        ],
        outPorts: [
          {
            title: "Success",
            description:
              "This is executed when the query executes successfully",
            id: "success",
          },
          {
            title: "Error",
            description:
              "This is executed when there is an error updating data from the database",
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
        title: `On Create or Update ${model.singularName}`,
        category: `${model.singularName}`,
        description: `When the ${model.singularName} is created or updated...`,
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
            description: `Run as if the ${model.singularName} had just been created, or just been updated.`,
            required: false,
            id: WHAT_HAPPENED_ID,
            // As Run Workflow words them (RunForm).
            choices: [
              { value: WhatHappened.Created, label: "Just created" },
              { value: WhatHappened.Updated, label: "Just updated" },
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
            description: `The ${model.singularName} that was created or updated`,
            type: ComponentInputType.BaseModel,
            required: true,
          },
          {
            id: WHAT_HAPPENED_ID,
            name: WHAT_HAPPENED_NAME,
            // Short enough for one line of the value list.
            description: `"${WhatHappened.Created}" for a new ${model.singularName}, "${WhatHappened.Updated}" for a change to one.`,
            type: ComponentInputType.Text,
            required: true,
          },
        ],
        inPorts: [],
        outPorts: [
          {
            title: "Success",
            description: `This is executed when the ${model.singularName} is created, and when it is updated.`,
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
