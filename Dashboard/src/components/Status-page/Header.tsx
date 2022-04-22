import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { IS_LOCALHOST } from '../../config';

interface StatusHeaderProps {
    statusPage: object;
}

export class StatusHeader extends Component<StatusHeaderProps>{
    public static displayName = '';
    public static propTypes = {};
    override render() {

        const { statusPage }: $TSFixMe = this.props;
        let publicStatusPageUrl, statusPageSlug;
        if (statusPage && statusPage.status && statusPage.status.slug) {

            statusPageSlug = this.props.statusPage.status.slug;
        }

        if (IS_LOCALHOST) {
            publicStatusPageUrl = `http://${statusPageSlug}.localhost:3006`;
        } else {
            publicStatusPageUrl =
                window.location.origin + '/StatusPage/' + statusPageSlug;
        }

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <p>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        id={`header-${statusPage.status.name}`}
                                    >
                                        Status Page:{' '}
                                        {statusPage.status.name ||
                                            'Status Page'}
                                    </span>
                                </span>
                            </p>
                            <p id="publicStatusPageUrl">
                                <span>
                                    Status page lets your customers and your
                                    team see the current status of your
                                    monitors.
                                    <br /> Please follow{' '}
                                    <a
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        href={publicStatusPageUrl}
                                        className="Text-fontWeight--bold underline"
                                    >
                                        {publicStatusPageUrl}{' '}
                                    </a>{' '}
                                    to preview your status page
                                </span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


StatusHeader.displayName = 'StatusHeader';


StatusHeader.propTypes = {
    statusPage: PropTypes.object.isRequired,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({}, dispatch);

const mapStateToProps: Function = (state: RootState) => {
    const { statusPage }: $TSFixMe = state;
    return { statusPage };
};

export default connect(mapStateToProps, mapDispatchToProps)(StatusHeader);
