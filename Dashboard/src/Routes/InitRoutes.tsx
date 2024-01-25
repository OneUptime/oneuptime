import React, { FunctionComponent, ReactElement, Suspense, lazy } from 'react';
import { Routes, Route as PageRoute } from 'react-router-dom';
import Route from 'Common/Types/API/Route';
import { RoutesProps } from '../Types/RoutesProps';
import RouteMap from '../Utils/RouteMap';
import PageMap from '../Utils/PageMap';
import Loader from '../Components/Loader/Loader';

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
