import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import moment from 'moment';
import momentTz from 'moment-timezone';
import { currentTimeZone } from '../basic/TimezoneArray';
import NewIncidentMessage from './NewIncidentMessage';
import { User } from '../../config';
import { ListLoader } from '../basic/Loader';

export class IncidentMessageThread extends Component {
    render() {
        const {
            title,
            description,
            incident,
            incidentMessages,
            count,
            canSeeOlder,
            canSeeNewer,
            requesting,
            editIncidentMessageSwitch,
            type,
            error,
            olderMessage,
            newerMessage,
        } = this.props;
        return (
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>{title}</span>
                        </span>
                        <p>
                            <span>{description}</span>
                        </p>
                    </div>
                </div>

                <div className="bs-ContentSection-content">
                    {incidentMessages &&
                        incidentMessages.incidentMessages.map(
                            (incidentMessage, index) => {
                                return (
                                    <div
                                        id={`${type}_incident_message_${index}`}
                                        key={index}
                                        className={`${
                                            !incidentMessage.editMode &&
                                            index % 2 === 0
                                                ? 'Box-background--offset '
                                                : 'Box-background--white'
                                        }Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--8`}
                                    >
                                        <ShouldRender
                                            if={!incidentMessage.editMode}
                                        >
                                            <div className="Flex-flex Flex-justifyContent--spaceBetween">
                                                <div className="Box-root Margin-right--16">
                                                    <img
                                                        src="/dashboard/assets/img/profile-user.svg"
                                                        className="userIcon"
                                                        alt="user_image"
                                                        style={{
                                                            marginBottom:
                                                                '-5px',
                                                        }}
                                                    />
                                                    <span>
                                                        {incidentMessage
                                                            .createdById.name
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
                                                        padding: '0px 30px',
                                                    }}
                                                >
                                                    <p
                                                        id={`${type}_incident_message_${index}_content`}
                                                    >
                                                        {' '}
                                                        {
                                                            incidentMessage.content
                                                        }
                                                        <ShouldRender
                                                            if={
                                                                incidentMessage.updated
                                                            }
                                                        >
                                                            <span className="Margin-horizontal--4 Text-color--dark">
                                                                (edited)
                                                            </span>
                                                        </ShouldRender>
                                                    </p>
                                                    <ShouldRender
                                                        if={
                                                            User.getUserId() ===
                                                            incidentMessage
                                                                .createdById._id
                                                        }
                                                    >
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
                                                            id={`edit_${type}_incident_message_${index}`}
                                                        >
                                                            <img
                                                                src="/dashboard/assets/img/edit.svg"
                                                                className="Margin-right--8"
                                                                alt="edit_icon"
                                                                style={{
                                                                    height:
                                                                        '10px',
                                                                    width:
                                                                        '10px',
                                                                }}
                                                            />
                                                            Edit Response
                                                        </p>
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={incidentMessage.editMode}
                                        >
                                            <NewIncidentMessage
                                                incident={incident}
                                                type={type}
                                                edit={true}
                                                incidentMessage={
                                                    incidentMessage
                                                }
                                                formId={incidentMessage._id}
                                            />
                                        </ShouldRender>
                                    </div>
                                );
                            }
                        )}
                </div>
                {requesting ? <ListLoader /> : null}

                <div
                    style={{
                        textAlign: 'center',
                        padding: '0 10px',
                        margin: '10px 0',
                    }}
                >
                    {incidentMessages &&
                    incidentMessages.incidentMessages &&
                    incidentMessages.incidentMessages.length < 1
                        ? "You don't have any messages yet, start up a conversation."
                        : null}
                    {error}
                </div>
                <ShouldRender if={count > 0}>
                    <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span></span>
                            </span>
                        </div>
                        <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                <div className="Box-root Margin-right--8">
                                    <button
                                        id="btnTimelinePrev"
                                        onClick={() => {
                                            olderMessage();
                                        }}
                                        className={
                                            'Button bs-ButtonLegacy' +
                                            (canSeeOlder ? '' : 'Is--disabled')
                                        }
                                        disabled={!canSeeOlder}
                                        data-db-analytics-name="list_view.pagination.previous"
                                        type="button"
                                    >
                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                <span>Older Messages</span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                                <div className="Box-root">
                                    <button
                                        id="btnTimelineNext"
                                        onClick={() => {
                                            newerMessage();
                                        }}
                                        className={
                                            'Button bs-ButtonLegacy' +
                                            (canSeeNewer ? '' : 'Is--disabled')
                                        }
                                        disabled={!canSeeNewer}
                                        data-db-analytics-name="list_view.pagination.next"
                                        type="button"
                                    >
                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                <span>Newer Messages</span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
                <NewIncidentMessage
                    incident={incident}
                    type={type}
                    formId={`New${type}Form`}
                />
            </div>
        );
    }
}

IncidentMessageThread.displayName = 'IncidentMessageThread';

IncidentMessageThread.propTypes = {
    title: PropTypes.string,
    description: PropTypes.string,
    incident: PropTypes.object.isRequired,
    incidentMessages: PropTypes.object,
    editIncidentMessageSwitch: PropTypes.func,
    count: PropTypes.number,
    canSeeOlder: PropTypes.bool,
    canSeeNewer: PropTypes.bool,
    requesting: PropTypes.bool,
    type: PropTypes.string,
    error: PropTypes.string,
    olderMessage: PropTypes.func,
    newerMessage: PropTypes.func,
};

export default IncidentMessageThread;
