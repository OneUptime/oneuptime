import React, { FunctionComponent, ReactElement } from 'react';
import SquareLogo from "CommonUI/src/Components/Header/SquareLogo";
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';

export interface ComponentProps {
    onClick: () => void; 
}

const Logo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <SquareLogo onClick={() => {
        props.onClick && props.onClick();
    }} logo={`/dashboard/public/${OneUptimeLogo}`} />
};

export default Logo;
