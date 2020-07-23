import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import moment from 'moment';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';
import NewIncidentMessage from './NewIncidentMessage';
import { editIncidentMessageSwitch } from '../../actions/incident';

export class IncidentInvestigation extends Component {
    constructor(props) {
        super(props);
    }
    render() {
        const { incidentMessages, editIncidentMessageSwitch } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Investigation</span>
                                </span>
                                <p>
                                    <span>
                                        Tell us more about what went wrong.
                                    </span>
                                </p>
                            </div>
                        </div>

                        <div className="bs-ContentSection-content">
                            {incidentMessages &&
                                incidentMessages.incidentMessages.map(
                                    (incidentMessage, index) => {
                                        return (
                                            <div
                                                id={`investigation_message_${index}`}
                                                key={index}
                                                className={`${
                                                    !incidentMessage.editMode &&
                                                    index % 2 === 0
                                                        ? 'Box-background--offset '
                                                        : 'Box-background--white'
                                                }Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--8`}
                                            >
                                                <ShouldRender
                                                    if={
                                                        !incidentMessage.editMode
                                                    }
                                                >
                                                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                                        <div className="Box-root Margin-right--16">
                                                            <img
                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                className="userIcon"
                                                                alt=""
                                                                style={{
                                                                    marginBottom:
                                                                        '-5px',
                                                                }}
                                                            />
                                                            <span>
                                                                {incidentMessage
                                                                    .createdById
                                                                    .name
                                                                    ? incidentMessage
                                                                          .createdById
                                                                          .name
                                                                    : 'Unknown User'}
                                                            </span>
                                                        </div>
                                                        <div className="Box-root Margin-right--16">
                                                            <span>
                                                                <strong>
                                                                    {currentTimeZone
                                                                        ? momentTz(
                                                                              incidentMessage.createdAt
                                                                          )
                                                                              .tz(
                                                                                  currentTimeZone
                                                                              )
                                                                              .format(
                                                                                  'lll'
                                                                              )
                                                                        : moment(
                                                                              incidentMessage.createdAt
                                                                          ).format(
                                                                              'lll'
                                                                          )}
                                                                </strong>{' '}
                                                                (
                                                                {moment(
                                                                    incidentMessage.createdAt
                                                                ).fromNow()}
                                                                )
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                                        <div
                                                            style={{
                                                                padding:
                                                                    '0px 30px',
                                                            }}
                                                        >
                                                            <p>
                                                                {' '}
                                                                {
                                                                    incidentMessage.content
                                                                }
                                                            </p>
                                                            <p
                                                                style={{
                                                                    cursor:
                                                                        'pointer',
                                                                }}
                                                                onClick={() =>
                                                                    editIncidentMessageSwitch(
                                                                        incidentMessage
                                                                    )
                                                                }
                                                            >
                                                                <img
                                                                    src="/dashboard/assets/img/edit.svg"
                                                                    className="Margin-right--8"
                                                                    style={{
                                                                        height:
                                                                            '10px',
                                                                        width:
                                                                            '10px',
                                                                    }}
                                                                />
                                                                Edit Response
                                                            </p>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        incidentMessage.editMode
                                                    }
                                                >
                                                    <NewIncidentMessage
                                                        incident={
                                                            this.props.incident
                                                        }
                                                        type={'investigation'}
                                                        edit={true}
                                                        incidentMessage={
                                                            incidentMessage
                                                        }
                                                    />
                                                </ShouldRender>
                                            </div>
                                        );
                                    }
                                )}
                        </div>
                        <NewIncidentMessage
                            incident={this.props.incident}
                            type={'investigation'}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

IncidentInvestigation.displayName = 'IncidentInvestigation';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            editIncidentMessageSwitch,
        },
        dispatch
    );

function mapStateToProps(state, ownProps) {
    const incidentMessages = state.incident.incidentMessages
        ? state.incident.incidentMessages[ownProps.incident._id]
            ? state.incident.incidentMessages[ownProps.incident._id][
                  'investigation'
              ]
            : []
        : [];
    return {
        incidentMessages,
    };
}

IncidentInvestigation.propTypes = {
    incident: PropTypes.object.isRequired,
    incidentMessages: PropTypes.object,
    editIncidentMessageSwitch: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentInvestigation);
