import React, { Component } from 'react';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import ErrorEventUtil from '../../utils/ErrorEventUtil';

class ErrorEventHeader extends Component {
    render() {
        const { errorEvent } = this.props;
        // eslint-disable-next-line no-console
        console.log(errorEvent);
        return (
            <ShouldRender if={errorEvent && errorEvent.errorEvent}>
                <div>
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id="application-content-header"
                                        className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <span id={`application-log-title-`}>
                                            {errorEvent.errorEvent &&
                                                errorEvent.errorEvent.content &&
                                                errorEvent.errorEvent.content
                                                    .type}
                                        </span>
                                    </span>
                                    <div className="Flex-flex Flex-alignItems--center">
                                        <div
                                            style={{
                                                height: '12px',
                                                width: '12px',
                                                backgroundColor: `${ErrorEventUtil.getExceptionColor(
                                                    errorEvent.errorEvent?.type
                                                )}`,
                                                borderRadius: '50%',
                                            }}
                                        ></div>{' '}
                                        <span className="Text-fontSize--12 Margin-left--4">
                                            {errorEvent.errorEvent &&
                                                errorEvent.errorEvent.content &&
                                                errorEvent.errorEvent.content
                                                    .message}
                                        </span>
                                    </div>
                                </div>
                                <div className="Flex-flex">
                                    <div className="Flex-flex Flex-direction--column Text-align--right Margin-horizontal--4">
                                        <span className="Text-fontSize--11">
                                            Events
                                        </span>
                                        <span
                                            className="Text-fontSize--14"
                                            style={{
                                                color: 'blue',
                                            }}
                                        >
                                            {errorEvent.totalEvents}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-ListViewItem-cellContent Box-root Padding-vertical--8 Flex-flex">
                                <button
                                    className="bs-Button bs-Button--icon bs-Button--check"
                                    type="button"
                                >
                                    <span>Resolve</span>
                                    <img
                                        src="/dashboard/assets/img/down.svg"
                                        alt=""
                                        style={{
                                            margin: '0px 10px',
                                            height: '10px',
                                            width: '10px',
                                        }}
                                    />
                                </button>
                                <button
                                    className="bs-Button bs-Button--icon bs-Button--block"
                                    type="button"
                                >
                                    <span>Ignore</span>
                                    <img
                                        src="/dashboard/assets/img/down.svg"
                                        alt=""
                                        style={{
                                            margin: '0px 10px',
                                            height: '10px',
                                            width: '10px',
                                        }}
                                    />
                                </button>
                                <button
                                    className="bs-Button"
                                    type="button"
                                    disabled={true}
                                >
                                    <span>Merge</span>
                                </button>
                                <span className="Margin-left--8">
                                    <Dropdown>
                                        <Dropdown.Toggle
                                            id="filterToggle"
                                            className="bs-Button bs-DeprecatedButton"
                                        />
                                        <Dropdown.Menu>
                                            <MenuItem title="clear">
                                                Clear Filters
                                            </MenuItem>
                                            <MenuItem title="unacknowledged">
                                                Unacknowledged
                                            </MenuItem>
                                            <MenuItem title="unresolved">
                                                Unresolved
                                            </MenuItem>
                                        </Dropdown.Menu>
                                    </Dropdown>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                        <div className="Flex-flex Flex-direction--column">
                            <span>
                                <span className="Text-fontWeight--bold">
                                    Event
                                </span>
                                <span> EventID2345676543234567654</span>
                            </span>
                            <span>Oct 13, 2020 5:13:22 PM UTC</span>
                        </div>
                        <div className="Navigator-Btn-Group Text-fontWeight--bold Text-fontSize--12">
                            <div className="Navigator-Oldest">
                                <img
                                    src="/dashboard/assets/img/previous.svg"
                                    alt=""
                                    style={{
                                        height: '12px',
                                        width: '12px',
                                    }}
                                />
                            </div>
                            <div>Older</div>
                            <div className="Navigator-Disable">Newer</div>
                            <div className="Navigator-Newest Navigator-Disable">
                                <img
                                    src="/dashboard/assets/img/next-disable.svg"
                                    alt=""
                                    style={{
                                        height: '12px',
                                        width: '12px',
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </ShouldRender>
        );
    }
}

ErrorEventHeader.propTypes = {
    errorEvent: PropTypes.object,
};
ErrorEventHeader.displayName = 'ErrorEventHeader';
export default ErrorEventHeader;
