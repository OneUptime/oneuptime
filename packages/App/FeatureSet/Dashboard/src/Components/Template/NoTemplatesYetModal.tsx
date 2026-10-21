import Route from "Common/Types/API/Route";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // "No Incident Templates"
  title: string;
  /*
   * Where the templates are made, by the menu path the reader can follow
   * ("Incidents → Settings → Incident Templates"): a template settings page
   * lives under its own product's Settings, never under Project Settings.
   */
  description: string;
  // The settings page that lists the templates, where Create Template goes.
  templatesRoute: Route;
  onClose: () => void;
}

/*
 * What Create from Template says when the project has no templates of that
 * kind yet: where they are made, and a button that goes there. It used to
 * name a Project Settings page that does not exist, and on the
 * announcements list it was a dead end with only Close.
 */
const NoTemplatesYetModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ConfirmModal
      title={props.title}
      description={props.description}
      submitButtonText="Create Template"
      onSubmit={() => {
        props.onClose();
        Navigation.navigate(props.templatesRoute);
      }}
      closeButtonText="Close"
      onClose={props.onClose}
    />
  );
};

export default NoTemplatesYetModal;
