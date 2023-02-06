import React, { FunctionComponent, useState } from 'react';
import { Connection, Handle, Position } from 'reactflow';
import Icon, { IconProp } from '../Icon/Icon';
import { NodeDataProp } from './Component';


export interface ComponentProps {
    data: NodeDataProp;
}

const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const [isHovering, setIsHovering] = useState<boolean>(false);

    const handleStyle: React.CSSProperties = {
        background: '#cbd5e1',
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
                borderStyle: 'dashed',
                width: '15rem',
                height: '8rem',
                padding: '1rem',
                borderColor: isHovering ? '#94a3b8' : '#cbd5e1',
                borderRadius: '0.25rem',
                borderWidth: '2px',
                backgroundColor: 'white',
            }}
        >
            {!props.data.isTrigger && (
                <Handle
                    type="target"
                    onConnect={(_params: Connection) => { }}
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
                        icon={
                            props.data.isTrigger ? IconProp.Bolt : IconProp.Add
                        }
                        style={{
                            color: isHovering ? '#94a3b8' : '#cbd5e1',
                            width: '1.5rem',
                            height: '1.5rem',
                            textAlign: 'center',
                            margin: 'auto',
                            marginTop: '5px',
                        }}
                    />
                    <p
                        style={{
                            color: isHovering ? '#94a3b8' : '#cbd5e1',
                            fontSize: '0.875rem',
                            lineHeight: '1.25rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        {props.data.isTrigger
                            ? 'Add a Trigger'
                            : 'Add a Component'}
                    </p>
                    <p
                        style={{
                            color: isHovering ? '#94a3b8' : '#cbd5e1',
                            fontSize: '0.775rem',
                            lineHeight: '0.8rem',
                            textAlign: 'center',
                            marginTop: '6px',
                        }}
                    >
                        Click to add a new{' '}
                        {props.data.isTrigger ? 'trigger' : 'component'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Node;
