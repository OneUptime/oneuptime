import React, { ReactElement, Fragment, FunctionComponent } from 'react';

export interface ComponentProps {
    name: string;
    role: string;
}

const UserInfo: FunctionComponent<ComponentProps> = ({
    name,
    role,
}: ComponentProps): ReactElement => {
    return (
        <Fragment>
            <h3 className="modal-text">{name}</h3>
            <p className="modal-text text">{role}</p>
            <hr />
        </Fragment>
    );
};

export default UserInfo;
