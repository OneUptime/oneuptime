import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchSsoDefaultRoles } from '../../actions/ssoDefaultRoles';
import Button from './ssoDefaultRoles/Button';
import BoxHeader from './ssoDefaultRoles/BoxHeader';
import BoxFooter from './ssoDefaultRoles/BoxFooter';
import Table from './ssoDefaultRoles/Table';

class Box extends React.Component {
    componentDidMount() {
        this.props.fetchSsoDefaultRoles();
    }
    render() {
        const { ssoDefaultRoles } = this.props;
        return (
            <div
                className="bs-ContentSection Card-root Card-shadow--medium"
                style={{ marginTop: '1rem', marginBottom: '1rem' }}
            >
                <div className="Box-root">
                    <BoxHeader
                        title="SSO default roles "
                        description="Default roles of the members"
                        buttons={[
                            <Button
                                text="Define new configurations"
                                shortcut="M"
                            />,
                        ]}
                    />
                    <div style={{ overflow: 'auto hidden' }}>
                        <Table ssoDefaultRoles={ssoDefaultRoles} />
                        <BoxFooter />
                    </div>
                </div>
            </div>
        );
    }
}

const mapStateToProps = state => ({
    ssoDefaultRoles: state.ssoDefaultRoles.ssoDefaultRoles.ssoDefaultRoles,
});
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchSsoDefaultRoles,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Box);
