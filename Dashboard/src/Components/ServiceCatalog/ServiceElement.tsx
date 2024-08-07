import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ColorSquareCube from "Common/UI/Components/ColorSquareCube/ColorSquareCube";
import Link from "Common/UI/Components/Link/Link";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  serviceCatalog: ServiceCatalog;
  onNavigateComplete?: (() => void) | undefined;
  serviceCatalogNameClassName?: string;
}

const ServiceCatalogElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getServiceElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="flex space-x-2">
        <div className="mt-1">
          <ColorSquareCube
            color={props.serviceCatalog.serviceColor || Black}
            tooltip={`${props.serviceCatalog.name?.toString()} Service Color`}
          />
        </div>
        <div className={props.serviceCatalogNameClassName}>
          {props.serviceCatalog.name?.toString()}
        </div>
      </div>
    );
  };

  if (props.serviceCatalog._id) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SERVICE_CATALOG_VIEW] as Route,
          {
            modelId: new ObjectID(props.serviceCatalog._id as string),
          },
        )}
      >
        {getServiceElement()}
      </Link>
    );
  }

  return <div>{getServiceElement()}</div>;
};

export default ServiceCatalogElement;
