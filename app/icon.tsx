import { ImageResponse } from "next/og";

// App icons for the browser tab and for installing the dashboard as an app.
// The pulse line matches the brand mark in the header.
const ICONS = {
  favicon: { size: 32, maskable: false },
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  maskable: { size: 512, maskable: true },
} as const;

type IconId = keyof typeof ICONS;

export const contentType = "image/png";

export function generateImageMetadata() {
  return (Object.keys(ICONS) as IconId[]).map((id) => ({
    id,
    contentType,
    size: { width: ICONS[id].size, height: ICONS[id].size },
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const key = String(await id) as IconId;
  const { size, maskable } = ICONS[key] ?? ICONS["512"];
  // Maskable icons are cropped to a circle or squircle by the operating system,
  // so the mark stays inside the central safe zone and the background is full-bleed.
  const mark = Math.round(size * (maskable ? 0.5 : 0.68));
  const stroke = Math.max(2, Math.round(size / 14));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#18201f",
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 24 24" fill="none">
          <path
            d="M22 12h-4l-3 9L9 3l-3 9H2"
            stroke="#e65f45"
            strokeWidth={(stroke * 24) / mark}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
