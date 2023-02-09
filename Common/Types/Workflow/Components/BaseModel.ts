import IconProp from '../../Icon/IconProp';
import Component, { ComponentInputType, ComponentType } from './../Component';
import BaseModel from '../../../Models/BaseModel';

export default class BaseModelComponent {
    public static getComponents(model: BaseModel): Array<Component> {
        const components: Array<Component> = [];

        if (!model.enableWorkflowOn) {
            return [];
        }

        if (model.enableWorkflowOn.read) {
            components.push({
                id: `${model.tableName}-find-one`,
                title: `Find One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to find one ${model.singularName}`,
                iconProp: IconProp.ArrowCircleDown,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        type: ComponentInputType.Query,
                        name: 'Filter',
                        description: `Filter on ${model.singularName}`,
                        required: false,
                        id: 'filter',
                    },
                ],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `${model.singularName} fetched from the database`,
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error fetching data from the database',
                        id: 'error',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-find-many`,
                title: `Find Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to find many ${model.pluralName}`,
                iconProp: IconProp.ArrowCircleDown,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        type: ComponentInputType.Query,
                        name: 'Filter',
                        description: 'Please fill out this filter',
                        required: false,
                        id: 'filter',
                    },
                ],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `${model.singularName} fetched from the database`,
                        type: ComponentInputType.BaseModelArray,
                        required: false,
                    },
                ],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error fetching data from the database',
                        id: 'error',
                    },
                ],
            });
        }

        if (model.enableWorkflowOn.delete) {
            components.push({
                id: `${model.tableName}-on-delete`,
                title: `On Delete ${model.singularName}`,
                category: `${model.singularName}`,
                description: `When the ${model.singularName} is deleted...`,
                iconProp: IconProp.Bolt,
                componentType: ComponentType.Trigger,
                arguments: [],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `${model.singularName} deleted in the database`,
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-delete-one`,
                title: `Delete One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to delete one ${model.singularName}`,
                iconProp: IconProp.Trash,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        type: ComponentInputType.Query,
                        name: 'Delete by',
                        description: 'Please fill out this filter',
                        required: false,
                        id: 'filter',
                    },
                ],
                returnValues: [],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error deleting data from the database',
                        id: 'error',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-delete-many`,
                title: `Delete Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to find many ${model.pluralName}`,
                iconProp: IconProp.Trash,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        type: ComponentInputType.Query,
                        name: 'Delete by',
                        description: 'Please fill out this filter',
                        required: false,
                        id: 'filter',
                    },
                ],
                returnValues: [],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error deleting data from the database',
                        id: 'error',
                    },
                ],
            });
        }

        if (model.enableWorkflowOn.create) {
            components.push({
                id: `${model.tableName}-on-create`,
                title: `On Create ${model.singularName}`,
                category: `${model.singularName}`,
                description: `When the ${model.singularName} is created...`,
                iconProp: IconProp.Bolt,
                componentType: ComponentType.Trigger,
                arguments: [],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `${model.singularName} created in the database`,
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the model is created successfully.',
                        id: 'success',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-create-one`,
                title: `Create One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to create one ${model.singularName}`,
                iconProp: IconProp.Database,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        id: 'json',
                        name: 'JSON Object',
                        description: `${model.singularName} represented as JSON`,
                        type: ComponentInputType.JSON,
                        required: true,
                    },
                ],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `${model.singularName} created in the database`,
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error creating data from the database',
                        id: 'error',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-create-many`,
                title: `Create Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to create many ${model.pluralName}`,
                iconProp: IconProp.Database,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        id: 'json-array',
                        name: 'JSON Array',
                        description: 'List of models represented as JSON array',
                        type: ComponentInputType.JSONArray,
                        required: true,
                    },
                ],
                returnValues: [
                    {
                        id: 'models',
                        name: `${model.pluralName}`,
                        description: 'Models created in the database',
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error creating data from the database',
                        id: 'error',
                    },
                ],
            });
        }

        if (model.enableWorkflowOn.update) {
            components.push({
                id: `${model.tableName}-on-update`,
                title: `On Update ${model.singularName}`,
                category: `${model.singularName}`,
                description: `When the ${model.singularName} is updated...`,
                iconProp: IconProp.Bolt,
                componentType: ComponentType.Trigger,
                arguments: [],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `Updated ${model.singularName}`,
                        type: ComponentInputType.BaseModel,
                        required: true,
                    },
                ],
                inPorts: [],
                outPorts: [
                    {
                        title: 'Success',
                        description: `This is executed when the ${model.singularName} is updated successfully.`,
                        id: 'success',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-update-one`,
                title: `Update One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to update one ${model.singularName}`,
                iconProp: IconProp.ArrowCircleUp,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        type: ComponentInputType.Query,
                        name: 'Filter',
                        description: 'Please fill out this filter',
                        required: false,
                        id: 'filter',
                    },
                    {
                        id: 'json',
                        name: 'JSON Object',
                        description: `${model.singularName} represented as JSON`,
                        type: ComponentInputType.JSON,
                        required: true,
                    },
                ],
                returnValues: [
                    {
                        id: 'model',
                        name: `${model.singularName}`,
                        description: `${model.singularName} updated in the database`,
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error updating data from the database',
                        id: 'error',
                    },
                ],
            });

            components.push({
                id: `${model.tableName}-update-many`,
                title: `Update Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to update many ${model.pluralName}`,
                iconProp: IconProp.ArrowCircleUp,
                componentType: ComponentType.Component,
                arguments: [
                    {
                        type: ComponentInputType.Query,
                        name: 'Filter',
                        description: 'Please fill out this filter',
                        required: false,
                        id: 'filter',
                    },
                    {
                        id: 'json-array',
                        name: 'JSON Array',
                        description: 'List of models represented as JSON array',
                        type: ComponentInputType.JSONArray,
                        required: true,
                    },
                ],
                returnValues: [
                    {
                        id: 'models',
                        name: `${model.pluralName}`,
                        description: 'Models updated in the database',
                        type: ComponentInputType.BaseModel,
                        required: false,
                    },
                ],
                inPorts: [
                    {
                        title: 'In',
                        description:
                            'Please connect components to this port for this component to work.',
                        id: 'in',
                    },
                ],
                outPorts: [
                    {
                        title: 'Success',
                        description:
                            'This is executed when the query executes successfully',
                        id: 'success',
                    },
                    {
                        title: 'Error',
                        description:
                            'This is executed when there is an error updating data from the database',
                        id: 'error',
                    },
                ],
            });
        }

        return components;
    }
}
