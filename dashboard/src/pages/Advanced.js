import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import DeleteProject from '../components/settings/DeleteProject';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import { hideDeleteModal } from '../actions/project';
import PropTypes from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

class Advanced extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > ADVANCED');
        }
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.hideDeleteModal();
                return true;
            default:
                return false;
        }
    };

    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Advanced" />
                    <div
                        onKeyDown={this.handleKeyBoard}
                        className="Margin-vertical--12"
                    >
                        <div>
                            <div id="advancedPage">
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span>
                                            <div>
                                                <RenderIfOwner>
                                                    <DeleteProject />
                                                </RenderIfOwner>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch =>
    bindActionCreators({ hideDeleteModal }, dispatch);

Advanced.propTypes = {
    hideDeleteModal: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

Advanced.displayName = 'Advanced';

export default connect(null, mapDispatchToProps)(Advanced);
