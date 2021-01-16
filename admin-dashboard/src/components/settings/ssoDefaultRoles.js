import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchSsoDefaultRoles } from '../../actions/ssoDefaultRoles';
import { fetchProjects } from '../../actions/project';
import Button from './ssoDefaultRoles/Button';
import BoxHeader from './ssoDefaultRoles/BoxHeader';
import BoxFooter from './ssoDefaultRoles/BoxFooter';
import Table from './ssoDefaultRoles/Table';
import { openModal } from '../../actions/modal';
import { CreateDefaultRoleModal } from './ssoDefaultRoles/DefaultRoleModal';

class Box extends React.Component {
    constructor() {
        super();
        this.state = {
            canPrev: false,
            canNext: false,
            skip: 0,
            limit: 10,
        };
    }
    async previousClicked() {
        const { skip, limit } = this.state;
        if (0 <= skip - limit) {
            await this.props.fetchSsoDefaultRoles(skip - limit, limit);
            this.setState({
                skip: skip - limit,
                canNext: true,
                canPrev: 0 < skip - limit,
            });
        }
    }
    async nextClicked() {
        const { skip, limit } = this.state;
        const { count } = this.props;
        if (skip + limit < count) {
            await this.props.fetchSsoDefaultRoles(skip + limit, limit);
            this.setState({
                skip: skip + limit,
                canNext: skip + limit * 2 < count,
                canPrev: true,
            });
        }
    }
    async componentDidMount() {
        this.props.fetchProjects(0, 0);
        await this.props.fetchSsoDefaultRoles();
        const { count } = this.props;
        const { skip, limit } = this.state;
        this.setState({
            canNext: skip + limit < count,
        });
    }
    render() {
        const { ssoDefaultRoles, openModal, count } = this.props;
        const { canPrev, canNext } = this.state;
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
                                onClick={() =>
                                    openModal({
                                        content: CreateDefaultRoleModal,
                                    })
                                }
                            />,
                        ]}
                    />
                    <div style={{ overflow: 'auto hidden' }}>
                        <Table ssoDefaultRoles={ssoDefaultRoles} />
                        <BoxFooter
                            recordsCount={count}
                            canPrev={canPrev}
                            canNext={canNext}
                            previousClicked={() => this.previousClicked()}
                            nextClicked={() => this.nextClicked()}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

const mapStateToProps = state => ({
    ssoDefaultRoles: state.ssoDefaultRoles.ssoDefaultRoles.ssoDefaultRoles,
    count: state.ssoDefaultRoles.ssoDefaultRoles.count,
});
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchSsoDefaultRoles,
            fetchProjects,
            openModal,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Box);
