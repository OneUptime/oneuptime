import IconProp from "Common/Types/Icon/IconProp";

/*
 * The words and looks a part's page is built from - its status, its badges,
 * its chips - for every resource product. React-free, so a product's own
 * rules (Pages/Proxmox/Utils/ProxmoxPartFacts) can say what a part shows and
 * App tests can read them; ResourcePartHero draws them.
 */

export type ResourcePartTone = "positive" | "warning" | "danger" | "neutral";

export interface ResourcePartStatus {
  // "Online", "Running", "Stopped", "Unavailable" - English.
  label: string;
  tone: ResourcePartTone;
  /*
   * What the status means, in a sentence a screen reader hears after the
   * word and a pointer sees on hover. English.
   */
  description?: string | undefined;
}

export interface ResourcePartBadge {
  key: string;
  // English, or a template with values ("HA: {{state}}").
  label: string;
  values?: Record<string, string> | undefined;
  tone: ResourcePartTone;
}

export interface ResourcePartChip {
  key: string;
  icon: IconProp;
  // Already in the reader's language (a count or a size is built per chip).
  label: string;
}

export type ResourcePartAccent = "orange" | "indigo" | "sky" | "emerald";
