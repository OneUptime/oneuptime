import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import UserList from '../components/user/UserList'
import { fetchUsers } from '../actions/user';


class Users extends Component {

    componentDidMount() {
        if(window.location.href.indexOf('localhost') <= -1){
        this.context.mixpanel.track('Main page Loaded');
        }
    }

    prevClicked = (skip, limit) => {
        this.props.fetchUsers((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
    }

    nextClicked = (skip, limit) => {
        this.props.fetchUsers(skip + limit, 10);
    }

    render() {
        const { users, user } = this.props;
        let canNext = (this.props.user.users && this.props.user.users.count) && (this.props.user.users.count > (this.props.user.users.skip + this.props.user.users.limit)) ? true : false;
        let canPrev = (this.props.user.users && this.props.user.users.skip <= 0) ? false : true;

        if (this.props.user.users && (this.props.user.users.requesting || !this.props.user.users)) {
            canNext = false;
            canPrev = false;
        }
        return (
            <Dashboard>
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
                                                            <span style={{'textTransform':'capitalize'}}>Fyipe Users</span>
                                                            </span>
                                                            <span style={{'textTransform':'lowercase'}} className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>Here is a list of all fyipe users</span>
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
                                                            <UserList users={users} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Tail bs-Tail--separated bs-Tail--short">

                                            <div className="bs-Tail-copy">
                                                <span>
                                                    { user.users.count } Fyipe User{ user.users.count === 1 ? '' : 's' }
                                                </span></div>
                                                    <div className="bs-Tail-actions">
                                                        <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                            <div className="Box-root Margin-right--8">
                                                            <button id="btnPrev" onClick={()=>{this.prevClicked(this.props.user.users.skip, this.props.user.users.limit)}} className={'Button bs-ButtonLegacy' + (canPrev ? '' : 'Is--disabled')} disabled={!canPrev} data-db-analytics-name="list_view.pagination.previous" type="button">
                                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Previous</span></span></div>
                                                            </button>
                                                            </div>
                                                            <div className="Box-root">
                                                            <button id="btnNext" onClick={()=>{this.nextClicked(this.props.user.users.skip, this.props.user.users.limit)}} className={'Button bs-ButtonLegacy' + (canNext ? '' : 'Is--disabled')} disabled={!canNext} data-db-analytics-name="list_view.pagination.next" type="button">
                                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"><span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap"><span>Next</span></span></div>
                                                            </button>
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
    return bindActionCreators({ fetchUsers }, dispatch)
}

const mapStateToProps = state => {
    return {
        user: state.user,
        users: state.user.users.users || [],
    };
}

Users.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

Users.propTypes = {
    user: PropTypes.object.isRequired,
    users: PropTypes.array,
    fetchUsers: PropTypes.func.isRequired,
}

Users.displayName = 'Users'

export default connect(mapStateToProps, mapDispatchToProps)(Users);
