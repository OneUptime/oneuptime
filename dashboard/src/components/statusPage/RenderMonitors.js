import React from 'react';
import { RenderMonitor } from './RenderMonitor';

const RenderMonitors = ({
  fields,
}) => (
    <ul>
      {
        fields.map(
          (monitor, index) => (
              <RenderMonitor
                key={index}
                monitorIndex={index}
                monitor={monitor}
                fields={fields}
              />
          )
        )
      }
    </ul>
  )

export { RenderMonitors };