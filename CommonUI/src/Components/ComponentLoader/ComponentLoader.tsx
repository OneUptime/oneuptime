
import React, { FunctionComponent, ReactElement } from 'react';
import CompactLoader from './CompactLoader';

const ComponentLoader: FunctionComponent = (): ReactElement => {
    return (
        <div className="my-15">
            <CompactLoader />
        </div>
    );
};

export default ComponentLoader;
