import React, { FunctionComponent, ReactElement } from 'react';
import FullLogo from "CommonUI/src/Components/Header/Logo";
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';

export interface ComponentProps {
    onClick: () => void; 
}

const Logo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div className='flex items-center' style={{marginLeft: "-25px"}}><FullLogo onClick={() => {
        props.onClick && props.onClick();
    }} logo={`/dashboard/public/${OneUptimeLogo}`} /></div>
};

export default Logo;
