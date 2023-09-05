import React, { FunctionComponent, ReactElement } from 'react';
import Help from './Help';
import Header from 'CommonUI/src/Components/Header/Header';
import Logo from './Logo';

const DashboardHeader: FunctionComponent = (): ReactElement => {
    return (
        <>
           
            <Header
                leftComponents={
                    <>
                        <Logo onClick={() => {}} />
                    </>
                }
                centerComponents={
                    <>
                        {/* <SearchBox
                            key={2}
                            selectedProject={props.selectedProject}
                            onChange={(_value: string) => { }}
                        />{' '} */}
                    </>
                }
                rightComponents={
                    <>
                        <Help />
                    </>
                }
            />
        </>
    );
};

export default DashboardHeader;
