import FormSignInCopy, {
  FORM_SIGN_IN_ONLY_FOLD_TEST_ID,
  FORM_SIGN_IN_ONLY_NOTICE_TEST_ID,
  FormSignInOnlyPage,
  isFormSignInOnlyNoticeShown,
} from "./FormSignInCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { getPageAnchor } from "Common/UI/Utils/PageAnchor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A page of settings that only Only people who sign in reads: a form's
 * Private Users and Single Sign-On (#10249). While the form does not ask
 * its visitors to sign in, it opens on one notice that says these settings
 * do nothing yet, with the way to the Share page, and folds the settings
 * under it: they can still be set up first. A link that names a place on
 * the page opens the fold. As a dashboard's (DashboardSignInOnlySettings).
 *
 * Once the form asks its visitors to sign in, or until it is read - or when
 * it cannot be - the settings are drawn as they are.
 */
export interface ComponentProps {
  formId: ObjectID;
  page: FormSignInOnlyPage;
  children: ReactElement;
}

const FormSignInOnlySettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [requireSignIn, setRequireSignIn] = useState<boolean | undefined>(
    undefined,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    const fetchForm: () => Promise<void> = async (): Promise<void> => {
      try {
        const form: Form | null = await ModelAPI.getItem({
          modelType: Form,
          id: props.formId,
          select: {
            requireSignIn: true,
          },
        });

        if (isCurrent && form) {
          setRequireSignIn(Boolean(form.requireSignIn));
        }
      } catch {
        // The settings below say what went wrong, if anything did.
      }
    };

    void fetchForm();

    return () => {
      isCurrent = false;
    };
  }, [props.formId.toString()]);

  if (!isFormSignInOnlyNoticeShown(requireSignIn)) {
    return props.children;
  }

  return (
    <Fragment>
      <Alert
        className="mb-5"
        type={AlertType.INFO}
        title={FormSignInCopy.notice}
        textOnRight={FormSignInCopy.noticeAction}
        dataTestId={FORM_SIGN_IN_ONLY_NOTICE_TEST_ID}
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_SHARE] as Route,
              { modelId: props.formId },
            ),
          );
        }}
      />

      <div data-testid={FORM_SIGN_IN_ONLY_FOLD_TEST_ID}>
        <CollapsibleSection
          title={FormSignInCopy.foldTitle}
          description={FormSignInCopy.foldDescription}
          collapsedDescription={FormSignInCopy.foldSummary[props.page]}
          defaultCollapsed={!getPageAnchor()}
        >
          <div>{props.children}</div>
        </CollapsibleSection>
      </div>
    </Fragment>
  );
};

export default FormSignInOnlySettings;
