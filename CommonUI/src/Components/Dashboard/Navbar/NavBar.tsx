import React, { ReactElement, FunctionComponent } from 'react';
import './NavBar.scss';

export interface ComponentProps {
    children: Array<ReactElement>;
    rightContent: Array<ReactElement>;
}

const NavBar: FunctionComponent<ComponentProps> = ({
    children,
    rightContent,
}: ComponentProps): ReactElement => {
    return (
        <nav>
            <div>
                <div className="navigation-rack">
                    {children.map((content: ReactElement, index: number) => {
                        return (
                            <React.Fragment key={index}>
                                {content}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
            <div>
                {rightContent.map((content: ReactElement, index: number) => {
                    return (
                        <React.Fragment key={index}>{content}</React.Fragment>
                    );
                })}
            </div>
        </nav>
    );
};

export default NavBar;
