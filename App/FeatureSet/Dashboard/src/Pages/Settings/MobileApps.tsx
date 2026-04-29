import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

interface Feature {
  icon: IconProp;
  title: string;
  description: string;
}

const AppleLogo: FunctionComponent<{ className?: string }> = ({
  className,
}: {
  className?: string;
}): ReactElement => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
};

const GooglePlayLogo: FunctionComponent<{ className?: string }> = ({
  className,
}: {
  className?: string;
}): ReactElement => {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#00D7B6"
        d="m3.609 1.814 10.86 10.186L3.61 22.186a1.49 1.49 0 0 1-.61-1.205V3.02c0-.48.24-.904.609-1.206z"
      />
      <path
        fill="#FFCE00"
        d="m17.156 8.737-3.15 3.263 3.15 3.263 3.936-2.28a1.492 1.492 0 0 0 0-1.966l-3.936-2.28z"
      />
      <path
        fill="#FF3A44"
        d="m14.006 12-10.397 10.186c.38.31.895.375 1.348.113l12.199-6.96L14.006 12z"
      />
      <path
        fill="#00A94B"
        d="M4.957 1.701a1.469 1.469 0 0 0-1.348.113L14.006 12l3.15-3.263L4.957 1.7z"
      />
    </svg>
  );
};

const FeatureIcon: FunctionComponent<{ icon: IconProp }> = ({
  icon,
}: {
  icon: IconProp;
}): ReactElement => {
  return (
    <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-gray-800 to-gray-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(15,17,38,0.12)] ring-1 ring-black/5">
      <Icon icon={icon} size={SizeProp.Five} className="h-[18px] w-[18px]" />
    </div>
  );
};

const features: Array<Feature> = [
  {
    icon: IconProp.BellAlert,
    title: "Critical alerts",
    description: "Override Do Not Disturb when a page fires.",
  },
  {
    icon: IconProp.Calendar,
    title: "Rotations",
    description: "See the schedule and swap shifts in a tap.",
  },
  {
    icon: IconProp.CheckCircle,
    title: "One-tap respond",
    description: "Acknowledge, resolve, or escalate in seconds.",
  },
  {
    icon: IconProp.ShieldCheck,
    title: "Biometric secure",
    description: "Face ID unlock and encrypted delivery.",
  },
];

const IOS_URL: string =
  "https://apps.apple.com/us/app/oneuptime-on-call/id6759615391";
const ANDROID_URL: string =
  "https://play.google.com/store/apps/details?id=com.oneuptime.oncall";
const APK_URL: string =
  "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk";

const openLink: (url: string) => void = (url: string): void => {
  window.open(url, "_blank", "noopener,noreferrer");
};

interface DownloadRow {
  eyebrow: string;
  title: string;
  description: string;
  cta: ReactElement;
  onClick: () => void;
}

const downloadRows: Array<DownloadRow> = [
  {
    eyebrow: "iOS",
    title: "Download for iPhone and iPad",
    description: "Requires iOS 15.0 or later.",
    cta: (
      <>
        <AppleLogo className="h-6 w-6" />
        <div className="flex flex-col leading-tight text-left">
          <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-gray-300">
            Download on the
          </span>
          <span className="text-sm font-semibold">App Store</span>
        </div>
      </>
    ),
    onClick: () => {
      openLink(IOS_URL);
    },
  },
  {
    eyebrow: "Android",
    title: "Download for phones and tablets",
    description: "Requires Android 8.0 or later.",
    cta: (
      <>
        <GooglePlayLogo className="h-6 w-6" />
        <div className="flex flex-col leading-tight text-left">
          <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-gray-300">
            Get it on
          </span>
          <span className="text-sm font-semibold">Google Play</span>
        </div>
      </>
    ),
    onClick: () => {
      openLink(ANDROID_URL);
    },
  },
  {
    eyebrow: "APK",
    title: "Direct install for Android",
    description: "For devices without the Google Play Store.",
    cta: (
      <>
        <Icon
          icon={IconProp.Download}
          size={SizeProp.Five}
          className="h-4 w-4"
        />
        <span className="text-sm font-semibold">Download APK</span>
      </>
    ),
    onClick: () => {
      openLink(APK_URL);
    },
  },
];

const MobileApps: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <div className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-6 px-6 py-8 md:flex-row md:items-end md:justify-between md:px-10 md:py-10">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Image
                imageUrl={Route.fromString(`${OneUptimeLogo}`)}
                alt="OneUptime"
                className="h-6 w-auto"
              />
              <span className="h-5 w-px bg-gray-200" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                On-Call
              </span>
            </div>
            <h1 className="mt-5 text-[28px] font-semibold leading-[1.15] tracking-tight text-gray-900 md:text-[32px]">
              Your on-call toolkit, in your pocket.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-gray-500">
              Get paged on critical incidents, manage your rotation, and respond
              — all from your phone. Install the OneUptime On-Call app on your
              device.
            </p>
          </div>
          <div className="flex items-center gap-1.5 self-start rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 md:self-end">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Available on iOS & Android
          </div>
        </div>

        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {downloadRows.map((row: DownloadRow, index: number) => {
            const isApk: boolean = row.eyebrow === "APK";
            return (
              <div
                key={index}
                className="flex flex-col gap-4 px-6 py-5 transition-colors hover:bg-gray-50/60 md:flex-row md:items-center md:justify-between md:px-10"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400">
                    {row.eyebrow}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {row.title}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {row.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={row.onClick}
                  className={
                    isApk
                      ? "inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                      : "group inline-flex shrink-0 items-center gap-2.5 rounded-lg bg-gradient-to-b from-gray-800 to-gray-950 px-4 py-2.5 text-white shadow-sm ring-1 ring-black/5 transition-all hover:-translate-y-px hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                  }
                >
                  {row.cta}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature: Feature, index: number) => {
          return (
            <div
              key={index}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <FeatureIcon icon={feature.icon} />
              <p className="mt-5 text-[15px] font-semibold text-gray-900">
                {feature.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </Fragment>
  );
};

export default MobileApps;
