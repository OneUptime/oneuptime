import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const SideMenu: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    let children: Array<ReactElement> = [];
    if (!Array.isArray(props.children)) {
        children = [props.children];
    } else {
        children = props.children;
    }

    return (
        <div className="email-leftbar card" style={{ borderColor: 'black' }}>
            {children.map((child: ReactElement, i: number) => {
                return (
                    <div key={i}>
                        {child}
                        {i !== children.length - 1 && (
                            <div className="mt-4"></div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default SideMenu;
