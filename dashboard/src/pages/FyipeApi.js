import React, { Component } from 'react';
import Zoom from 'react-reveal/Zoom';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import PropTypes from 'prop-types';
import APISettings from '../components/settings/APISettings';
import TutorialBox from '../components/tutorial/TutorialBox';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import RenderIfMember from '../components/basic/RenderIfMember';

class FyipeApi extends Component {
    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Zoom>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="API" />
                    <div className="db-BackboneViewContainer">
                        <div className="react-settings-view react-view">
                            <RenderIfOwner>
                                <TutorialBox type="api" />
                                <APISettings />
                            </RenderIfOwner>
                            <RenderIfMember>
                                <div className="Box-root ">
                                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                        <div className="Box-root Card-shadow--medium Border-radius--4">
                                            <div
                                                className="bs-ContentSection-content Box-root Padding-horizontal--20 Padding-vertical--12"
                                                style={{
                                                    paddingBottom: '100px',
                                                    paddingTop: '100px',
                                                }}
                                            >
                                                <div
                                                    className="db-SideNav-icon db-SideNav-icon--blocked"
                                                    style={{
                                                        backgroundRepeat:
                                                            'no-repeat',
                                                        backgroundSize:
                                                            'contain',
                                                        backgroundPosition:
                                                            'center',
                                                        height: '40px',
                                                        width: '40px',
                                                        marginRight: '50%',
                                                        marginLeft: '50%',
                                                    }}
                                                />
                                                <div
                                                    id="errorMessage"
                                                    style={{
                                                        width: '100%',
                                                        padding: '10px',
                                                        textAlign: 'center',
                                                    }}
                                                >
                                                    You are not authorized to
                                                    view this page because
                                                    you’re not an administrator
                                                    of this project.
                                                    <br />
                                                    Please contact admin for any
                                                    work you need to be done on
                                                    this page.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </RenderIfMember>
                        </div>
                    </div>
                </Zoom>
            </Dashboard>
        );
    }
}

FyipeApi.displayName = 'FyipeApi';

FyipeApi.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default FyipeApi;
