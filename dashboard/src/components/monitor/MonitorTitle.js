import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Badge from '../common/Badge';

export class MonitorTitle extends Component {

    replaceDashWithSpace = (string) => {
        return string.replace('-', ' ');
    }

    render() {
        let url = this.props.monitor && this.props.monitor.data && this.props.monitor.data.url ? this.props.monitor.data.url : null;
        let badgeColor;
        switch (this.props.monitor.type) {
            case 'manual':
                badgeColor = 'red';
                break;
            case 'device':
                badgeColor = 'green';
                break;
            default:
                badgeColor = 'blue';
                break;
        }
        return (
            <div className="db-Trends-title">
                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    {this.props.monitor.name}
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {url && <span>
                                    Monitor for &nbsp;
                                <a href={url}>{url}</a>
                                </span>}
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <Badge color={badgeColor}>{this.replaceDashWithSpace(this.props.monitor.type)}</Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

MonitorTitle.displayName = 'MonitorTitle'

MonitorTitle.propTypes = {
    monitor: PropTypes.object.isRequired,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {}, dispatch
)

const mapStateToProps = () => {
    return {};
}

MonitorTitle.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorTitle);