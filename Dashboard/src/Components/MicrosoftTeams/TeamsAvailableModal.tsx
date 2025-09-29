import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Button from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import List from "Common/UI/Components/List/List";
import Field from "Common/UI/Components/Detail/Field";

export interface TeamItem {
  id: string;
  name: string;
}

export interface TeamsAvailableModalProps {
  isOpen: boolean;
  onClose: VoidFunction;
  onRefresh: () => Promise<void> | void;
  isRefreshing: boolean;
  teams: Array<TeamItem>;
  isLoading: boolean;
  error?: string;
  isAdminConsentCompleted: boolean;
}

const TeamsAvailableModal: FunctionComponent<TeamsAvailableModalProps> = (
  props: TeamsAvailableModalProps,
): ReactElement | null => {
  const [teamsSearch, setTeamsSearch] = React.useState<string>("");

  const filteredTeams: Array<TeamItem> = React.useMemo(() => {
    const q: string = teamsSearch.trim().toLowerCase();
    if (!q) {
      return props.teams;
    }
    return props.teams.filter((t: TeamItem) => {
      return (
        t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
      );
    });
  }, [props.teams, teamsSearch]);

  if (!props.isOpen) {
    return null;
  }

  return (
    <Modal
      title="Microsoft Teams — Available Teams"
      description="Browse and search the Microsoft Teams that OneUptime can access. Copy Team IDs if needed. Use Refresh to fetch the latest list."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      submitButtonText="Close"
      onSubmit={props.onClose}
      rightElement={
        <Button
          title="Refresh Teams"
          icon={IconProp.Refresh}
          isLoading={props.isRefreshing}
          onClick={async () => {
            await props.onRefresh();
          }}
        />
      }
      isBodyLoading={props.isLoading}
    >
      <>
        {props.error && (
          <div className="mb-4">
            <ErrorMessage message={<div>{props.error}</div>} />
          </div>
        )}

        {!props.error && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="w-full md:w-2/3">
                <Input
                  placeholder="Search teams by name or ID"
                  type={InputType.TEXT}
                  value={teamsSearch}
                  onChange={(v: string) => setTeamsSearch(v)}
                />
              </div>
              <div className="text-sm text-gray-600">
                Showing {filteredTeams.length} of {props.teams.length} team
                {props.teams.length !== 1 ? "s" : ""}
              </div>
            </div>

            {props.teams.length === 0 && (
              <div className="text-center py-12 text-gray-500 border rounded-md">
                {props.isAdminConsentCompleted
                  ? "No teams found. Try refreshing the list or verify your Microsoft Teams permissions."
                  : "Admin consent is required to list teams."}
              </div>
            )}

            {props.teams.length > 0 && filteredTeams.length === 0 && (
              <div className="text-center py-12 text-gray-500 border rounded-md">
                No teams match your search.
              </div>
            )}

            {filteredTeams.length > 0 && (
              <div className="space-y-2">
                <List
                  id="teams-list"
                  data={filteredTeams}
                  fields={[
                    {
                      key: "name",
                      title: "Team Name",
                      contentClassName: "font-medium",
                    } as Field<TeamItem>,
                    {
                      key: "id",
                      title: "Team ID",
                      contentClassName: "font-mono text-gray-600",
                      opts: { isCopyable: true },
                    } as Field<TeamItem>,
                  ]}
                  // pagination disabled
                  onNavigateToPage={() => {}}
                  currentPageNumber={1}
                  totalItemsCount={filteredTeams.length}
                  itemsOnPage={filteredTeams.length || 1}
                  disablePagination={true}
                  error=""
                  isLoading={false}
                  singularLabel="Team"
                  pluralLabel="Teams"
                  noItemsMessage=""
                  listDetailOptions={{ showDetailsInNumberOfColumns: 2 }}
                />
              </div>
            )}
          </div>
        )}
      </>
    </Modal>
  );
};

export default TeamsAvailableModal;
