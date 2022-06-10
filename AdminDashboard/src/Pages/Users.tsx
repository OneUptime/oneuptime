import React, { Component, Fragment } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import UserList from '../components/user/UserList';
import { fetchUsers, searchUsers } from '../actions/user';
import { ListLoader } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';

import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../actions/Modal';
import UserAddModal from '../components/user/UserAddModal';

import * as _ from 'lodash';

class Users extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            searchBox: null,
            addModalId: uuidv4(),
            page: 1,
        };
    }

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);

        this.props.fetchUsers();
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (event: $TSFixMe) => {

        const { modalId }: $TSFixMe = this.props;

        const { addModalId }: $TSFixMe = this.state;

        if (event.target.localName === 'body' && event.key) {
            switch (event.key) {
                case 'N':
                case 'n':
                    if (modalId !== addModalId) {
                        event.preventDefault();
                        return this.handleClick();
                    }
                    return false;
                default:
                    return false;
            }
        }
    };

    prevClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        const { searchBox }: $TSFixMe = this.state;

        const { fetchUsers, searchUsers }: $TSFixMe = this.props;

        if (searchBox && searchBox !== '') {
            searchUsers(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchUsers((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        const { searchBox }: $TSFixMe = this.state;

        const { fetchUsers, searchUsers }: $TSFixMe = this.props;

        if (searchBox && searchBox !== '') {
            searchUsers(searchBox, skip + limit, 10);
        } else {
            fetchUsers(skip + limit, 10);
        }

        this.setState({ page: this.state.page + 1 });
    };

    onChange = (e: $TSFixMe) => {
        const value: $TSFixMe = e.target.value;

        const { searchUsers }: $TSFixMe = this.props;

        this.setState({ searchBox: value });
        searchUsers(value, 0, 10);
        this.setState({ page: 1 });
    };

    handleClick = () => {

        const { addModalId }: $TSFixMe = this.state;

        this.props.openModal({
            id: addModalId,
            onConfirm: () => true,
            content: UserAddModal,
        });
    };

    override render() {

        const { users, user, requesting }: $TSFixMe = this.props;
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
        const numberOfPages: $TSFixMe = Math.ceil(parseInt(user.users.count) / 10);
        return (
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
                                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span
                                                                    style={{
                                                                        textTransform:
                                                                            'capitalize',
                                                                    }}
                                                                >
                                                                    OneUptime
                                                                    Users
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Here is a
                                                                    list of all
                                                                    the users on
                                                                    OneUptime.
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
                                                                            onChange={_.debounce(
                                                                                this
                                                                                    .onChange,
                                                                                500
                                                                            )}
                                                                        />
                                                                    </div>
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
                                                                                paddingTop: 3,
                                                                                paddingBottom: 3,
                                                                            }}
                                                                        >
                                                                            <ShouldRender
                                                                                if={
                                                                                    true
                                                                                }
                                                                            >
                                                                                <span className="bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                                                    <span>
                                                                                        Add
                                                                                        New
                                                                                        User
                                                                                    </span>
                                                                                    <span className="newButtonKeycode">
                                                                                        N
                                                                                    </span>
                                                                                </span>
                                                                            </ShouldRender>
                                                                        </button>
                                                                    </div>
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
                                                        {numberOfPages > 0
                                                            ? `Page ${this.state

                                                                .page
                                                            } of ${numberOfPages} (${user.users
                                                                .count
                                                            } OneUptime User${user.users
                                                                .count ===
                                                                1
                                                                ? ''
                                                                : 's'
                                                            })`
                                                            : user.users
                                                                .count &&
                                                            `${user.users
                                                                .count
                                                            } OneUptime User${user.users
                                                                .count ===
                                                                1
                                                                ? ''
                                                                : 's'
                                                            }`}
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
        );
    }
}

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        { fetchUsers, searchUsers, openModal, closeModal },
        dispatch
    );
};

const mapStateToProps: Function = (state: RootState) => {
    const requesting: $TSFixMe =
        state.user.users.requesting || state.user.searchUsers.requesting
            ? true
            : false;

    return {
        user: state.user,
        users: state.user.users.users || [],
        requesting,
        modalId: state.modal.modals[0] && state.modal.modals[0].id,
    };
};


Users.contextTypes = {};


Users.propTypes = {
    user: PropTypes.object.isRequired,
    users: PropTypes.array,
    fetchUsers: PropTypes.func.isRequired,
    searchUsers: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    openModal: PropTypes.func,
    modalId: PropTypes.string,
};


Users.displayName = 'Users';

export default connect(mapStateToProps, mapDispatchToProps)(Users);
