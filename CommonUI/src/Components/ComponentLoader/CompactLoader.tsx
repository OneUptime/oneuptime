import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGray } from 'Common/Types/BrandColors';
import React, { ReactElement } from 'react';

const CompactLoader: () => JSX.Element = (): ReactElement => {
    return (
        <div className="my-5 w-full flex justify-center">
            <Loader
                loaderType={LoaderType.Bar}
                color={VeryLightGray}
                size={200}
            />
        </div>
    );
};

export default CompactLoader;
