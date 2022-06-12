import React, { FunctionComponent, ReactElement } from 'react';
import MenuButton, {
    ComponentProps,
} from '../../../Basic/Button/MenuButton/MenuButton';
import './MenuButton.scss';

const TopBarMenyuButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <MenuButton
            style={{
                fontSize: '13px',
                borderColor: 'black',
                borderStyle: 'solid',
                borderRadius: '20px',
                paddingRight: '10px',
                borderWidth: '1px',
                paddingLeft: '10px',
                background: 'transparent',
                color: 'black',
            }}
            {...props}
        >
            {props.children}
        </MenuButton>
    );
};

export default TopBarMenyuButton;
