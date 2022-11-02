import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {}

const NoEventDay: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <div
            className="flex bottom-grey-border"
            style={{
                marginLeft: '-10px',
                marginRight: '-10px',
                marginBottom: '20px',
            }}
        >
            <div style={{ padding: '20px', paddingRight: '0px' }}>
                Oct 20, 2022
            </div>
            <div
                style={{
                    padding: '20px',
                    paddingTop: '20px',
                    marginLeft: '10px',
                }}
            >
                No incidents on this day.
            </div>
        </div>
    );
};

export default NoEventDay;
