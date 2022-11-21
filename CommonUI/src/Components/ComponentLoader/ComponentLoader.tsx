import { VeryLightGrey } from 'Common/Types/BrandColors';
import React, { FunctionComponent, ReactElement } from 'react';
import Loader, { LoaderType } from '../Loader/Loader';

const ComponentLoader: FunctionComponent = (): ReactElement => {
    return (
        <div
            className="row text-center"
            style={{
                marginTop: '50px',
                marginBottom: '50px',
                width: "100%"
            }}
        >
            <Loader
                loaderType={LoaderType.Bar}
                color={VeryLightGrey}
                size={200}
            />
        </div>
    );
};

export default ComponentLoader;
