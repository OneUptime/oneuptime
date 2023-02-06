import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent } from 'react';
import { Handle, Position } from 'reactflow';
import Icon, { IconProp } from '../Icon/Icon';


export interface NodeDataProp {
    nodeData: JSONObject;
    title: string;
    id: string;
    description: string;
    icon: IconProp;
}

export interface ComponentProps {
    data: NodeDataProp;
}


const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {

    const handleStyle = {
        background: "#475569",
        height: "0.75rem",
        width: "0.75rem",

    }

    return (
        <div style={{
            width: "15rem", height: "8rem", padding: "1rem", borderColor: "#475569", borderRadius: "0.25rem", borderWidth: "2px", backgroundColor: "white", boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)"
        }
        }>
            <Handle
                type="target"
                onConnect={(params) => console.log('handle onConnect', params)}
                isConnectable={true}
                position={Position.Top}
                style={handleStyle}
            />

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <div style={{
                    margin: "auto"
                }}>
                    <Icon icon={props.data.icon} style={{
                        color: "#475569",
                        width: "1.5rem",
                        height: "1.5rem",
                        textAlign: "center",
                        margin: "auto"
                    }} />
                    <p style={{
                        color: "#475569", fontSize: "0.875rem",
                        lineHeight: "1.25rem",
                        textAlign: "center",
                        marginTop: "6px"
                    }}>{props.data.title}</p>
                    <p style={{
                        color: "#475569", fontSize: "0.875rem",
                        textAlign: "center",
                    }}>({props.data.id})</p>
                    <p style={{
                        color: "#64748b", fontSize: "0.775rem",
                        lineHeight: "0.8rem",
                        textAlign: "center",
                        marginTop: "6px"

                    }}>{props.data.description}</p>
                </div>
            </div>

            <Handle
                type="source"
                id="a"
                isConnectable={true}
                position={Position.Bottom}
                style={handleStyle}
            />
        </div>

    );
};

export default Node; 
