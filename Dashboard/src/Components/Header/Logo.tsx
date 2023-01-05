// Tailwind

import React, { FunctionComponent, ReactElement } from 'react';
import Image from 'CommonUI/src/Components/Image/Image';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    onClick: () => void;
}

const Logo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (<div className="relative z-10 flex px-2 lg:px-0">
        <div className="flex flex-shrink-0 items-center">
            <Image
                className="block h-8 w-auto"
                onClick={() => {
                    props.onClick && props.onClick();
                }}
                imageUrl={Route.fromString(`${OneUptimeLogo}`)}
                alt={"OneUptime"}
            />
        </div>
    </div>)
};

export default Logo;
