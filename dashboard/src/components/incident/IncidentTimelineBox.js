import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import IncidentTimelineList from './IncidentTimelineList';

export class IncidentTimelineBox extends Component {
    constructor(props) {
        super(props)
        this.state = { skip: 0 }
    }
    prevClicked = () => {
        this.setState({ skip: this.state.skip - this.props.limit});
    }

    nextClicked = () => {
        this.setState({ skip: this.state.skip + this.props.limit});
    }

    render() {
        return (
            <div className="Box-root Card-shadow--medium" tabIndex='0' onKeyDown={this.handleKeyBoard}>
                <div className="db-Trends-header Box-background--white Box-divider--surface-bottom-1">
                    <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Incident Timeline
                                </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>Here&#39;s the timeline of probes that created this incident.</span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <IncidentTimelineList incident={this.props.incident} skip={this.state.skip} limit={this.props.limit} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                </div>
            </div>
        );
    }
}

IncidentTimelineBox.displayName = 'IncidentTimelineBox'

IncidentTimelineBox.propTypes = {
  incident: PropTypes.object,
  limit: PropTypes.number
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {}, dispatch
)

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
        incident:state.incident.incident,
        limit: 10
    };
}

IncidentTimelineBox.contextTypes = {
    mixpanel: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentTimelineBox);