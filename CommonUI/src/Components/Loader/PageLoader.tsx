import React, { FunctionComponent, ReactElement } from 'react';
import Loader, { LoaderType } from './Loader';
import { VeryLightGrey } from 'Common/Types/BrandColors';

export interface ComponentProps {
    isVisible: boolean;
}

const PageLoader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.isVisible) {
        return (
            <div className="m-auto w-full text-center w-max mt-52 align-middle flex items-center">
                <Loader loaderType={LoaderType.Bar} color={VeryLightGrey} size={200} />
            </div>
        );
    }
    return <></>;
};

export default PageLoader;
