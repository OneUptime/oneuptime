import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageComponentProps from "../PageComponentProps";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import ServiceCatalogDependency from "Common/Models/DatabaseModels/ServiceCatalogDependency";
import Card from "Common/UI/Components/Card/Card";
import ServiceDependencyGraph from "Common/UI/Components/Graphs/ServiceDependencyGraph";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";

const ServiceCatalogDependencyGraphPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [services, setServices] = useState<Array<ServiceCatalog>>([]);
  const [dependencies, setDependencies] = useState<
    Array<ServiceCatalogDependency>
  >([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchData: PromiseVoidFunction = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");

        const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

        const servicesRes: ListResult<ServiceCatalog> =
          await ModelAPI.getList<ServiceCatalog>({
            modelType: ServiceCatalog,
            query: { projectId },
            select: {
              _id: true,
              name: true,
              slug: true,
              serviceColor: true,
            },
            sort: { createdAt: SortOrder.Descending },
            limit: 1000,
            skip: 0,
          });

        const dependenciesRes: ListResult<ServiceCatalogDependency> =
          await ModelAPI.getList<ServiceCatalogDependency>({
            modelType: ServiceCatalogDependency,
            query: { projectId },
            select: {
              _id: true,
              serviceCatalogId: true,
              dependencyServiceCatalogId: true,
            },
            sort: { createdAt: SortOrder.Descending },
            limit: 5000,
            skip: 0,
          });

        setServices(servicesRes.data);
        setDependencies(dependenciesRes.data);
      } catch (err: any) {
        setError(err.message || "Failed to load graph data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <Fragment>
      <Card
        title="Dependency Graph"
        description="Visualize relationships across all services."
      >
        <>
          {loading ? <div>Loading...</div> : null}
          {error ? <div className="text-red-500">{error}</div> : null}
          {!loading && !error && services.length === 0 ? (
            <div>No services to display.</div>
          ) : null}
          {!loading && !error && services.length > 0 ? (
            <ServiceDependencyGraph
              services={services.map((s: ServiceCatalog) => {
                return {
                  id: s.id!.toString(),
                  name: s.name || "",
                  color: (s as any).serviceColor?.toString?.() || undefined,
                };
              })}
              dependencies={dependencies.map((d: ServiceCatalogDependency) => {
                return {
                  fromServiceId: d.serviceCatalogId!.toString(),
                  toServiceId: d.dependencyServiceCatalogId!.toString(),
                };
              })}
            />
          ) : null}
        </>
      </Card>
    </Fragment>
  );
};

export default ServiceCatalogDependencyGraphPage;
