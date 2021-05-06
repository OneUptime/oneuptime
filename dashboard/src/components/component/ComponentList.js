import React, { useEffect } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject';
import ComponentDetail from './ComponentDetail';
import sortByName from '../../utils/sortByName';
import { searchComponents } from '../../actions/component';
import { searchMonitors } from '../../actions/monitor';

export function ComponentList(props) {
    const { searchComponents, projectId, searchValues, searchMonitors } = props;
    useEffect(() => {
        if (searchValues && searchValues.search.length >= 1) {
            searchComponents(projectId, searchValues);
            searchMonitors(projectId, searchValues);
        }
    }, [searchValues, projectId, searchComponents, searchMonitors]);
    let componentDetails = null;

    const components = props.components ? sortByName(props.components) : [];

    if (components && components.length > 0) {
        componentDetails = components.map((component, i) => (
            <div id={`component${i}`} key={component._id}>
                <RenderIfUserInSubProject
                    subProjectId={
                        component.projectId._id || component.projectId
                    }
                >
                    <ComponentDetail
                        shouldRenderProjectType={props.shouldRenderProjectType}
                        projectId={props.projectId}
                        projectName={props.projectName}
                        projectType={props.projectType}
                        component={component}
                        index={component._id}
                        key={component._id}
                    />
                </RenderIfUserInSubProject>
            </div>
        ));
    }

    return componentDetails;
}

ComponentList.displayName = 'ComponentList';

const mapDispatchToProps = dispatch =>
    bindActionCreators({ searchComponents, searchMonitors }, dispatch);

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
    searchValues: state.form.search && state.form.search.values,
});

export default connect(mapStateToProps, mapDispatchToProps)(ComponentList);
