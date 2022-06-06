import React, { ReactElement, Fragment, FC } from 'react';

export interface ComponentProps {
    name: string;
    role: string;
}

const UserInfo: FC<ComponentProps> = ({ name, role }): ReactElement => {
    return (
        <Fragment>
            <h3 className="modal-text">{name}</h3>
            <p className="modal-text text">{role}</p>
            <hr />
        </Fragment>
    );
};

export default UserInfo;
