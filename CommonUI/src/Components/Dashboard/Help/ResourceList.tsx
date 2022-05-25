import React, { ReactElement } from 'react';
import Resource from './Resource';

const ResourceList = (): ReactElement => {
    return (
        <div className="lists">
            <p className="legend">Resources</p>
            <Resource name="Support articles" openInNewTab={true} />
            <Resource name="Developer docs" openInNewTab={true} />
            <Resource name="Keyboard shortcuts" />
            <hr />
            <p className="legend">Get in touch</p>
            <Resource name="Share feedback" />
        </div>
    );
};

export default ResourceList;
