import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import EmailLogsList from '../components/emailLogs/EmailLogsList';
import {
    fetchEmailLogs,
    searchEmailLogs,
    fetchEmailLogStatus,
} from '../actions/emailLogs';


import { Link } from 'react-router-dom';
import AlertPanel from '../components/basic/AlertPanel';
import ShouldRender from '../components/basic/ShouldRender';
class EmailLogs extends Component<ComponentProps> {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = {
            searchBox: null,
            page: 1,
        };
    }

    prevClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        const { searchBox }: $TSFixMe = this.state;

        const { fetchEmailLogs, searchEmailLogs }: $TSFixMe = this.props;

        if (searchBox && searchBox !== '') {
            searchEmailLogs(
                searchBox,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            fetchEmailLogs((skip || 0) > (limit || 10) ? skip - limit : 0, 10);
        }

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        const { searchBox }: $TSFixMe = this.state;

        const { fetchEmailLogs, searchEmailLogs }: $TSFixMe = this.props;

        if (searchBox && searchBox !== '') {
            searchEmailLogs(searchBox, skip + limit, 10);
        } else {
            fetchEmailLogs(skip + limit, 10);
        }

        this.setState({ page: this.state.page + 1 });
    };

    override componentDidMount() {

        this.props.fetchEmailLogs();

        this.props.fetchEmailLogStatus();
    }

    onChange = (e: $TSFixMe) => {
        const value: $TSFixMe = e.target.value;

        const { searchEmailLogs }: $TSFixMe = this.props;

        this.setState({ searchBox: value });
        searchEmailLogs(value, 0, 10);
        this.setState({ page: 1 });
    };

    override render() {

        const { emailLogStatus }: $TSFixMe = this.props;
        return (
            <div
                id="oneuptimeEmailLog"
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
                            ></div>
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
                                                                Email Logs
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                Here is a
                                                                complete list of
                                                                Email logs.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    {/* <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div className="Box-root">
                                                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                    <div>
                                                                        <input
                                                                            id="searchEmailLog"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            placeholder="Search Logs"
                                                                            onChange={
                                                                                this
                                                                                    .onChange
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div> */}
                                                </div>
                                            </div>
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column">
                                                <ShouldRender
                                                    if={
                                                        emailLogStatus.data &&
                                                        !emailLogStatus.data
                                                            .value
                                                    }
                                                >
                                                    <AlertPanel

                                                        className=""
                                                        message={
                                                            <span id="emailLogDisabled">
                                                                You are
                                                                currently not
                                                                storing any
                                                                email logs at
                                                                the moment.
                                                                Click{' '}
                                                                <Link
                                                                    className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                                                    to="/admin/settings/email-logs"
                                                                    id="emailLogSetting"
                                                                >
                                                                    here
                                                                </Link>{' '}
                                                                to turn it on.
                                                            </span>
                                                        }
                                                    />
                                                </ShouldRender>
                                            </div>
                                        </div>
                                        <EmailLogsList

                                            emailLogs={

                                                this.props.emailLogs || {}
                                            }
                                            prevClicked={this.prevClicked}
                                            nextClicked={this.nextClicked}

                                            userId={this.props.userId}

                                            requesting={this.props.requesting}

                                            page={this.state.page}
                                        />
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


EmailLogs.displayName = 'EmailLogs';

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchEmailLogs,
            searchEmailLogs,
            fetchEmailLogStatus,
        },
        dispatch
    );
};

const mapStateToProps: Function = (state: RootState) => {
    const emailLogs: $TSFixMe = state.emailLogs.emailLogs;
    const searchEmailLogs: $TSFixMe = state.emailLogs.searchEmailLogs;
    const requesting: $TSFixMe =
        emailLogs && searchEmailLogs
            ? emailLogs.requesting || searchEmailLogs.requesting
                ? true
                : false
            : false;
    const emailLogStatus: $TSFixMe = state.emailLogs.emailLogStatus;
    const changeEmailLogStatus: $TSFixMe = state.emailLogs.changeEmailLogStatus;
    return {
        emailLogs,
        requesting,
        emailLogStatus,
        changeEmailLogStatus,
    };
};

EmailLogs.propTypes = {
    fetchEmailLogs: PropTypes.func.isRequired,
    searchEmailLogs: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    emailLogs: PropTypes.object,
    userId: PropTypes.string,
    fetchEmailLogStatus: PropTypes.func.isRequired,
    emailLogStatus: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(EmailLogs);
