import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { translatableTerm } from "Common/Types/Translator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  OpenStackChangeReach,
  OpenStackReachHost,
  OpenStackReachInstance,
  OpenStackReachProject,
} from "Common/Utils/AiRemediation/Resource/OpenStackChangeReach";
import React, { FunctionComponent, ReactElement } from "react";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

/*
 * What an OpenStack change touches, under the change on the AI card's Remediation
 * step: how many instances and projects, which, and what state the host is in, as
 * the cloud's AI agent read them when the fix was proposed. A person approving an
 * evacuation is shown its instances and whose they are, and what it leaves behind.
 *
 * Lines, not a box: the AI card is the only frame. The names are the cloud's, so
 * they are shown as text and let the browser decide their direction.
 */

export const OPENSTACK_REACH_NOTE_TEST_ID: string =
  "remediation-openstack-reach";

export interface ComponentProps {
  reach: OpenStackChangeReach;
}

// The most rows shown of each list before the rest fold behind a count.
const SHOWN_INSTANCES: number = 10;

function instanceLine(
  instance: OpenStackReachInstance,
  translator: Translator,
): ReactElement {
  return (
    <li key={instance.id} className="break-words">
      <bdi>{instance.name || instance.id}</bdi>
      {instance.projectName || instance.projectId ? (
        <span className="text-gray-500">
          <InlineSeparator />
          <bdi>{instance.projectName || instance.projectId}</bdi>
        </span>
      ) : (
        <></>
      )}
      {instance.host ? (
        <span className="text-gray-500">
          <InlineSeparator />
          {translator.translateTemplate("on {{host}}", {
            host: instance.host,
          })}
        </span>
      ) : (
        <></>
      )}
    </li>
  );
}

const OpenStackReachNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { reach } = props;
  const counts: { instances: number; projects: number } = {
    instances: reach.instanceCount,
    projects: reach.projectCount,
  };
  // As counts, not a sentence: one instance in one project reads as well as fifty in nine.
  const heading: string = reach.isComplete
    ? translator.translateTemplate(
        reach.kind === "changes"
          ? "Instances it changes: {{instances}}. Projects they belong to: {{projects}}."
          : "It changes no instance. Instances on the host: {{instances}}. Projects they belong to: {{projects}}.",
        counts,
      )
    : translator.translateTemplate(
        reach.kind === "changes"
          ? "Instances it changes: at least {{instances}}. Projects they belong to: at least {{projects}}."
          : "It changes no instance. Instances on the host: at least {{instances}}. Projects they belong to: at least {{projects}}.",
        counts,
      );

  return (
    <div
      data-testid={OPENSTACK_REACH_NOTE_TEST_ID}
      className="space-y-1 text-xs leading-5 text-gray-700"
    >
      <div className="flex items-start gap-1 font-medium text-gray-900">
        <Icon icon={IconProp.Layers} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{heading}</span>
      </div>
      {reach.projects.length > 0 ? (
        <div data-testid="remediation-openstack-reach-projects">
          {reach.projects.map(
            (project: OpenStackReachProject, index: number): ReactElement => {
              return (
                <span key={project.id}>
                  {index > 0 ? ", " : ""}
                  <bdi>{project.name || project.id}</bdi>
                  {` (${project.instanceCount})`}
                </span>
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}
      {reach.kind === "changes" && reach.instances.length > 0 ? (
        <ul data-testid="remediation-openstack-reach-instances">
          {reach.instances
            .slice(0, SHOWN_INSTANCES)
            .map((instance: OpenStackReachInstance): ReactElement => {
              return instanceLine(instance, translator);
            })}
          {reach.instances.length > SHOWN_INSTANCES ? (
            <li>
              <details>
                <summary className="cursor-pointer text-gray-500">
                  {translator.translateTemplate("{{count}} more", {
                    count: reach.instances.length - SHOWN_INSTANCES,
                  })}
                </summary>
                <ul>
                  {reach.instances
                    .slice(SHOWN_INSTANCES)
                    .map((instance: OpenStackReachInstance): ReactElement => {
                      return instanceLine(instance, translator);
                    })}
                </ul>
              </details>
            </li>
          ) : (
            <></>
          )}
        </ul>
      ) : (
        <></>
      )}
      {reach.hosts.map((host: OpenStackReachHost): ReactElement => {
        return (
          <div key={host.name} data-testid="remediation-openstack-reach-host">
            {translator.translateTemplate(
              "nova-compute on {{host}}: {{state}}, {{status}}",
              {
                host: host.name,
                state: host.state || translatableTerm("not read"),
                status: host.status || translatableTerm("not read"),
              },
            )}
          </div>
        );
      })}
      {reach.leftBehindCount > 0 ? (
        <div
          className="text-amber-700"
          data-testid="remediation-openstack-reach-left-behind"
        >
          {translator.translateTemplate(
            "This leaves {{count}} more on that host, which it does not name.",
            { count: reach.leftBehindCount },
          )}
        </div>
      ) : (
        <></>
      )}
      {reach.problems.map((problem: string): ReactElement => {
        return (
          <div key={problem} className="text-amber-700">
            <bdi>{problem}</bdi>
          </div>
        );
      })}
    </div>
  );
};

export default OpenStackReachNote;
