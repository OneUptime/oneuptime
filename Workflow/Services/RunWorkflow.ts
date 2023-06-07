import Dictionary from 'Common/Types/Dictionary';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONArray, JSONObject, JSONValue } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
    NodeDataProp,
    NodeType,
    Port,
} from 'Common/Types/Workflow/Component';
import WorkflowService from 'CommonServer/Services/WorkflowService';
import ComponentCode, {
    RunReturnType,
} from 'CommonServer/Types/Workflow/ComponentCode';
import { RunProps } from 'CommonServer/Types/Workflow/Workflow';
import WorkflowVariable from 'Model/Models/WorkflowVariable';
import WorkflowVariableService from 'CommonServer/Services/WorkflowVariableService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import WorkflowLogService from 'CommonServer/Services/WorkflowLogService';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import Components from 'CommonServer/Types/Workflow/Components/Index';
import OneUptimeDate from 'Common/Types/Date';
import { loadAllComponentMetadata } from '../Utils/ComponentMetadata';
import Workflow from 'Model/Models/Workflow';
import logger from 'CommonServer/Utils/Logger';
import TimeoutException from 'Common/Types/Exception/TimeoutException';
import Exception from 'Common/Types/Exception/Exception';
import WorkflowLog from 'Model/Models/WorkflowLog';

const AllComponents: Dictionary<ComponentMetadata> = loadAllComponentMetadata();

export interface StorageMap {
    local: {
        variables: Dictionary<string>;
        components: {
            [x: string]: {
                returnValues: JSONObject;
            };
        };
    };
    global: {
        variables: Dictionary<string>;
    };
}

export interface RunStackItem {
    node: NodeDataProp;
    outPorts: Dictionary<Array<string>>; // portId <-> [ComponentIds]
}

export interface RunStack {
    stack: Dictionary<RunStackItem>;
    startWithComponentId: string;
}

export default class RunWorkflow {
    private logs: Array<string> = [];
    private workflowId: ObjectID | null = null;
    private projectId: ObjectID | null = null;
    private workflowLogId: ObjectID | null = null;

    public async runWorkflow(runProps: RunProps): Promise<void> {
        // get nodes and edges.

        let variables: Array<WorkflowVariable> = [];

        try {
            this.workflowId = runProps.workflowId;
            this.workflowLogId = runProps.workflowLogId;

            let didWorkflowTimeOut: boolean = false;
            let didWorkflowErrorOut: boolean = false;

            setTimeout(() => {
                didWorkflowTimeOut = true;
            }, runProps.timeout);

            const workflow: Workflow | null = await WorkflowService.findOneById(
                {
                    id: runProps.workflowId,
                    select: {
                        graph: true,
                        projectId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                }
            );

            if (!workflow) {
                throw new BadDataException('Workflow not found');
            }

            if (!workflow.graph) {
                throw new BadDataException('Workflow graph not found');
            }

            this.projectId = workflow.projectId || null;

            if (!runProps.workflowLogId) {
                // create a new workflow log here.
                // if the workflow is to be run immeidately.
                const runLog: WorkflowLog = new WorkflowLog();
                runLog.workflowId = runProps.workflowId;
                runLog.projectId = workflow.projectId!;
                runLog.workflowStatus = WorkflowStatus.Scheduled;
                runLog.logs =
                    OneUptimeDate.getCurrentDateAsFormattedString() +
                    ': Workflow Scheduled.';

                runProps.workflowLogId = (
                    await WorkflowLogService.create({
                        data: runLog,
                        props: {
                            isRoot: true,
                        },
                    })
                ).id!;
            }

            // update workflow log.
            await WorkflowLogService.updateOneById({
                id: runProps.workflowLogId,
                data: {
                    workflowStatus: WorkflowStatus.Running,
                    startedAt: OneUptimeDate.getCurrentDate(),
                },
                props: {
                    isRoot: true,
                },
            });

            // form a run stack.

            const runStack: RunStack = await this.makeRunStack(workflow.graph);

            const getVariableResult: {
                storageMap: StorageMap;
                variables: Array<WorkflowVariable>;
            } = await this.getVariables(workflow.projectId!, workflow.id!);

            // get storage map with variables.
            const storageMap: StorageMap = getVariableResult.storageMap;
            variables = getVariableResult.variables;

            // start execute different components.
            let executeComponentId: string = runStack.startWithComponentId;

            const fifoStackOfComponentsPendingExecution: Array<string> = [
                executeComponentId,
            ];
            const componentsExecuted: Array<string> = [];

            const setDidErrorOut: Function = () => {
                didWorkflowErrorOut = true;
            };
            // make variable map

            while (fifoStackOfComponentsPendingExecution.length > 0) {
                if (didWorkflowTimeOut) {
                    throw new TimeoutException(
                        'Workflow execution time was more than ' +
                            runProps.timeout +
                            'ms and workflow timed-out.'
                    );
                }

                // get component.
                // and remoev that component from the stack.
                executeComponentId =
                    fifoStackOfComponentsPendingExecution.shift()!;

                if (componentsExecuted.includes(executeComponentId)) {
                    throw new BadDataException(
                        'Cyclic Workflow Detected. Cannot execute ' +
                            executeComponentId +
                            ' when it has already been executed.'
                    );
                }

                componentsExecuted.push(executeComponentId);

                this.log('Executing Component: ' + executeComponentId);

                const stackItem: RunStackItem | undefined =
                    runStack.stack[executeComponentId];

                if (!stackItem) {
                    throw new BadDataException(
                        'Component with ID ' +
                            executeComponentId +
                            ' not found.'
                    );
                }

                // execute this stack.
                if (stackItem.node.componentType === ComponentType.Trigger) {
                    // this is already executed. So, place its arguments inside of storage map.
                    storageMap.local.components[stackItem.node.id] = {
                        returnValues: runProps.arguments,
                    };

                    this.log('Trigger args:');
                    this.log(runProps.arguments);

                    // need port to be executed.
                    const nodesToBeExecuted: Array<string> | undefined =
                        Object.keys(stackItem.outPorts)
                            .map((outport: string) => {
                                return stackItem.outPorts[outport] || [];
                            })
                            .flat();

                    if (nodesToBeExecuted && nodesToBeExecuted.length > 0) {
                        nodesToBeExecuted.forEach((item: string) => {
                            // if its not in the stack, then add it to execution stack.
                            if (
                                !fifoStackOfComponentsPendingExecution.includes(
                                    item
                                )
                            ) {
                                fifoStackOfComponentsPendingExecution.push(
                                    item
                                );
                            }
                        });
                    }
                } else {
                    // now actually run this component.

                    const args: JSONObject = this.getComponentArguments(
                        storageMap,
                        stackItem.node
                    );

                    this.log('Component Args:');
                    this.log(args);
                    this.log('Component Logs: ' + executeComponentId);
                    const result: RunReturnType = await this.runComponent(
                        args,
                        stackItem.node,
                        setDidErrorOut
                    );

                    if (didWorkflowErrorOut) {
                        throw new BadDataException(
                            'Workflow stopped because of an error'
                        );
                    }

                    this.log(
                        'Completed Execution Component: ' + executeComponentId
                    );
                    this.log('Data Returned');
                    this.log(result.returnValues);
                    this.log(
                        'Executing Port: ' + result.executePort?.title ||
                            '<None>'
                    );

                    storageMap.local.components[stackItem.node.id] = {
                        returnValues: result.returnValues,
                    };

                    const portToBeExecuted: Port | undefined =
                        result.executePort;

                    if (!portToBeExecuted) {
                        break; // stop the workflow, the process has ended.
                    }

                    const nodesToBeExecuted: Array<string> | undefined =
                        stackItem.outPorts[portToBeExecuted.id];

                    if (nodesToBeExecuted && nodesToBeExecuted.length > 0) {
                        nodesToBeExecuted.forEach((item: string) => {
                            // if its not in the stack, then add it to execution stack.
                            if (
                                !fifoStackOfComponentsPendingExecution.includes(
                                    item
                                )
                            ) {
                                fifoStackOfComponentsPendingExecution.push(
                                    item
                                );
                            }
                        });
                    }
                }
            }

            // collect logs and update status.
            this.cleanLogs(variables);
            // update workflow log.
            await WorkflowLogService.updateOneById({
                id: runProps.workflowLogId,
                data: {
                    workflowStatus: WorkflowStatus.Success,
                    logs: this.logs.join('\n'),
                    completedAt: OneUptimeDate.getCurrentDate(),
                },
                props: {
                    isRoot: true,
                },
            });
        } catch (err: any) {
            logger.error(err);
            this.log(err.toString());

            if (!runProps.workflowLogId) {
                return;
            }

            this.cleanLogs(variables);

            if (err instanceof TimeoutException) {
                this.log('Workflow Timed out.');

                // update workflow log.
                await WorkflowLogService.updateOneById({
                    id: runProps.workflowLogId,
                    data: {
                        workflowStatus: WorkflowStatus.Timeout,
                        logs: this.logs.join('\n'),
                        completedAt: OneUptimeDate.getCurrentDate(),
                    },
                    props: {
                        isRoot: true,
                    },
                });
            } else {
                // update workflow log.
                await WorkflowLogService.updateOneById({
                    id: runProps.workflowLogId,
                    data: {
                        workflowStatus: WorkflowStatus.Error,
                        logs: this.logs.join('\n'),
                        completedAt: OneUptimeDate.getCurrentDate(),
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }
        }
    }

    public cleanLogs(variables: Array<WorkflowVariable>): void {
        for (let i: number = 0; i < this.logs.length; i++) {
            if (!this.logs[i]) {
                continue;
            }

            for (const variable of variables) {
                if (variable.isSecret) {
                    if (this.logs[i]!.includes(variable.content!)) {
                        this.logs[i] = this.logs[i]!.replace(
                            variable.content!,
                            'xxxxxxxxxxxxxxx'
                        );
                    }
                }
            }
        }
    }

    public getComponentArguments(
        storageMap: StorageMap,
        component: NodeDataProp
    ): JSONObject {
        // pick arguments from storage map.
        const argumentObj: JSONObject = {};

        const serializeValueForJSON: Function = (value: string): string => {
            if (!value) {
                return value;
            }

            return value.replace(/\n/g, '\\n');
        };

        const deepFind: Function = (
            obj: JSONObject,
            path: string
        ): JSONValue => {
            const paths: Array<string> = path.split('.');
            let current: any = JSON.parse(JSON.stringify(obj));

            for (let i: number = 0; i < paths.length; ++i) {
                const key: string | undefined = paths[i];

                if (!key) {
                    return undefined;
                }
                const openBracketIndex: number = key.indexOf('[');
                const closeBracketIndex: number = key.indexOf(']');

                if (openBracketIndex !== -1 && closeBracketIndex !== -1) {
                    const arrayKey: string = key.slice(0, openBracketIndex);
                    const index: number = parseInt(
                        key.slice(openBracketIndex + 1, closeBracketIndex)
                    );

                    if (
                        Array.isArray(current[arrayKey]) &&
                        current[arrayKey][index]
                    ) {
                        current = current[arrayKey][index];
                    } else {
                        return undefined;
                    }
                } else if (current && current[key] !== undefined) {
                    current = current[key];
                } else {
                    return undefined;
                }
            }

            return current;
        };

        for (const argument of component.metadata.arguments) {
            if (!component.arguments[argument.id]) {
                continue;
            }

            let argumentContent: JSONValue | undefined =
                component.arguments[argument.id];

            if (!argumentContent) {
                continue;
            }

            if (
                typeof argumentContent === 'string' &&
                argumentContent.toString().includes('{{') &&
                argumentContent.toString().includes('}}')
            ) {
                let argumentContentCopy: string = argumentContent.toString();
                const variablesInArgument: Array<string> = [];

                const regex: RegExp = /{{(.*?)}}/g; // Find all matches of the regular expression and capture the word between the braces {{x}} => x

                let match: RegExpExecArray | null = null;

                while ((match = regex.exec(argumentContentCopy)) !== null) {
                    if (match[1]) {
                        variablesInArgument.push(match[1]);
                    }
                }

                for (const variable of variablesInArgument) {
                    const value: string = deepFind(
                        storageMap as any,
                        variable as any
                    );

                    if (argumentContentCopy.trim() === '{{' + variable + '}}') {
                        argumentContentCopy = value;
                    } else {
                        argumentContentCopy = argumentContentCopy.replace(
                            '{{' + variable + '}}',
                            argument.type === ComponentInputType.JSON
                                ? serializeValueForJSON(value)
                                : `${value}`
                        );
                    }
                }

                argumentContent = argumentContentCopy;
            }

            argumentObj[argument.id] = argumentContent;
        }

        return argumentObj;
    }

    public async runComponent(
        args: JSONObject,
        node: NodeDataProp,
        onError: Function
    ): Promise<RunReturnType> {
        // takes in args and returns values.
        const ComponentCode: ComponentCode | undefined =
            Components[node.metadata.id];

        if (ComponentCode) {
            const instance: ComponentCode = ComponentCode;
            return await instance.run(args, {
                log: (data: string | JSONObject | JSONArray) => {
                    this.log(data);
                },
                workflowId: this.workflowId!,
                workflowLogId: this.workflowLogId!,
                projectId: this.projectId!,
                onError: (exception: Exception) => {
                    this.log(exception);
                    onError();
                    return exception;
                },
            });
        }

        throw new BadDataException(
            'Component ' + node.metadata.id + ' not found'
        );
    }

    public async getVariables(
        projectId: ObjectID,
        workflowId: ObjectID
    ): Promise<{ storageMap: StorageMap; variables: Array<WorkflowVariable> }> {
        /// get local and global variables.
        const localVariables: Array<WorkflowVariable> =
            await WorkflowVariableService.findBy({
                query: {
                    workflowId: workflowId,
                },
                select: {
                    name: true,
                    content: true,
                    isSecret: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        const globalVariables: Array<WorkflowVariable> =
            await WorkflowVariableService.findBy({
                query: {
                    workflowId: QueryHelper.isNull(),
                    projectId: projectId,
                },
                select: {
                    name: true,
                    content: true,
                    isSecret: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        const newStorageMap: StorageMap = {
            local: {
                variables: {},
                components: {},
            },
            global: {
                variables: {},
            },
        };

        for (const variable of localVariables) {
            newStorageMap.local.variables[variable.name as string] =
                variable.content as string;
        }

        for (const variable of globalVariables) {
            newStorageMap.global.variables[variable.name as string] =
                variable.content as string;
        }

        return {
            storageMap: newStorageMap,
            variables: [...localVariables, ...globalVariables],
        };
    }

    public log(data: string | JSONObject | JSONArray | Exception): void {
        if (!this.logs) {
            this.logs = [];
        }

        if (data instanceof Exception) {
            data = data.getMessage();
        }

        if (typeof data === 'string') {
            this.logs.push(
                OneUptimeDate.getCurrentDateAsFormattedString() + ': ' + data
            );
        } else {
            this.logs.push(
                OneUptimeDate.getCurrentDateAsFormattedString() +
                    ': ' +
                    JSON.stringify(data)
            );
        }
    }

    public async makeRunStack(graph: JSONObject): Promise<RunStack> {
        const nodes: Array<any> = graph['nodes'] as Array<any>;

        const edges: Array<any> = graph['edges'] as Array<any>;

        if (nodes.length === 0) {
            return {
                startWithComponentId: '',
                stack: {},
            };
        }

        const runStackItems: Dictionary<RunStackItem> = {};

        for (const node of nodes) {
            if (
                (node.data as NodeDataProp).nodeType ===
                NodeType.PlaceholderNode
            ) {
                continue;
            }

            const item: RunStackItem = {
                outPorts: {},
                node: node.data as NodeDataProp,
            };

            if (!AllComponents[item.node.metadataId]) {
                // metadata not found.
                throw new BadDataException(
                    'Metadata not found for ' + item.node.metadataId
                );
            }

            item.node.metadata = AllComponents[
                item.node.metadataId
            ] as ComponentMetadata;

            // check other components connected to this component.

            const thisComponentId: string = node.id;

            for (const edge of edges) {
                if (edge.source !== thisComponentId) {
                    // this edge does not connect to this component.
                    continue;
                }

                if (!item.outPorts[edge['sourceHandle']]) {
                    item.outPorts[edge['sourceHandle']] = [];
                }

                const connectedNode: any = nodes.find((n: any) => {
                    return n.id === edge.target;
                });

                if (connectedNode) {
                    item.outPorts[edge['sourceHandle']]?.push(
                        (connectedNode.data as NodeDataProp).id
                    );
                }
            }

            runStackItems[node.data.id] = item;
        }

        const trigger: any | undefined = nodes.find((n: any) => {
            return (
                (n.data as NodeDataProp).componentType ===
                    ComponentType.Trigger &&
                (n.data as NodeDataProp).nodeType === NodeType.Node
            );
        });

        return {
            stack: runStackItems,
            startWithComponentId: trigger
                ? (trigger.data as NodeDataProp).id
                : '',
        };
    }
}
