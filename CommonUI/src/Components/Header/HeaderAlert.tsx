import React, { FunctionComponent, ReactElement } from 'react';
import Alert, { ComponentProps as AlertProps } from '../Alerts/Alert';

export interface ComponentProps extends AlertProps {}

const Header: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <div className="d-flex align-items-center px-3">
                <Alert {...props} />
            </div>
        </React.Fragment>
    );
};

export default Header;
