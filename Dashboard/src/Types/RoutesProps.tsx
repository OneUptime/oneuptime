import Project from 'Model/Models/Project';
import ComponentProps from '../Pages/PageComponentProps';

export type RoutesProps = {
    projects: Array<Project>;
    isLoading: boolean;
} & ComponentProps;
