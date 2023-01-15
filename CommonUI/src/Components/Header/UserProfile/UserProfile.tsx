import URL from 'Common/Types/API/URL';
import Name from 'Common/Types/Name';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../../Icon/Icon';
import Route from 'Common/Types/API/Route';
import Image from '../../Image/Image';

export interface ComponentProps {
    userFullName: Name;
    userProfilePicture: URL | Route;
    onClick: () => void; 
}

const UserProfile: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
   

    return (
        <div className="d-inline-block dropdown">
            <button
                onClick={() => {
                   props.onClick()
                }}
                id="page-header-user-dropdown"
                aria-haspopup="true"
                className="btn header-item bg-soft-light border-start border-end flex"
                aria-expanded="false"
                style={{
                    alignItems: 'center',
                }}
            >
                <Image
                    className="rounded-circle header-profile-user"
                    imageUrl={props.userProfilePicture}
                />

                <span className="d-none d-xl-inline-block ms-2 me-1">
                    {props.userFullName.toString()}
                </span>
                <Icon icon={IconProp.ChevronDown} />
            </button>
            
        </div>
    );
};

export default UserProfile;
