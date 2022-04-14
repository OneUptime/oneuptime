import React, { useState } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';

interface FooterButtonProps {
    acknowledged: object;
    resolved: object;
    className?: string;
    onClick?: Function;
    route?: string;
    homeRoute?: string;
    state: object;
    multipleIncidentRequest: object;
    incidentRequest: object;
    incidentId?: string;
}

const FooterButton: Function = (props: FooterButtonProps) => {
    const [loading, setLoading] = useState(false);
    return (
        <>
            <button
                className={props.className}
                onClick={() => {
                    setLoading(true);
                    props.onClick(setLoading);
                }}
            >
                {props.acknowledged &&
                    props.resolved &&
                    (!props.route ||
                        (props.route &&
                            !(
                                props.route === props.homeRoute ||
                                !props.incidentId
                            ))) && (
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="bs-g"
                            width="18"
                            height="18"
                        >
                            <path fill="none" d="M0 0h24v24H0z" />
                            <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-.997-4L6.76 11.757l1.414-1.414 2.829 2.829 5.656-5.657 1.415 1.414L11.003 16z" />
                        </svg>
                    )}
                {props.state.resolveLoad ? null : !props.acknowledged &&
                    !props.state.resolveLoad ? (
                    <div className="bs-circle"></div>
                ) : null}
                {props.state.resolveLoad ? null : props.acknowledged &&
                    !props.resolved &&
                    !props.state.resolveLoad ? (
                    <div className="bs-ticks"></div>
                ) : null}
                <div
                    className={
                        props.acknowledged &&
                        props.resolved &&
                        'bs-resolved-green'
                    }
                >
                    <ShouldRender
                        if={
                            ((props.incidentRequest &&
                                props.incidentRequest.requesting) ||
                                (props.multipleIncidentRequest &&
                                    props.multipleIncidentRequest.requesting) ||
                                (props.incidentRequest &&
                                    props.incidentRequest.resolving) ||
                                (props.multipleIncidentRequest &&
                                    props.multipleIncidentRequest.resolving)) &&
                            !props.state.value &&
                            !props.state.stats &&
                            loading
                        }
                    >
                        <Spinner
                            style={{
                                stroke: '#000000',
                            }}
                        />
                    </ShouldRender>
                    {!props.acknowledged
                        ? 'Acknowledge Incident'
                        : props.acknowledged && !props.resolved
                            ? 'Resolve Incident'
                            : !props.route ||
                                (props.route &&
                                    !(
                                        props.route === props.homeRoute ||
                                        !props.incidentId
                                    ))
                                ? 'The Incident is Resolved'
                                : null}
                </div>
            </button>
        </>
    );
};
FooterButton.displayName = 'FooterButton';

FooterButton.propTypes = {
    acknowledged: PropTypes.object.isRequired,
    resolved: PropTypes.object.isRequired,
    className: PropTypes.string,
    onClick: PropTypes.func,
    route: PropTypes.string,
    homeRoute: PropTypes.string,
    state: PropTypes.object.isRequired,
    multipleIncidentRequest: PropTypes.object.isRequired,
    incidentRequest: PropTypes.object.isRequired,
    incidentId: PropTypes.string,
};

export default FooterButton;
