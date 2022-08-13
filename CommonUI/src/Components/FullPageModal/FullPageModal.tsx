import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';

export interface ComponentProps {
    onClose: () => void; 
    children: ReactElement | Array<ReactElement>
}

const FullPageModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="full-page-modal">
            <div className='margin-50 align-right' onClick={() => {
                props.onClose && props.onClose();
            }}>
                <Icon icon={IconProp.Close} size={SizeProp.ExtraLarge} thick={ThickProp.Thick} />
            </div>
            {props.children}
       </div>
    );
};

export default FullPageModal;
