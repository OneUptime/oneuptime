import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';

class Users extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('Main page Loaded');
        }
    }

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div onKeyDown={this.handleKeyBoard} className="db-World-contentPane Box-root Padding-bottom--48">
					<div>
						<div>
							<div className="db-BackboneViewContainer">
								<div
									className="customers-list-view react-view popover-container"
									style={{ position: 'relative', overflow: 'visible' }}
								>
                                    <div className="bs-BIM">
                                        <div className="Box-root Margin-bottom--12">
                                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                            <div className="Box-root">
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span style={{'textTransform':'capitalize'}}>Users</span>
                                                            </span>
                                                            <span style={{'textTransform':'lowercase'}} className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>Here are all the members who belong to.</span>
                                                            </span>
                                                        </div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div className="Box-root">
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-ContentSection-content Box-root">
                                                    <div className="bs-ObjectList db-UserList">
                                                        <div className="bs-ObjectList-rows">
                                                            <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                                <div className="bs-ObjectList-cell">
                                                                    User
                                                                        </div>
                                                                <div className="bs-ObjectList-cell">
                                                                    Projects
                                                                        </div>
                                                                <div className="bs-ObjectList-cell">
                                                                    Status
                                                                        </div>
                                                                <div className="bs-ObjectList-cell"></div>
                                                                <div className="bs-ObjectList-cell"></div>
                                                            </header>
                                                            <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withName">
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">{this.props.name}</div>
                                                                    <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted">
                                                                        hello@fyipe.com
                                                                    </div>
                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                    <div className="bs-ObjectList-cell-row">
                                                                        Fyipe Project and 2 other
                                                                    </div>
                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle">

                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                            <span>
                                                                                Online a few seconds ago
                                                                            </span>
                                                                        </span>
                                                                    </div>

                                                                </div>
                                                                <div className="bs-ObjectList-cell bs-u-v-middle"></div>
                                                                <div className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween"><div>
                                                    
                                                                <button
                                                                    title="delete"
                                                                    className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                                    type="button"
                                                                >
                                                                    {<span>Remove</span>}
                                                                </button>
                                                            </div>
                                                                </div></div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>  
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ destroy }, dispatch)
}

const mapStateToProps = state => {

    return {
    };
}

Users.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

Users.propTypes = {
}

Users.displayName = 'Users'

export default connect(mapStateToProps, mapDispatchToProps)(Users);