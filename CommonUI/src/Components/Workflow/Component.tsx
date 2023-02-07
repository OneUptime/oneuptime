import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, useState } from 'react';
import { Handle, Position, Connection } from 'reactflow';
import Icon, { ThickProp } from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface NodeDataProp {
    nodeData: JSONObject;
    title: string;
    id: string;
    description: string;
    icon: IconProp;
    isTrigger: boolean;
    onDeleteClick: (id: string) => void;
    onClick: (node: NodeDataProp) => void;
}

export interface ComponentProps {
    data: NodeDataProp;
}

const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const [isHovering, setIsHovering] = useState<boolean>(false);

    const handleStyle: React.CSSProperties = {
        background: '#4b5563',
        height: '0.75rem',
        width: '0.75rem',
    };

    return (
        <div
            onMouseOver={() => {
                setIsHovering(true);
            }}
            onMouseOut={() => {
                setIsHovering(false);
            }}
            style={{
                width: '15rem',
                height: '8rem',
                padding: '1rem',
                borderColor: isHovering ? '#111827' : '#4b5563',
                borderRadius: '0.25rem',
                borderWidth: '2px',
                backgroundColor: 'white',
                boxShadow:
                    '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
            }}
            onClick={() => {
                props.data.onClick(props.data);
            }}
        >
            {isHovering && (
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

            {!props.data.isTrigger && (
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
                            color: isHovering ? '#111827' : '#4b5563',
                            width: '1.5rem',
                            height: '1.5rem',
                            textAlign: 'center',
                            margin: 'auto',
                        }}
                    />
                    <p
                        style={{
                            color: isHovering ? '#111827' : '#4b5563',
                            fontSize: '0.875rem',
                            lineHeight: '1.25rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        {props.data.title}
                    </p>
                    <p
                        style={{
                            color: isHovering ? '#111827' : '#6b7280',
                            fontSize: '0.875rem',
                            textAlign: 'center',
                        }}
                    >
                        ({props.data.id})
                    </p>
                    <p
                        style={{
                            color: isHovering ? '#111827' : '#6b7280',
                            fontSize: '0.775rem',
                            lineHeight: '0.8rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        {props.data.description}
                    </p>
                </div>
            </div>

            <Handle
                type="source"
                id="a"
                onConnect={(_params: Connection) => {}}
                isConnectable={true}
                position={Position.Bottom}
                style={handleStyle}
            />
        </div>
    );
};

export default Node;
