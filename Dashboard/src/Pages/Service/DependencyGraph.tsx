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
import Service from "Common/Models/DatabaseModels/Service";
import ServiceDependency from "Common/Models/DatabaseModels/ServiceDependency";
import Card from "Common/UI/Components/Card/Card";
import ServiceDependencyGraph from "Common/UI/Components/Graphs/ServiceDependencyGraph";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";

const ServiceDependencyGraphPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [services, setServices] = useState<Array<Service>>([]);
  const [dependencies, setDependencies] = useState<
    Array<ServiceDependency>
  >([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchData: PromiseVoidFunction = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");

        const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

        const servicesRes: ListResult<Service> =
          await ModelAPI.getList<Service>({
            modelType: Service,
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

        const dependenciesRes: ListResult<ServiceDependency> =
          await ModelAPI.getList<ServiceDependency>({
            modelType: ServiceDependency,
            query: { projectId },
            select: {
              _id: true,
              serviceId: true,
              dependencyServiceId: true,
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
              services={services.map((s: Service) => {
                return {
                  id: s.id!.toString(),
                  name: s.name || "",
                  color: (s as any).serviceColor?.toString?.() || undefined,
                };
              })}
              dependencies={dependencies.map((d: ServiceDependency) => {
                return {
                  fromServiceId: d.serviceId!.toString(),
                  toServiceId: d.dependencyServiceId!.toString(),
                };
              })}
            />
          ) : null}
        </>
      </Card>
    </Fragment>
  );
};

export default ServiceDependencyGraphPage;
