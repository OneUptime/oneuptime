import URL from 'Common/Types/API/URL';
import Name from 'Common/Types/Name';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../../Basic/Icon/Icon';
import useComponentOutsideClick from '../../../Types/UseComponentOutsideClick';

export interface ComponentProps {
    userFullName: Name;
    children: ReactElement | Array<ReactElement>;
    userProfilePicture: URL;
}

const UserProfile: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    return (
        <div className="d-inline-block dropdown">
            <button
                onClick={() => {
                    setIsComponentVisible(!isComponentVisible);
                }}
                id="page-header-user-dropdown"
                aria-haspopup="true"
                className="btn header-item bg-soft-light border-start border-end"
                aria-expanded="false"
            >
                <img
                    className="rounded-circle header-profile-user"
                    src={props.userProfilePicture.toString()}
                    alt="Header Avatar"
                />
                <span className="d-none d-xl-inline-block ms-2 me-1">
                    {props.userFullName.toString()}
                </span>
                <Icon icon={IconProp.ChevronDown} />
            </button>
            <div ref={ref}>{isComponentVisible && props.children}</div>
        </div>
    );
};

export default UserProfile;
