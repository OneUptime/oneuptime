import React, { useEffect } from 'react';
import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import DeleteAccountBox from '../components/profileSettings/DeleteAccountBox';
import { getProjects } from '../actions/project';
import { bindActionCreators } from 'redux';

const DeleteAccountPage = props => {
    useEffect(() => {
        props.getProjects(null);
    }, []);

    const {
        location: { pathname },
    } = props;

    return (
        <Dashboard>
            <BreadCrumbItem route={pathname} name="Profile Settings" />
            <div>
                <div>
                    <div className="db-BackboneViewContainer">
                        <div className="react-settings-view react-view">
                            <span data-reactroot="">
                                <div>
                                    <div>
                                        <div className="Box-root Margin-bottom--12">
                                            <DeleteAccountBox />
                                        </div>
                                    </div>
                                </div>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Dashboard>
    );
};

DeleteAccountPage.displayName = 'DeleteAccountPage';

DeleteAccountPage.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    getProjects: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getProjects }, dispatch);

// eslint-disable-next-line no-unused-vars
const mapStateToProps = _state => {
    return {};
};

export default connect(mapStateToProps, mapDispatchToProps)(DeleteAccountPage);
