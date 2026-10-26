import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourceAddedModal from "../ResourceOnboarding/ResourceAddedModal";
import { SetupGuideFrameProps } from "../SetupGuide/SetupGuideCard";
import DatabaseDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import {
  DatabaseDocumentationTarget,
  getDatabaseDataArrivedField,
  getDatabaseDocumentationHeading,
} from "../../Pages/Database/Utils/DocumentationMarkdown";
import { fetchDatabaseDocumentationTarget } from "../../Pages/Database/Utils/DatabaseDocumentationTarget";
import { DATABASE_NOT_FOUND_MESSAGE } from "../../Pages/Database/Utils/DatabaseServerPresentation";

/*
 * Add Database saves the address; the engine metrics come from the
 * Database Agent running beside the database. So once the form has saved
 * one, its guide opens on its own - the database's Documentation tab,
 * prefilled for the row just added, id included - and its last step says
 * when the first engine metrics arrived.
 */

export const DATABASE_ADDED_VIEW_TEXT: string = translationKey("View database");

export interface ComponentProps {
  databaseId: ObjectID;
  // The name the form saved, shown while the guide loads.
  name: string;
  onClose: () => void;
}

const DatabaseAddedModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [target, setTarget] = useState<DatabaseDocumentationTarget | null>(
    null,
  );
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isMounted: boolean = true;

    fetchDatabaseDocumentationTarget(props.databaseId)
      .then((found: DatabaseDocumentationTarget | null) => {
        if (!isMounted) {
          return;
        }
        if (!found) {
          setError(DATABASE_NOT_FOUND_MESSAGE);
          return;
        }
        setTarget(found);
      })
      .catch((err: Error) => {
        if (isMounted) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [props.databaseId.toString()]);

  const heading: { title: string; description: string } | null = target
    ? getDatabaseDocumentationHeading(target)
    : null;

  return (
    <ResourceAddedModal
      title={heading?.title || props.name}
      description={heading?.description || ""}
      modelType={DatabaseServer}
      recordId={props.databaseId}
      name={target?.name || props.name}
      seenField={target ? getDatabaseDataArrivedField(target) : undefined}
      viewPage={PageMap.DATABASE_SERVER_VIEW}
      viewText={DATABASE_ADDED_VIEW_TEXT}
      isLoading={!target && !error}
      error={error || undefined}
      onClose={props.onClose}
      renderGuide={(frame: SetupGuideFrameProps): ReactElement => {
        return (
          <DatabaseDocumentationCard
            title={heading?.title || ""}
            description={heading?.description || ""}
            database={target || undefined}
            isBare={frame.isBare}
            lastStep={frame.lastStep}
          />
        );
      }}
    />
  );
};

export default DatabaseAddedModal;
