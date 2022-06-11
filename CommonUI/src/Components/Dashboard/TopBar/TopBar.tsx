import React, { FunctionComponent, ReactElement } from 'react';
import './TopBar.scss';

export interface ComponentProps {
    leftContent?: Array<ReactElement>;
    middleContent?: Array<ReactElement>;
    rightContent?: Array<ReactElement>;
}

const TopBar: FunctionComponent<ComponentProps> = ({
    leftContent,
    rightContent,
    middleContent,
}: ComponentProps): ReactElement => {
    return (
        <div className="root">
            <header>
                <div>
                    {leftContent?.map(
                        (content: ReactElement, index: number) => {
                            return <div key={index}>{content}</div>;
                        }
                    )}
                </div>
                <div className="middle">
                    {middleContent?.map(
                        (content: ReactElement, index: number) => {
                            return <div key={index}>{content}</div>;
                        }
                    )}
                </div>
                <div className="right">
                    {rightContent?.map(
                        (content: ReactElement, index: number) => {
                            return (
                                <React.Fragment key={index}>
                                    {content}
                                </React.Fragment>
                            );
                        }
                    )}
                </div>
            </header>
        </div>
    );
};

export default TopBar;
