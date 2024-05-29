import Loader from '../Components/Loader/Loader';
import { RoutesProps } from '../Types/RoutesProps';
import PageMap from '../Utils/PageMap';
import RouteMap from '../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement, Suspense, lazy } from 'react';
import { Route as PageRoute, Routes } from 'react-router-dom';

const Init: any = lazy(() => {
    return import('../Pages/Init/Init');
});

const InitRoutes: FunctionComponent<RoutesProps> = (
    props: RoutesProps
): ReactElement => {
    const { projects, isLoading, ...rest } = props;
    return (
        <Routes>
            <PageRoute
                path={RouteMap[PageMap.INIT]?.toString() || ''}
                element={
                    <Suspense fallback={Loader}>
                        <Init
                            {...rest}
                            pageRoute={RouteMap[PageMap.INIT] as Route}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    </Suspense>
                }
            />

            <PageRoute
                path={RouteMap[PageMap.INIT_PROJECT]?.toString() || ''}
                element={
                    <Suspense fallback={Loader}>
                        <Init
                            {...rest}
                            pageRoute={RouteMap[PageMap.INIT_PROJECT] as Route}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    </Suspense>
                }
            />
        </Routes>
    );
};

export default InitRoutes;
