import React, { ReactElement } from 'react';
import CompactLoader from './CompactLoader';

const ComponentLoader: () => JSX.Element = (): ReactElement => {
    return (
        <div className="my-16" data-testid="component-loader">
            <CompactLoader />
        </div>
    );
};

export default ComponentLoader;
