import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Field from "Common/UI/Components/Forms/Types/Field";
import RecordsById from "Common/UI/Utils/RecordsById";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { MutableRefObject, useCallback, useRef, useState } from "react";

/*
 * AN OPENSTACK CLOUD'S PROJECTS, PICKED FROM THE SERVER (#10646).
 *
 * A budget's project, a notice's project and the projects whose instances
 * keep series of their own were picked from the cloud's first 500 to 1,000
 * projects, read when the card opened, and named from the same list. A
 * project past them could not be picked; one a budget or a notice was for
 * showed as its raw id; and a project the instance metrics held past them
 * vanished the next time the choice was saved.
 *
 * The picker searches the cloud's projects as it is typed in, by name or by
 * the cloud's own id for one (externalId, which every OpenStack setting
 * holds); what a setting holds is read by that id within the cloud, so it
 * is named however many the cloud has, and one gone reads "No longer
 * available", to keep or take out.
 */

export const OPENSTACK_PROJECT_NOT_FOUND_LABEL: string = translationKey(
  "No longer available",
);

type DropdownModal = NonNullable<Field<JSONObject>["dropdownModal"]>;

// The projects of one cloud: what names one by its externalId.
export const getOpenStackProjectsQuery: (
  openStackCloudId: ObjectID,
) => Record<string, unknown> = (
  openStackCloudId: ObjectID,
): Record<string, unknown> => {
  return {
    openStackCloudId: openStackCloudId,
    kind: OpenStackResourceKind.Project,
  };
};

// A form field's picker of one cloud's projects (a dropdownModal).
export const getOpenStackProjectPicker: (
  openStackCloudId: ObjectID,
) => DropdownModal = (openStackCloudId: ObjectID): DropdownModal => {
  return {
    type: OpenStackResource,
    labelField: "name",
    valueField: "externalId",
    query: getOpenStackProjectsQuery(openStackCloudId),
    heldValueQuery: getOpenStackProjectsQuery(openStackCloudId),
    searchFields: ["name", "externalId"],
    notFoundLabel: OPENSTACK_PROJECT_NOT_FOUND_LABEL,
  };
};

export interface OpenStackProjectNames {
  // A project's name by the cloud's id for it, once read.
  nameOf: (externalId: string | undefined) => string | undefined;
  // Reads the names of these projects, the ones not read already.
  readNamesOf: (externalIds: Array<string | undefined>) => Promise<void>;
}

/*
 * The names of the projects a card's rows name - a budget's, a notice's -
 * read by the cloud's ids for them, as the rows are read (a table's
 * onFetchSuccess). One a read did not find stays unnamed: the card shows
 * its id, as it did.
 */
export function useOpenStackProjectNames(
  openStackCloudId: ObjectID,
): OpenStackProjectNames {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const requestedRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );

  const readNamesOf: (externalIds: Array<string | undefined>) => Promise<void> =
    useCallback(
      async (externalIds: Array<string | undefined>): Promise<void> => {
        const toRead: Array<string> = externalIds.filter(
          (id: string | undefined): id is string => {
            return Boolean(id) && !requestedRef.current.has(id!);
          },
        );

        if (toRead.length === 0) {
          return;
        }

        for (const id of toRead) {
          requestedRef.current.add(id);
        }

        try {
          const projects: Array<OpenStackResource> =
            await RecordsById.read<OpenStackResource>({
              modelType: OpenStackResource,
              ids: toRead,
              column: "externalId",
              query: getOpenStackProjectsQuery(openStackCloudId) as never,
              select: { name: true, externalId: true },
            });

          setNames((current: Map<string, string>): Map<string, string> => {
            const next: Map<string, string> = new Map(current);

            for (const project of projects) {
              if (project.externalId && project.name) {
                next.set(project.externalId, project.name);
              }
            }

            return next;
          });
        } catch {
          // Unnamed: the card shows each project's id, as it did.
          for (const id of toRead) {
            requestedRef.current.delete(id);
          }
        }
      },
      [openStackCloudId.toString()],
    );

  return {
    nameOf: (externalId: string | undefined): string | undefined => {
      return externalId ? names.get(externalId) : undefined;
    },
    readNamesOf: readNamesOf,
  };
}
