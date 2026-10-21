import UserElement from "../User/User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { ReactElement } from "react";

/*
 * "When was this archived, and by whom" - the two columns every Archived page
 * ends with, so they read the same for a workflow, a monitor or a status page.
 * The server stamps both from the isArchived write (DatabaseService), so they
 * cannot be edited, only shown.
 */
export const getArchivedColumns: <T extends BaseModel>() => Columns<T> = <
  T extends BaseModel,
>(): Columns<T> => {
  return [
    {
      field: {
        archivedAt: true,
      } as any,
      title: "Archived At",
      type: FieldType.DateTime,
    },
    {
      field: {
        archivedByUser: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      } as any,
      title: "Archived By",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (item: T): ReactElement => {
        const archivedByUser: User | undefined = (item as any)[
          "archivedByUser"
        ] as User | undefined;

        /*
         * Empty for something archived through the API with a project key,
         * or whose archiving user has since been deleted (SET NULL).
         */
        if (!archivedByUser) {
          return <span className="text-sm text-gray-400">—</span>;
        }

        return <UserElement user={archivedByUser} />;
      },
    },
  ];
};

// The matching filter, so an Archived page can be narrowed to a time range.
export const getArchivedAtFilter: <T extends BaseModel>() => Filter<T> = <
  T extends BaseModel,
>(): Filter<T> => {
  return {
    field: {
      archivedAt: true,
    } as any,
    title: "Archived At",
    type: FieldType.Date,
  };
};
