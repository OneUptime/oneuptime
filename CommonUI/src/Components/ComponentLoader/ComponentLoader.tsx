import { VeryLightGrey } from 'Common/Types/BrandColors';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import Loader, { LoaderType } from '../Loader/Loader';

const ComponentLoader: FunctionComponent = (): ReactElement => {
    return (
        <div className="my-20">
            <Loader
                loaderType={LoaderType.Bar}
                color={VeryLightGrey}
                size={200}
            />
        </div>
    );
};

export default ComponentLoader;
