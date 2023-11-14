import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Log from 'Model/AnalyticsModels/Log';

export interface ComponentProps {
   log: Log
}

const LogItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [isCollapsed, setIsCollapsed] = React.useState<boolean>(true);

    useEffect(() => {
        setIsCollapsed(true);
    }, [])

    if(isCollapsed){
        return (<div className='color-gray-100 flex'>
            {/* Collapsable icon when clicked should expand */}
        </div>)
    }
    
    return (
        <div className='color-gray-100'>
            {props.log.body}
        </div>
    );
};

export default LogItem;
