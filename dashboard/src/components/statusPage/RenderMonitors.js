import React from 'react';
import { RenderMonitor } from './RenderMonitor';

const RenderMonitors = ({ fields, subProject }) => (
    <ul>
        {fields.map((monitor, index) => (
            <RenderMonitor
                key={index}
                monitorIndex={index}
                monitor={monitor}
                fields={fields}
                subProject={subProject}
            />
        ))}
    </ul>
);

export { RenderMonitors };
