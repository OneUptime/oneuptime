import { VeryLightGrey } from 'Common/Types/BrandColors';
import React, { ReactElement } from 'react';
import Loader, { LoaderType } from '../Loader/Loader';

const CompactLoader: () => React.JSX.Element = (): ReactElement => {
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
