import React, { FunctionComponent, ReactElement } from 'react';
import Image from 'CommonUI/src/Components/Image/Image';
import File from 'Model/Models/File';

export interface ComponentProps {
    onClick?: () => void | undefined;
    file?: File | undefined;
}

const Banner: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.file) {
        return <></>;
    }

    return (
        <div>
            <Image
                onClick={() => {
                    props.onClick && props.onClick();
                }}
                className="rounded-xl w-full mt-5 mb-5"
                file={props.file}
            />
        </div>
    );
};

export default Banner;
