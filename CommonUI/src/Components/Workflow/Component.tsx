import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, useState } from 'react';
import { Handle, Position, Connection } from 'reactflow';
import Icon, { ThickProp } from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import ComponentMetadata, {
    ComponentType,
    Port,
} from 'Common/Types/Workflow/Component';
import Tooltip from '../Tooltip/Toolip';

export enum NodeType {
    Node = 'Node',
    PlaceholderNode = 'PlaceholderNode',
}

export interface NodeDataProp {
    nodeData: JSONObject;
    error: string;
    id: string;
    nodeType: NodeType;
    onClick?: (node: NodeDataProp) => void | undefined;
    isPreview?: boolean | undefined; // is this used to show in the components modal?
    metadata: ComponentMetadata;
    metadataId: string;
    internalId: string;
}

export interface ComponentProps {
    data: NodeDataProp;
}

const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const [isHovering, setIsHovering] = useState<boolean>(false);

    let textColor: string = '#6b7280';
    let descriptionColor: string = '#6b7280';

    if (isHovering) {
        textColor = '#111827';
        descriptionColor = '#111827';
    }

    let componentStyle: React.CSSProperties = {
        width: '15rem',
        height: '10rem',
        padding: '1rem',
        borderColor: textColor,
        alignItems: 'center',
        borderRadius: '0.25rem',
        borderWidth: '2px',
        backgroundColor: 'white',
        display: 'inline-block',
        verticalAlign: 'middle',
        boxShadow:
            '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    };

    let handleStyle: React.CSSProperties = {
        background: '#6b7280',
        height: '0.75rem',
        width: '0.75rem',
    };

    const getPortPosition: Function = (
        portCount: number,
        totalPorts: number,
        isLabel: boolean | undefined
    ): React.CSSProperties => {
        if (portCount === 1 && totalPorts === 1) {
            return isLabel ? {left: 100} : {};
        }

        if (portCount === 1 && totalPorts === 2) {
            return { left: isLabel ? 70 : 80 };
        }

        if (portCount === 2 && totalPorts === 2) {
            return { left: isLabel ? 150 : 160 };
        }

        if (portCount === 1 && totalPorts === 3) {
            return { left: isLabel ? 70 : 80 };
        }

        if (portCount === 2 && totalPorts === 3) {
            return isLabel ? {left: 100} : {};
        }

        if (portCount === 3 && totalPorts === 3) {
            return { left: isLabel ? 150 : 160 };
        }

        // default
        return {};
    };

    if (props.data.nodeType === NodeType.PlaceholderNode) {
        handleStyle = {
            background: '#cbd5e1',
            height: '0.75rem',
            width: '0.75rem',
        };

        componentStyle = {
            borderStyle: 'dashed',
            width: '15rem',
            height: '8rem',
            padding: '1rem',
            display: 'inline-block',
            alignItems: 'center',
            verticalAlign: 'middle',
            borderColor: isHovering ? '#94a3b8' : '#cbd5e1',
            borderRadius: '0.25rem',
            borderWidth: '2px',
            backgroundColor: 'white',
        };

        textColor = '#cbd5e1';
        descriptionColor = '#cbd5e1';

        if (isHovering) {
            textColor = '#94a3b8';
            descriptionColor = '#94a3b8';
        }
    }

    return (
        <div
            className="cursor-pointer"
            onMouseOver={() => {
                setIsHovering(true);
            }}
            onMouseOut={() => {
                setIsHovering(false);
            }}
            style={{
                ...componentStyle,
                height: props.data.id ? '12rem' : '10rem',
            }}
            onClick={() => {
                if (props.data.onClick) {
                    props.data.onClick(props.data);
                }
            }}
        >
            {!props.data.isPreview &&
                props.data.error &&
                props.data.nodeType !== NodeType.PlaceholderNode && (
                    <div
                        style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '100px',
                            color: '#ef4444',
                            position: 'absolute',
                            top: '0px',
                            left: '220px',
                            cursor: 'pointer',
                        }}
                        onClick={() => {}}
                    >
                        <Icon
                            icon={IconProp.Alert}
                            style={{
                                color: '#ef4444',
                                width: '1rem',
                                height: '1rem',
                                textAlign: 'center',
                                margin: 'auto',
                                marginTop: '2px',
                            }}
                            thick={ThickProp.Thick}
                        />
                    </div>
                )}

            {!props.data.isPreview &&
                props.data.metadata.componentType !== ComponentType.Trigger && (
                    <div>
                        {props.data.metadata.inPorts &&
                            props.data.metadata.inPorts.length > 0 &&
                            props.data.metadata.inPorts.map(
                                (port: Port, i: number) => {
                                    return (
                                        <Handle
                                            key={i}
                                            type="target"
                                            id={port.id}
                                            onConnect={(
                                                _params: Connection
                                            ) => {}}
                                            isConnectable={true}
                                            position={Position.Top}
                                            style={{
                                                ...handleStyle,
                                                ...getPortPosition(
                                                    i + 1,
                                                    props.data.metadata.inPorts
                                                        .length
                                                ),
                                            }}
                                        />
                                    );
                                }
                            )}
                    </div>
                )}

            <div
                style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                }}
            >
                <div
                    style={{
                        margin: 'auto',
                        marginTop: props.data.metadata.iconProp
                            ? '0.5rem'
                            : '1rem',
                    }}
                >
                    {props.data.metadata.iconProp && (
                        <Icon
                            icon={props.data.metadata.iconProp}
                            style={{
                                color: textColor,
                                width: '1.5rem',
                                height: '1.5rem',
                                textAlign: 'center',
                                margin: 'auto',
                            }}
                        />
                    )}
                    <p
                        style={{
                            color: textColor,
                            fontSize: '0.875rem',
                            lineHeight: '1.25rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        {props.data.metadata.title}
                    </p>
                    {!props.data.isPreview && props.data.id && (
                        <p
                            style={{
                                color: descriptionColor,
                                fontSize: '0.875rem',
                                textAlign: 'center',
                            }}
                        >
                            ({props.data.id.trim()})
                        </p>
                    )}
                    <p
                        style={{
                            color: descriptionColor,
                            fontSize: '0.775rem',
                            lineHeight: '1.0rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        {props.data.metadata.description}
                    </p>
                </div>
            </div>

            {!props.data.isPreview &&
                props.data.nodeType !== NodeType.PlaceholderNode && (
                    <>
                        <div>
                            {props.data.metadata.outPorts &&
                                props.data.metadata.outPorts.length > 0 &&
                                props.data.metadata.outPorts.map(
                                    (port: Port, i: number) => {
                                        return (
                                            <Handle
                                                key={i}
                                                type="source"
                                                id={port.id}
                                                onConnect={(
                                                    _params: Connection
                                                ) => {}}
                                                isConnectable={true}
                                                position={Position.Bottom}
                                                style={{
                                                    ...handleStyle,
                                                    ...getPortPosition(
                                                        i + 1,
                                                        props.data.metadata
                                                            .outPorts.length
                                                    ),
                                                }}
                                            />
                                        );
                                    }
                                )}
                        </div>
                        <div>
                            {props.data.metadata.outPorts &&
                                props.data.metadata.outPorts.length > 0 &&
                                props.data.metadata.outPorts.map(
                                    (port: Port, i: number) => {
                                        return (
                                            <Tooltip
                                                key={i}
                                                text={port.description || ''}
                                            >
                                                <div
                                                    key={i}
                                                    className="text-sm text-gray-400 absolute"
                                                    style={{
                                                        bottom: '10px',
                                                        ...getPortPosition(
                                                            i + 1,
                                                            props.data.metadata
                                                                .outPorts
                                                                .length,
                                                            true
                                                        ),
                                                    }}
                                                >
                                                    {port.title}
                                                </div>
                                            </Tooltip>
                                        );
                                    }
                                )}
                        </div>
                    </>
                )}
        </div>
    );
};

export default Node;
