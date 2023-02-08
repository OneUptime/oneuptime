import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, useState } from 'react';
import { Handle, Position, Connection } from 'reactflow';
import Icon, { ThickProp } from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import { ComponentType } from 'Common/Types/Workflow/Component';

export enum NodeType {
    Node = 'Node',
    PlaceholderNode = 'PlaceholderNode',
}

export interface NodeDataProp {
    nodeData: JSONObject;
    title: string;
    id: string;
    description: string;
    icon: IconProp;
    componentType: ComponentType;
    nodeType: NodeType;
    onDeleteClick?: (id: string) => void | undefined;
    onClick?: (node: NodeDataProp) => void | undefined;
    isPreview?: boolean | undefined; // is this used to show in the components modal?
}

export interface ComponentProps {
    data: NodeDataProp;
}

const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const [isHovering, setIsHovering] = useState<boolean>(false);

    let textColor = '#4b5563';
    let descriptionColor = '£6b7280';

    if (isHovering) {
        textColor = '#111827';
        descriptionColor = '£111827';
    }

    let componentStyle: React.CSSProperties = {
        width: '15rem',
        height: '8rem',
        padding: '1rem',
        borderColor: textColor,
        borderRadius: '0.25rem',
        borderWidth: '2px',
        backgroundColor: 'white',
        boxShadow:
            '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    };

    let handleStyle: React.CSSProperties = {
        background: '#4b5563',
        height: '0.75rem',
        width: '0.75rem',
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
            onMouseOver={() => {
                setIsHovering(true);
            }}
            onMouseOut={() => {
                setIsHovering(false);
            }}
            style={componentStyle}
            onClick={() => {
                if (props.data.onClick) {
                    props.data.onClick(props.data);
                }
            }}
        >
            {!props.data.isPreview &&
                isHovering &&
                props.data.nodeType !== NodeType.PlaceholderNode && (
                    <div
                        style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '100px',
                            background: '#ef4444',
                            position: 'absolute',
                            top: '-9px',
                            left: '228px',
                            cursor: 'pointer',
                        }}
                        onClick={() => {
                            if (props.data.onDeleteClick) {
                                props.data.onDeleteClick(props.data.id);
                            }
                        }}
                    >
                        <Icon
                            icon={IconProp.Close}
                            style={{
                                color: 'white',
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
                props.data.componentType !== ComponentType.Trigger && (
                    <Handle
                        type="target"
                        onConnect={(_params: Connection) => {}}
                        isConnectable={true}
                        position={Position.Top}
                        style={handleStyle}
                    />
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
                    }}
                >
                    <Icon
                        icon={props.data.icon}
                        style={{
                            color: textColor,
                            width: '1.5rem',
                            height: '1.5rem',
                            textAlign: 'center',
                            margin: 'auto',
                        }}
                    />
                    <p
                        style={{
                            color: textColor,
                            fontSize: '0.875rem',
                            lineHeight: '1.25rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        {props.data.title}
                    </p>
                    {!props.data.isPreview && props.data.id && (
                        <p
                            style={{
                                color: descriptionColor,
                                fontSize: '0.875rem',
                                textAlign: 'center',
                            }}
                        >
                            ({props.data.id})
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
                        {props.data.description}
                    </p>
                </div>
            </div>

            {!props.data.isPreview &&
                props.data.nodeType !== NodeType.PlaceholderNode && (
                    <Handle
                        type="source"
                        id="a"
                        onConnect={(_params: Connection) => {}}
                        isConnectable={true}
                        position={Position.Bottom}
                        style={handleStyle}
                    />
                )}
        </div>
    );
};

export default Node;
