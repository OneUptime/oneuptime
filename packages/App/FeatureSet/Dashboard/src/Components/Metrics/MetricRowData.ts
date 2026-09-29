import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";

export function getVisibleMetricServices(data: {
  services?: Array<Service> | undefined;
  serviceIds?: Array<ObjectID> | undefined;
}): Array<Service> {
  const scopedServiceIds: Set<string> = new Set(
    (data.serviceIds || []).map((serviceId: ObjectID): string => {
      return serviceId.toString();
    }),
  );

  return (data.services || []).filter((service: Service): boolean => {
    if (!service.name || !service.name.toString().trim()) {
      return false;
    }

    if (scopedServiceIds.size === 0) {
      return true;
    }

    const serviceId: string | undefined = service._id?.toString();

    return Boolean(serviceId && scopedServiceIds.has(serviceId));
  });
}
