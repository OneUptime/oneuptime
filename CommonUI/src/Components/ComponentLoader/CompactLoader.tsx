import { VeryLightGrey } from 'Common/Types/BrandColors';
import React, { FunctionComponent, ReactElement } from 'react';
import Loader, { LoaderType } from '../Loader/Loader';

const CompactLoader: FunctionComponent = (): ReactElement => {
    return (
        <div className="my-5 w-full flex justify-center">
            <Loader
                loaderType={LoaderType.Bar}
                color={VeryLightGrey}
                size={200}
            />
        </div>
    );
};

export default CompactLoader;
