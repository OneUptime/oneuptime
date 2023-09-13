import React, { FunctionComponent, ReactElement } from 'react';
import Help from './Help';
import Header from 'CommonUI/src/Components/Header/Header';
import Logo from './Logo';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { DASHBOARD_URL } from 'CommonUI/src/Config';
import UserProfile from './UserProfile';

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
                        <Button
                            title="Exit Admin"
                            buttonStyle={ButtonStyleType.NORMAL}
                            onClick={() => {
                                Navigation.navigate(DASHBOARD_URL);
                            }}
                        />
                        <Help />
                        <UserProfile />
                    </>
                }
            />
        </>
    );
};

export default DashboardHeader;
