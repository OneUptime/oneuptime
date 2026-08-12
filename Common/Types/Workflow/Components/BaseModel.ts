import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../API/Route";
import IconProp from "../../Icon/IconProp";
import Text from "../../Text";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

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
     * Query and record arguments now get a row editor backed by the model's
     * real column list (ModelColumnEditor), so the names are offered rather
     * than remembered. The hint stays because that editor keeps a JSON escape
     * hatch for the queries rows cannot express, and because it is still the
     * only thing explaining the two spellings.
     */
    const columnHint: string = `Keys are column names on ${model.singularName}. The ID column is "_id" (the "id" spelling is accepted too).`;

    const queryDescription: string = `Query that selects which ${model.pluralName} this component acts on. ${columnHint}`;

    const queryPlaceholder: string =
      'Example: {"_id": "00000000-0000-0000-0000-000000000000"}';

    const selectPlaceholder: string = 'Example: {"_id": true, "name": true}';

    const dataDescription: string = `${model.singularName} fields to write, as a JSON object. ${columnHint}`;

    const documentationLink: Route = Route.fromString(
      "/workflow/docs/DatabaseComponents.md",
    );

    if (model.enableWorkflowOn.read) {
      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-find-one`,
        title: `Find One ${model.singularName}`,
        category: `${model.singularName}`,
        description: `Database query to find one ${model.singularName}`,
        iconProp: IconProp.ArrowCircleDown,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        documentationLink: documentationLink,
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
            name: "Select Fields",
            description: `Fields to read from ${model.singularName}. ${columnHint}`,
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
        documentationLink: documentationLink,
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
            name: "Select Fields",
            description: `Fields to read from ${model.singularName}. ${columnHint}`,
            required: true,
            id: "select",
            placeholder: selectPlaceholder,
          },
          {
            type: ComponentInputType.Number,
            name: "Skip",
            description: `Skip the first X number of items. This can be helpful to implement pagination. Defaults to 0.`,
            required: false,
            id: "skip",
          },
          {
            type: ComponentInputType.Number,
            name: "Limit",
            description: `Limit to first X items. This can be helpful to implement pagination. Defaults to 10.`,
            required: false,
            id: "limit",
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
        runWorkflowManuallyArguments: [
          {
            type: ComponentInputType.Text,
            name: `${model.singularName} ID`,
            description: `Please provide the ID of the ${model.singularName}, if you wish to run this workflow manually.`,
            required: true,
            id: "_id",
            placeholder: `ID of the ${model.singularName}`,
          },
        ],
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
            description:
              "This is executed when the query executes successfully",
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
        documentationLink: documentationLink,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Delete by",
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
        description: `Database query to find many ${model.pluralName}`,
        iconProp: IconProp.Trash,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        documentationLink: documentationLink,
        arguments: [
          {
            type: ComponentInputType.Query,
            name: "Delete by",
            description: queryDescription,
            required: true,
            id: "query",
            placeholder: queryPlaceholder,
          },
          {
            type: ComponentInputType.Number,
            name: "Skip",
            description: `Skip the first X number of items. This can be helpful to implement pagination. Defaults to 0.`,
            required: false,
            id: "skip",
          },
          {
            type: ComponentInputType.Number,
            name: "Limit",
            description: `Limit to first X items. This can be helpful to implement pagination. Defaults to 10.`,
            required: false,
            id: "limit",
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
        runWorkflowManuallyArguments: [
          {
            type: ComponentInputType.Text,
            name: `${model.singularName} ID`,
            description: `Please provide the ID of the ${model.singularName}, if you wish to run this workflow manually.`,
            required: true,
            id: "_id",
            placeholder: `ID of the ${model.singularName}`,
          },
        ],
        arguments: [
          {
            type: ComponentInputType.Select,
            name: "Select Fields",
            description: `Fields to read from ${model.singularName}. ${columnHint}`,
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

      components.push({
        id: `${Text.pascalCaseToDashes(model.tableName!)}-create-one`,
        title: `Create One ${model.singularName}`,
        category: `${model.singularName}`,
        description: `Database query to create one ${model.singularName}`,
        iconProp: IconProp.Database,
        tableName: model.tableName!,
        componentType: ComponentType.Component,
        documentationLink: documentationLink,
        arguments: [
          {
            id: "json",
            placeholder: 'Example: {"columnName": "value", ...}',
            name: "JSON Object",
            description: `${model.singularName} represented as JSON. ${columnHint}`,
            type: ComponentInputType.JSON,
            required: true,
          },
        ],
        returnValues: [
          {
            id: "model",
            name: `${model.singularName}`,
            description: `${model.singularName} created in the database`,
            type: ComponentInputType.JSON,
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
        documentationLink: documentationLink,
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
            description: "Models created in the database",
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
        runWorkflowManuallyArguments: [
          {
            type: ComponentInputType.Text,
            name: `${model.singularName} ID`,
            description: `Please provide the ID of the ${model.singularName}, if you wish to run this workflow manually.`,
            required: true,
            id: "_id",
            placeholder: `ID of the ${model.singularName}`,
          },
        ],
        arguments: [
          {
            type: ComponentInputType.Select,
            name: "Listen on",
            description: `Workflow only executes when an upate happens to these fields on ${model.singularName}. If you leave this blank then the workflow will fire on any field that's updated on ${model.singularName}.`,
            required: false,
            id: "listen-on",
            placeholder: 'Example: {"columnName": true, ...}',
          },
          {
            type: ComponentInputType.Select,
            name: "Select Fields",
            description: `Fields to read from ${model.singularName}. ${columnHint}`,
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
        documentationLink: documentationLink,
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
        documentationLink: documentationLink,
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
            description: `Skip the first X number of items. This can be helpful to implement pagination. Defaults to 0.`,
            required: false,
            id: "skip",
          },
          {
            type: ComponentInputType.Number,
            name: "Limit",
            description: `Limit to first X items. This can be helpful to implement pagination. Defaults to 10.`,
            required: false,
            id: "limit",
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

    return components;
  }
}
