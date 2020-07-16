import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import PropTypes from 'prop-types';
import APISettings from '../components/settings/APISettings';
import TutorialBox from '../components/tutorial/TutorialBox';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import RenderIfMember from '../components/basic/RenderIfMember';
// import ErrorWarning from '../components/common/ErrorWarning';

class FyipeApi extends Component {
    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
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
                            <div
                                // id="app-loading"
                                style={{
                                    position: 'fixed',
                                    top: '0',
                                    bottom: '0',
                                    backgroundColor: '#fdfdfd',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    flexDirection: 'column',
                                    zIndex: '-999',
                                }}
                            >
                                <div
                                    className="db-SideNav-icon db-SideNav-icon--apis db-SideNav-icon--selected"
                                    style={{
                                        backgroundRepeat: 'no-repeat',
                                        backgroundSize: '50px',
                                        height: '50px',
                                        width: '50px',
                                    }}
                                />
                                <div
                                    style={{
                                        marginTop: '20px',
                                        fontSize: '16px',
                                        textAlign: 'center',
                                    }}
                                >
                                    You are not authorized to view this page
                                    because you’re not an administrator of this
                                    project. Please contact admin for any work
                                    you need to be done on this page.
                                </div>
                            </div>
                        </RenderIfMember>
                    </div>
                </div>
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
