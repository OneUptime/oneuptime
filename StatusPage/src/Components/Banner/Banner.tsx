import React, { FunctionComponent, ReactElement } from 'react';
import Image from 'CommonUI/src/Components/Image/Image';
import PlaceholderBanner from 'CommonUI/src/Images/banner/placeholder.png';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    onClick?: () => void | undefined;
}

const Banner: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex items-center" style={{ marginLeft: '-25px' }}>
            <Image
                onClick={() => {
                    props.onClick && props.onClick();
                }}
                imageUrl={Route.fromString(
                    `/status-page/public/${PlaceholderBanner}`
                )}
            />
        </div>
    );
};

export default Banner;
