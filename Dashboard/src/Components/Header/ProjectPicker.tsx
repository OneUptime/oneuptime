import React, {
    FunctionComponent,
    ReactElement,
    useState,
    useEffect,
} from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import IconProp from 'Common/Types/Icon/IconProp';
import Project from 'Model/Models/Project';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import { BILLING_ENABLED, getAllEnvVars } from 'CommonUI/src/Config';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import Field from 'CommonUI/src/Components/Forms/Types/Field';
import { RadioButton } from 'CommonUI/src/Components/RadioButtons/RadioButtons';
import Toggle from 'CommonUI/src/Components/Toggle/Toggle';

export interface ComponentProps {
    projects: Array<Project>;
    onProjectSelected: (project: Project) => void;
    showProjectModal: boolean;
    onProjectModalClose: () => void;
}

const DashboardProjectPicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showModal, setShowModal] = useState<boolean>(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(
        null
    );

    const getFooter: Function = (): ReactElement => {
        if (!BILLING_ENABLED) {
            return <></>;
        }

        return (
            <Toggle
                title="Yearly Plan"
                initialValue={isSubsriptionPlanYearly}
                description="(Save 20%)"
                onChange={(value: boolean) => {
                    setIsSubscriptionPlanYearly(value);
                }}
            />
        );
    };

    const [isSubsriptionPlanYearly, setIsSubscriptionPlanYearly] =
        useState<boolean>(true);

    const [fields, setFields] = useState<Array<Field<Project>>>([]);

    useEffect(() => {
        if (props.showProjectModal) {
            setShowModal(true);
        }
    }, [props.showProjectModal]);

    useEffect(() => {
        const currentProject: Project | null = ProjectUtil.getCurrentProject();
        setSelectedProject(currentProject);
        if (currentProject && props.onProjectSelected) {
            props.onProjectSelected(currentProject);
        }
    }, []);

    useEffect(() => {
        if (selectedProject) {
            ProjectUtil.setCurrentProject(selectedProject);
            if (props.onProjectSelected) {
                props.onProjectSelected(selectedProject);
            }
        }
    }, [selectedProject]);

    useEffect(() => {
        if (
            props.projects &&
            props.projects.length > 0 &&
            !selectedProject &&
            props.projects[0]
        ) {
            const currentProject: Project | null =
                ProjectUtil.getCurrentProject();

            if (!currentProject) {
                setSelectedProject(props.projects[0]);
            } else if (
                props.projects.filter((project: Project) => {
                    return project._id === currentProject._id;
                }).length > 0
            ) {
                setSelectedProject(
                    props.projects.filter((project: Project) => {
                        return project._id === currentProject._id;
                    })[0] as Project
                );
            } else {
                setSelectedProject(props.projects[0]);
            }
        }
    }, [props.projects]);

    useEffect(() => {
        refreshFields();
    }, [isSubsriptionPlanYearly]);

    const refreshFields: Function = (): void => {
        let formFields: Array<Field<Project>> = [
            {
                field: {
                    name: true,
                },
                validation: {
                    minLength: 6,
                },
                fieldType: FormFieldSchemaType.Text,
                placeholder: 'My Project',
                description: 'Pick a friendly name.',
                title: 'Project Name',
                required: true,
            },
        ];

        if (BILLING_ENABLED) {
            formFields = [
                ...formFields,
                {
                    field: {
                        paymentProviderPlanId: true,
                    },
                    validation: {
                        minLength: 6,
                    },
                    fieldType: FormFieldSchemaType.RadioButton,
                    radioButtonOptions: SubscriptionPlan.getSubscriptionPlans(
                        getAllEnvVars()
                    ).map((plan: SubscriptionPlan): RadioButton => {
                        let description: string = plan.isCustomPricing()
                            ? `Our sales team will contact you soon.`
                            : `Billed ${isSubsriptionPlanYearly ? 'yearly' : 'monthly'
                            }. ${plan.getTrialPeriod() > 0
                                ? `Free ${plan.getTrialPeriod()} days trial.`
                                : ''
                            }`;

                        if (
                            isSubsriptionPlanYearly &&
                            plan.getYearlySubscriptionAmountInUSD() === 0
                        ) {
                            description = 'This plan is free, forever. ';
                        }

                        if (
                            !isSubsriptionPlanYearly &&
                            plan.getMonthlySubscriptionAmountInUSD() === 0
                        ) {
                            description = 'This plan is free, forever. ';
                        }

                        return {
                            value: isSubsriptionPlanYearly
                                ? plan.getYearlyPlanId()
                                : plan.getMonthlyPlanId(),
                            title: plan.getName(),
                            description: description,
                            sideTitle: plan.isCustomPricing()
                                ? 'Custom Price'
                                : isSubsriptionPlanYearly
                                    ? '$' +
                                    (
                                        plan.getYearlySubscriptionAmountInUSD() *
                                        12
                                    ).toString()
                                    : '$' +
                                    plan
                                        .getMonthlySubscriptionAmountInUSD()
                                        .toString(),
                            sideDescription: plan.isCustomPricing()
                                ? ''
                                : isSubsriptionPlanYearly
                                    ? `/year per user`
                                    : `/month per user`,
                        };
                    }),
                    title: 'Please select a plan.',
                    required: true,
                },
            ];
        }

        setFields(formFields);
    };

    return (
        <>
            {props.projects.length !== 0 && (
                <ProjectPicker
                    selectedProjectName={selectedProject?.name || ''}
                    selectedProjectIcon={IconProp.Folder}
                    projects={props.projects}
                    onCreateProjectButtonClicked={() => {
                        setShowModal(true);
                        props.onProjectModalClose();
                    }}
                    onProjectSelected={(project: Project) => {
                        setSelectedProject(project);
                    }}
                />
            )}
            {showModal ? (
                <ModelFormModal<Project>
                    modelType={Project}
                    name="Create New Project"
                    title="Create New Project"
                    description="Please create a new OneUptime project to get started."
                    onClose={() => {
                        setShowModal(false);
                        props.onProjectModalClose();
                    }}
                    submitButtonText="Create Project"
                    onSuccess={(project: Project) => {
                        setSelectedProject(project);
                        if (project && props.onProjectSelected) {
                            props.onProjectSelected(project);
                        }
                        setShowModal(false);
                        props.onProjectModalClose();
                    }}
                    formProps={{
                        saveRequestOptions: {
                            isMultiTenantRequest: true, // because this is a tenant request, we do not have to incclude the header in the reqeuest
                        },
                        model: new Project(),
                        id: 'create-project-from',
                        fields: [...fields],
                        formType: FormType.Create,
                    }}
                    footer={getFooter()}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default DashboardProjectPicker;
