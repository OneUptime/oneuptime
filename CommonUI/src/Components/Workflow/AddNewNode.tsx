import React, { FunctionComponent } from 'react';
import { Handle, Position } from 'reactflow';
import Icon, { IconProp } from '../Icon/Icon';



const Node: FunctionComponent = () => {

    const handleStyle = {
        background: "#cbd5e1",
        height: "0.75rem",
        width: "0.75rem",

    }

    return (
        <div style={{
            borderStyle: "dashed",
            width: "15rem", height: "8rem", padding: "1rem", borderColor: "#cbd5e1", borderRadius: "0.25rem", borderWidth: "2px", backgroundColor: "white"
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
                    <Icon icon={IconProp.Add} style={{
                        color: "#cbd5e1",
                        width: "1.5rem",
                        height: "1.5rem",
                        textAlign: "center",
                        margin: "auto",
                        marginTop: "5px"
                    }} />
                    <p style={{
                        color: "#cbd5e1", fontSize: "0.875rem",
                        lineHeight: "1.25rem",
                        textAlign: "center",
                        marginTop: "6px"
                    }}>{"Add a Component"}</p>
                    <p style={{
                        color: "#cbd5e1", fontSize: "0.775rem",
                        lineHeight: "0.8rem",
                        textAlign: "center",
                        marginTop: "6px"

                    }}>Click to add a new component</p>
                </div>
            </div>
        </div>

    );
};

export default Node; 
