import ComponentProps from '../Pages/PageComponentProps';
import Project from 'Model/Models/Project';

export type RoutesProps = {
    projects: Array<Project>;
    isLoading: boolean;
} & ComponentProps;
