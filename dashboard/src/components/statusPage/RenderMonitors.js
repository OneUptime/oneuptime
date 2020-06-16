import React from 'react';
import PropTypes from 'prop-types';
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

RenderMonitors.displayName = 'RenderMonitors';
RenderMonitors.propTypes = {
    fields: PropTypes.object.isRequired,
    subProject: PropTypes.object.isRequired,
};

export { RenderMonitors };
