import React, { FunctionComponent, ReactElement } from 'react';
import './TopBar.scss';

export interface ComponentProps {
    leftContents?: Array<ReactElement>;
    middleContents?: Array<ReactElement>;
    rightContents?: Array<ReactElement>;
}

const TopBar: FunctionComponent<ComponentProps> = ({
    leftContents,
    rightContents,
    middleContents,
}): ReactElement => {
    return (
        <div className="root">
            <header>
                <div>
                    {leftContents?.map(
                        (content: ReactElement, index: number) => (
                            <div key={index}>{content}</div>
                        )
                    )}
                </div>
                <div className="middle">
                    {middleContents?.map(
                        (content: ReactElement, index: number) => (
                            <div key={index}>{content}</div>
                        )
                    )}
                </div>
                <div className="right">
                    {rightContents?.map(
                        (content: ReactElement, index: number) => (
                            <div key={index}>{content}</div>
                        )
                    )}
                </div>
            </header>
            <nav></nav>
        </div>
    );
};

export default TopBar;
