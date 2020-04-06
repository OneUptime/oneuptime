import React, { Component, Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import UserList from '../components/user/UserList';
import { fetchUsers, searchUsers } from '../actions/user';
import { ListLoader, FormLoader } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import uuid from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import UserAddModal from '../components/user/UserAddModal';
import { IS_SAAS_SERVICE } from '../config';

class Users extends Component {
    constructor(props) {
        super(props);
        this.state = {
            searchBox: null,
            addModalId: uuid.v4(),
        };
    }

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Main page Loaded');
        }
    }

    ready = () => {
        this.props.fetchUsers();
    };

    prevClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchUsers, searchUsers } = this.props;

        if (searchBox && searchBox !== '') {
            searchUsers(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchUsers((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }
    };

    nextClicked = (skip, limit) => {
        const { searchBox } = this.state;
        const { fetchUsers, searchUsers } = this.props;

        if (searchBox && searchBox !== '') {
            searchUsers(searchBox, skip + limit, 10);
        } else {
            fetchUsers(skip + limit, 10);
        }
    };

    onChange = e => {
        const value = e.target.value;
        const { searchUsers } = this.props;

        this.setState({ searchBox: value });
        searchUsers(value, 0, 10);
    };

    handleClick = () => {
        const { addModalId } = this.state;
        this.props.openModal({
            id: addModalId,
            onConfirm: () => true,
            content: UserAddModal,
        });
    };

    render() {
        const { users, user, requesting } = this.props;
        let canNext =
            this.props.user.users &&
            this.props.user.users.count &&
            this.props.user.users.count >
                this.props.user.users.skip + this.props.user.users.limit
                ? true
                : false;
        let canPrev =
            this.props.user.users && this.props.user.users.skip <= 0
                ? false
                : true;

        if (
            this.props.user.users &&
            (this.props.user.users.requesting || !this.props.user.users)
        ) {
            canNext = false;
            canPrev = false;
        }
        return (
            <Dashboard ready={this.ready}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="Box-root Margin-vertical--12"
                >
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div
                                    className="customers-list-view react-view popover-container"
                                    style={{
                                        position: 'relative',
                                        overflow: 'visible',
                                    }}
                                >
                                    <div className="bs-BIM">
                                        <div className="Box-root Margin-bottom--12">
                                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                                <div className="Box-root">
                                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                    <span
                                                                        style={{
                                                                            textTransform:
                                                                                'capitalize',
                                                                        }}
                                                                    >
                                                                        Fyipe
                                                                        Users
                                                                    </span>
                                                                </span>
                                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Here is
                                                                        a list
                                                                        of all
                                                                        the
                                                                        users on
                                                                        Fyipe.
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div className="Box-root">
                                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                        <div>
                                                                            <input
                                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                                placeholder="Search Users"
                                                                                onChange={
                                                                                    this
                                                                                        .onChange
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <ShouldRender
                                                                            if={
                                                                                !IS_SAAS_SERVICE
                                                                            }
                                                                        >
                                                                            <div>
                                                                                <button
                                                                                    className="bs-Button bs-ButtonLegacy ActionIconParent"
                                                                                    type="button"
                                                                                    disabled={
                                                                                        false
                                                                                    }
                                                                                    id="add_user"
                                                                                    onClick={
                                                                                        this
                                                                                            .handleClick
                                                                                    }
                                                                                    style={{
                                                                                        marginLeft:
                                                                                            '8px',
                                                                                    }}
                                                                                >
                                                                                    <ShouldRender
                                                                                        if={
                                                                                            true
                                                                                        }
                                                                                    >
                                                                                        <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                            <span>
                                                                                                Add
                                                                                                New
                                                                                                User
                                                                                            </span>
                                                                                        </span>
                                                                                    </ShouldRender>
                                                                                    <ShouldRender
                                                                                        if={
                                                                                            false
                                                                                        }
                                                                                    >
                                                                                        <FormLoader />
                                                                                    </ShouldRender>
                                                                                </button>
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bs-ContentSection-content Box-root">
                                                        <div className="bs-ObjectList db-UserList">
                                                            <div
                                                                style={{
                                                                    overflow:
                                                                        'hidden',
                                                                    overflowX:
                                                                        'auto',
                                                                }}
                                                            >
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
                                                                    {!requesting ? (
                                                                        <UserList
                                                                            users={
                                                                                users
                                                                            }
                                                                        />
                                                                    ) : (
                                                                        <Fragment>
                                                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                <div className="bs-ObjectList-cell-row"></div>
                                                                            </div>
                                                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                <div className="bs-ObjectList-cell-row">
                                                                                    <ListLoader />
                                                                                </div>
                                                                            </div>
                                                                        </Fragment>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Tail bs-Tail--separated bs-Tail--short">
                                                    <div className="bs-Tail-copy">
                                                        <span>
                                                            {user.users.count}{' '}
                                                            Fyipe User
                                                            {user.users
                                                                .count === 1
                                                                ? ''
                                                                : 's'}
                                                        </span>
                                                    </div>
                                                    <div className="bs-Tail-actions">
                                                        <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                            <div className="Box-root Margin-right--8">
                                                                <button
                                                                    id="btnPrev"
                                                                    onClick={() => {
                                                                        this.prevClicked(
                                                                            this
                                                                                .props
                                                                                .user
                                                                                .users
                                                                                .skip,
                                                                            this
                                                                                .props
                                                                                .user
                                                                                .users
                                                                                .limit
                                                                        );
                                                                    }}
                                                                    className={
                                                                        'Button bs-ButtonLegacy' +
                                                                        (canPrev
                                                                            ? ''
                                                                            : 'Is--disabled')
                                                                    }
                                                                    disabled={
                                                                        !canPrev
                                                                    }
                                                                    data-db-analytics-name="list_view.pagination.previous"
                                                                    type="button"
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Previous
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                            <div className="Box-root">
                                                                <button
                                                                    id="btnNext"
                                                                    onClick={() => {
                                                                        this.nextClicked(
                                                                            this
                                                                                .props
                                                                                .user
                                                                                .users
                                                                                .skip,
                                                                            this
                                                                                .props
                                                                                .user
                                                                                .users
                                                                                .limit
                                                                        );
                                                                    }}
                                                                    className={
                                                                        'Button bs-ButtonLegacy' +
                                                                        (canNext
                                                                            ? ''
                                                                            : 'Is--disabled')
                                                                    }
                                                                    disabled={
                                                                        !canNext
                                                                    }
                                                                    data-db-analytics-name="list_view.pagination.next"
                                                                    type="button"
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Next
                                                                            </span>
                                                                        </span>
                                                                    </div>
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

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { fetchUsers, searchUsers, openModal, closeModal },
        dispatch
    );
};

const mapStateToProps = state => {
    const requesting =
        state.user.users.requesting || state.user.searchUsers.requesting
            ? true
            : false;

    return {
        user: state.user,
        users: state.user.users.users || [],
        requesting,
    };
};

Users.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};

Users.propTypes = {
    user: PropTypes.object.isRequired,
    users: PropTypes.array,
    fetchUsers: PropTypes.func.isRequired,
    searchUsers: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    openModal: PropTypes.func,
};

Users.displayName = 'Users';

export default connect(mapStateToProps, mapDispatchToProps)(Users);
