import LabelElement from "./Label";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import Label from "Common/Models/DatabaseModels/Label";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";

export interface ComponentProps {
  labelIds: Array<ObjectID>;
}

const FetchLabels: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

    const [isLoading, setIsLoading] = React.useState<boolean>(true);
    const [error, setError] = React.useState<string>("");
    const [labels, setLabels] = React.useState<Array<Label>>([]);


    const fetchLabels = async () => {
        setIsLoading(true);
        setError("");

        try{
            const labels: ListResult<Label> = await ModelAPI.getList({
                modelType: Label,
                query: {
                    _id: new Includes(props.labelIds),
                },
                skip: 0, 
                limit: LIMIT_PER_PROJECT,
                select: {
                    name: true, 
                    color: true, 
                    _id: true
                },
                sort: {
                    name: SortOrder.Ascending
                }
            });

            setLabels(labels.data);
        
        }catch(err){
            setError(API.getFriendlyMessage(err));
        }
    };

    useEffect(() => {
        fetchLabels().catch((err) => {
            setError(API.getFriendlyMessage(err));
        });
       
    }, []);

    if(error){
        return <ErrorMessage message={error} />;
    }


    if(isLoading){
        return <ComponentLoader />;
    }

  return (
    // {/** >4 because 3 labels are shown by default and then the more text is shown */}
    <TableColumnListComponent
      items={labels}
      moreText={labels.length > 4 ? "more labels" : "more label"}
      className={labels.length > 0 ? "-mb-1 -mt-1" : ""}
      getEachElement={(label: Label) => {
        return (
          <div className={labels.length > 0 ? "my-2" : ""}>
            <LabelElement label={label} />
          </div>
        );
      }}
      noItemsMessage="No labels attached."
    />
  );
};

export default FetchLabels;
