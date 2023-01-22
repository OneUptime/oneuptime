import React, { FunctionComponent, ReactElement } from 'react';
import Image from 'CommonUI/src/Components/Image/Image';
import File from 'Model/Models/File';

export interface ComponentProps {
    onClick: () => void;
    file: File;
    style?: React.CSSProperties | undefined;
}

const Logo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex items-center">
            <Image
                file={props.file}
                onClick={props.onClick}
                height={50}
                style={props.style}
            />
        </div>
    );
};

export default Logo;
