import React, { FunctionComponent, ReactElement } from "react";
import {
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
} from "./ResourceHeroLayout";

/*
 * A resource's description under its name in its hero: what the resource
 * is, in its owner's words (ResourceHeroLayout says how it is laid out and
 * why). Nothing at all when the resource has none, so a hero without one
 * keeps its height. Hovering it shows all of it, past its two lines.
 */

export interface ComponentProps {
  text: string | null | undefined;
}

const ResourceHeroDescription: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const text: string = (props.text || "").trim();

  if (!text) {
    return <></>;
  }

  return (
    <p
      data-testid={RESOURCE_HERO_DESCRIPTION_TEST_ID}
      dir="auto"
      title={text}
      className={RESOURCE_HERO_DESCRIPTION_CLASS_NAME}
    >
      {text}
    </p>
  );
};

export default ResourceHeroDescription;
