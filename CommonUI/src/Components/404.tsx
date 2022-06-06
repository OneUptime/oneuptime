import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {}

const NotFound: FunctionComponent = (_props: ComponentProps): ReactElement => {
    return (
        <div>
            <div>
                <div>
                    <div>The page you requested does not exist.</div>
                </div>
            </div>
        </div>
    );
};
export default NotFound;
