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
                id: 'find-one',
                title: `Find One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to find one ${model.singularName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                        name: 'Model',
                        description: 'Model fetched from the database',
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
                id: 'find-many',
                title: `Find Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to find many ${model.pluralName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                        name: 'Model',
                        description: 'Model fetched from the database',
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
                id: 'delete-one',
                title: `Delete One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to delete one ${model.singularName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                id: 'delete-many',
                title: `Delete Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to find many ${model.pluralName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                id: 'create-one',
                title: `Create One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to create one ${model.singularName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
                arguments: [
                    {
                        id: 'json',
                        name: 'JSON Object',
                        description: 'Model represented as JSON',
                        type: ComponentInputType.JSON,
                        required: true,
                    },
                ],
                returnValues: [
                    {
                        id: 'model',
                        name: 'Model',
                        description: 'Model created in the database',
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
                id: 'create-many',
                title: `Create Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to create many ${model.pluralName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                        name: 'Model List',
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
                id: 'update-one',
                title: `Update One ${model.singularName}`,
                category: `${model.singularName}`,
                description: `Database query to update one ${model.singularName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                        description: 'Model represented as JSON',
                        type: ComponentInputType.JSON,
                        required: true,
                    },
                ],
                returnValues: [
                    {
                        id: 'model',
                        name: 'Model',
                        description: 'Model updated in the database',
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
                id: 'update-many',
                title: `Update Many ${model.pluralName}`,
                category: `${model.singularName}`,
                description: `Database query to update many ${model.pluralName}`,
                iconProp: IconProp.ArrowCircleLeft,
                type: ComponentType.Component,
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
                        name: 'Model List',
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
