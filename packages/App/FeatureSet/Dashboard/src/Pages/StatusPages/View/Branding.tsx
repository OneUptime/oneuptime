import PageComponentProps from "../../PageComponentProps";
import SearchEngineIndexingCard from "../../../Components/StatusPage/SearchEngineIndexingCard";
import StatusPageBrandingCopy, {
  BRANDING_ADVANCED_SECTION_TEST_ID,
  BrandingAdvancedValues,
  getBrandingAdvancedItems,
} from "../../../Components/StatusPage/StatusPageBrandingCopy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
} from "Common/Types/StatusPage/StatusPageLanguage";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageFooterLink from "Common/Models/DatabaseModels/StatusPageFooterLink";
import StatusPageHeaderLink from "Common/Models/DatabaseModels/StatusPageHeaderLink";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Status Pages -> a page -> Branding -> Branding: everything that makes the
 * status page look like yours, on one page.
 *
 * It used to be five screens (Essential Branding, Header, Footer, Overview
 * Page, Languages), and what people looked for was rarely where the names
 * said: the logo and cover image were on Header, the favicon on Essential
 * Branding, the history chart's colors on Overview Page. The cards are the
 * same cards, with the analytics names they had (the two language cards are
 * one card now, "Status Page > Languages"). First what nearly everyone
 * sets, in the order a visitor meets it: the logo and cover image, the
 * page's title and description, its favicon, the header's links, the text
 * at the top of the overview, and the footer. Then, folded under Advanced,
 * what few people ever change: the history chart's colors, the languages,
 * and search engine indexing. The section says "Configured" while it holds
 * anything a new status page does not start with.
 *
 * The old screens' URLs forward here (Routes/StatusPagesRoutes.tsx). Custom
 * domains and custom HTML, CSS and JavaScript keep their own pages beside
 * this one in the menu. The overall uptime % and the statuses that count as
 * downtime were on Overview Page too; they are about what the page shows,
 * so they are on Advanced Settings.
 */

const languageDropdownOptions: Array<DropdownOption> =
  SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: StatusPageLanguage) => {
    return {
      value: language.code,
      label: `${language.nativeName} (${language.englishName})`,
    };
  });

const codeToLabel: Record<string, string> = Object.fromEntries(
  SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: StatusPageLanguage) => {
    return [language.code, `${language.nativeName} (${language.englishName})`];
  }),
);

const StatusPageBranding: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // What the cards under Advanced hold, as each one loads or saves it.
  const [advancedValues, setAdvancedValues] = useState<BrandingAdvancedValues>(
    {},
  );

  const rememberAdvanced: (values: BrandingAdvancedValues) => void = (
    values: BrandingAdvancedValues,
  ): void => {
    setAdvancedValues(
      (current: BrandingAdvancedValues): BrandingAdvancedValues => {
        return { ...current, ...values };
      },
    );
  };

  return (
    <Fragment>
      {/*
       * The logo and the cover image, at the top of the status page. The
       * favicon has its own card below; this card's old title named the
       * favicon too, and sent people looking for it here.
       */}
      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Header Style"
        cardProps={{
          title: "Logo and Cover Image",
          description: "These will show up on your status page.",
        }}
        isEditable={true}
        editButtonText={"Edit Images"}
        formSteps={[
          { title: "Logo", id: "logo" },
          { title: "Cover Image", id: "cover-image" },
        ]}
        formFields={[
          {
            field: {
              logoFile: true,
            },
            title: "Logo",
            stepId: "logo",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload logo",
          },
          {
            field: {
              logoAltText: true,
            },
            title: "Logo Alt Text",
            stepId: "logo",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Logo of My Company",
            description:
              "Alternative text for the logo, read by screen readers. If left blank, the status page title is used.",
          },
          {
            field: {
              coverImageFile: true,
            },
            title: "Cover",
            stepId: "cover-image",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload cover image",
          },
          {
            field: {
              coverImageAltText: true,
            },
            title: "Cover Image Alt Text",
            stepId: "cover-image",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Description of the cover image",
            description:
              "Alternative text for the cover image, read by screen readers. Leave blank if the cover image is purely decorative.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-logo-and-cover-image",
          fields: [
            {
              field: {
                logoFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Logo",
              placeholder: "No logo uploaded.",
            },
            {
              field: {
                logoAltText: true,
              },
              fieldType: FieldType.Text,
              title: "Logo Alt Text",
              placeholder: "Status page title is used.",
            },
            {
              field: {
                coverImageFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Cover Image",
              placeholder: "No cover uploaded.",
            },
            {
              field: {
                coverImageAltText: true,
              },
              fieldType: FieldType.Text,
              title: "Cover Image Alt Text",
              placeholder: "Decorative (no alt text).",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Title and Description"
        cardProps={{
          title: "Title and Description",
          description: "This will also be used for SEO.",
        }}
        editButtonText={"Edit"}
        isEditable={true}
        formFields={[
          {
            field: {
              pageTitle: true,
            },
            title: "Page Title",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Please enter page title here.",
          },
          {
            field: {
              pageDescription: true,
            },
            title: "Page Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Please enter page description here.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-title-and-description",
          fields: [
            {
              field: {
                pageTitle: true,
              },
              fieldType: FieldType.Text,
              title: "Page Title",
              placeholder: "No page title entered so far.",
            },
            {
              field: {
                pageDescription: true,
              },
              fieldType: FieldType.Text,
              title: "Page Description",
              placeholder: "No page description entered so far.",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Favicon"
        cardProps={{
          title: "Favicon",
          description: "Favicon will be used for SEO.",
        }}
        isEditable={true}
        editButtonText={"Edit Favicon"}
        formFields={[
          {
            field: {
              faviconFile: true,
            },
            title: "Favicon",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload Favicon.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-favicon",
          fields: [
            {
              field: {
                faviconFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Favicon",
              placeholder: "No favicon uploaded.",
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<StatusPageHeaderLink>
        modelType={StatusPageHeaderLink}
        id="status-page-header-link"
        name="Status Page > Header Links"
        userPreferencesKey="status-page-header-link-table"
        saveFilterProps={{
          tableId: "status-page-header-links-table",
        }}
        isDeleteable={true}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        isCreateable={true}
        isEditable={true}
        isViewable={false}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        onBeforeCreate={(
          item: StatusPageHeaderLink,
        ): Promise<StatusPageHeaderLink> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Header Links",
          description: "Header Links for your status page",
        }}
        noItemsMessage={"No status header link for this status page."}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Title",
          },
          {
            field: {
              link: true,
            },
            title: "Link",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            placeholder: "https://link.com",
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              link: true,
            },
            title: "Link",
            type: FieldType.URL,
          },
        ]}
        columns={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              link: true,
            },
            title: "Link",
            type: FieldType.URL,
            hideOnMobile: true,
          },
        ]}
      />

      {/*
       * The first thing on the status page's overview, above the
       * announcements, the overall status and the resources.
       */}
      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Overview Page"
        cardProps={{
          title: StatusPageBrandingCopy.overviewDescriptionTitle,
          description: StatusPageBrandingCopy.overviewDescriptionDescription,
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        editButtonText={StatusPageBrandingCopy.overviewDescriptionEditButton}
        formFields={[
          {
            field: {
              overviewPageDescription: true,
            },
            title: "Overview Page Description",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: MarkdownUtil.getMarkdownCheatsheet(
              "Describe your status page overview here",
            ),
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "overview-page-description",
          fields: [
            {
              field: {
                overviewPageDescription: true,
              },
              fieldType: FieldType.Markdown,
              title: "Overview Page Description",
              placeholder: "No description set.",
            },
          ],
          modelId: modelId,
        }}
      />

      {/* The footer: the copyright line, then the footer's links. */}
      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Copyright"
        cardProps={{
          title: "Copyright Info",
          description: "Copyright info for your status page",
        }}
        isEditable={true}
        editButtonText={"Edit Copyright"}
        formFields={[
          {
            field: {
              copyrightText: true,
            },
            title: "Copyright Info",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Acme, Inc.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-copyright",
          fields: [
            {
              field: {
                copyrightText: true,
              },
              fieldType: FieldType.Text,
              title: "Copyright Info",
              placeholder: "No copyright info entered so far.",
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<StatusPageFooterLink>
        modelType={StatusPageFooterLink}
        id="status-page-Footer-link"
        isDeleteable={true}
        name="Status Page > Footer Links"
        userPreferencesKey="status-page-footer-link-table"
        saveFilterProps={{
          tableId: "status-page-footer-links-table",
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        isCreateable={true}
        isViewable={false}
        isEditable={true}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        onBeforeCreate={(
          item: StatusPageFooterLink,
        ): Promise<StatusPageFooterLink> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Footer Links",
          description: "Footer Links for your status page",
        }}
        noItemsMessage={"No status footer link for this status page."}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Title",
          },
          {
            field: {
              link: true,
            },
            title: "Link",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            placeholder: "https://link.com",
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              link: true,
            },
            title: "Link",
            type: FieldType.URL,
          },
        ]}
        columns={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              link: true,
            },
            title: "Link",
            type: FieldType.URL,
            hideOnMobile: true,
          },
        ]}
      />

      {/*
       * What few people change, folded: the history chart's colors, the
       * languages, and whether search engines may list the page. Each card
       * reports what it holds as it loads or saves, so the folded section
       * draws a card as a chip when it differs from a new page's.
       */}
      <AdvancedPageSection
        description={StatusPageBrandingCopy.advancedDescription}
        items={getBrandingAdvancedItems(advancedValues)}
        dataTestId={BRANDING_ADVANCED_SECTION_TEST_ID}
      >
        <CardModelDetail<StatusPage>
          name="Status Page > Branding > Default Bar Color"
          cardProps={{
            title: "Default Bar Color of the History Chart",
            description:
              "Bar color will be used for history chart when no data is set.",
          }}
          isEditable={true}
          editButtonText={"Edit Default Bar Color"}
          formFields={[
            {
              field: {
                defaultBarColor: true,
              },
              title: "Default Bar Color",
              fieldType: FormFieldSchemaType.Color,
              required: true,
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: StatusPage,
            id: "default-bar-color",
            onItemLoaded: (item: StatusPage): void => {
              rememberAdvanced({ defaultBarColor: item.defaultBarColor });
            },
            fields: [
              {
                field: {
                  defaultBarColor: true,
                },
                fieldType: FieldType.Color,
                title: "Default Bar Color",
                placeholder: "No color set.",
              },
            ],
            modelId: modelId,
          }}
        />

        <ModelTable<StatusPageHistoryChartBarColorRule>
          modelType={StatusPageHistoryChartBarColorRule}
          id={`status-page-history-chart-bar-color-rules`}
          isDeleteable={true}
          name="Status Page > Branding > History Chart Bar Color Rules"
          userPreferencesKey="status-page-history-chart-bar-color-rules"
          sortBy="order"
          showViewIdButton={true}
          sortOrder={SortOrder.Ascending}
          isCreateable={true}
          isViewable={false}
          isEditable={true}
          query={{
            statusPageId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          enableDragAndDrop={true}
          dragDropIndexField="order"
          singularName="Rule"
          pluralName="Rules"
          onFetchSuccess={(
            _rules: Array<StatusPageHistoryChartBarColorRule>,
            totalCount: number,
          ): void => {
            rememberAdvanced({ barColorRuleCount: totalCount });
          }}
          onBeforeCreate={(
            item: StatusPageHistoryChartBarColorRule,
          ): Promise<StatusPageHistoryChartBarColorRule> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }

            item.statusPageId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);

            return Promise.resolve(item);
          }}
          cardProps={{
            title: `Rules for Bar Colors of History Chart`,
            description: "Rules for history chart bar colors.",
          }}
          noItemsMessage={
            "No history chart bar color rules have been set. By default the lowest monitor state color of that particular day will be used."
          }
          formFields={[
            {
              field: {
                uptimePercentGreaterThanOrEqualTo: true,
              },
              title: "When uptime % is greater than or equal to",
              description:
                "This rule will be applied when uptime is greater than or equal to this value.",
              fieldType: FormFieldSchemaType.Number,
              validation: {
                minValue: 0,
                maxValue: 100,
              },
              required: true,
              placeholder: "90",
            },
            {
              field: {
                barColor: true,
              },
              title: "Then, use this bar color",
              fieldType: FormFieldSchemaType.Color,
              required: true,
              placeholder: "No color set",
            },
          ]}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[]}
          columns={[
            {
              field: {
                uptimePercentGreaterThanOrEqualTo: true,
              },
              title: "When Uptime Percent >=",
              type: FieldType.Percent,
            },
            {
              field: {
                barColor: true,
              },
              title: "Then, Bar Color is",
              type: FieldType.Color,
            },
          ]}
        />

        {/*
         * Which language a first-time visitor gets, and which ones the
         * footer's switcher offers: one question about the page's
         * languages, so one card and one dialog (they were two of each).
         */}
        <CardModelDetail<StatusPage>
          name="Status Page > Languages"
          cardProps={{
            title: StatusPageBrandingCopy.languagesTitle,
            description: StatusPageBrandingCopy.languagesDescription,
          }}
          editButtonText={StatusPageBrandingCopy.languagesEditButton}
          isEditable={true}
          formFields={[
            {
              field: {
                defaultLanguage: true,
              },
              title: "Default Language",
              description:
                "The language that first-time visitors see. Visitors can always switch languages from the footer.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: languageDropdownOptions,
              required: true,
              defaultValue: DEFAULT_STATUS_PAGE_LANGUAGE,
            },
            {
              field: {
                enabledLanguages: true,
              },
              title: "Enabled Languages",
              description:
                "Leave empty to offer every supported language to visitors.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownOptions: languageDropdownOptions,
              required: false,
              placeholder: "All languages",
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: StatusPage,
            id: "model-detail-status-page-languages",
            onItemLoaded: (item: StatusPage): void => {
              rememberAdvanced({
                defaultLanguage: item.defaultLanguage,
                enabledLanguages: item.enabledLanguages,
              });
            },
            fields: [
              {
                field: {
                  defaultLanguage: true,
                },
                fieldType: FieldType.Text,
                title: "Default Language",
                placeholder: codeToLabel[
                  DEFAULT_STATUS_PAGE_LANGUAGE
                ] as string,
                getElement: (item: StatusPage): ReactElement => {
                  const code: string =
                    item.defaultLanguage || DEFAULT_STATUS_PAGE_LANGUAGE;
                  return <span>{codeToLabel[code] || code}</span>;
                },
              },
              {
                field: {
                  enabledLanguages: true,
                },
                fieldType: FieldType.Text,
                title: "Enabled Languages",
                placeholder: "All supported languages",
                getElement: (item: StatusPage): ReactElement => {
                  const enabled: Array<string> | undefined =
                    item.enabledLanguages;
                  if (!enabled || enabled.length === 0) {
                    return (
                      <span>
                        {translator.translateText("All supported languages")}
                      </span>
                    );
                  }
                  const labels: Array<string> = enabled.map((code: string) => {
                    return codeToLabel[code] || code;
                  });
                  return <span>{labels.join(", ")}</span>;
                },
              },
            ],
            modelId: modelId,
          }}
        />

        <SearchEngineIndexingCard
          statusPageId={modelId}
          onChange={(isOn: boolean): void => {
            rememberAdvanced({ enableSearchEngineIndexing: isOn });
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default StatusPageBranding;
