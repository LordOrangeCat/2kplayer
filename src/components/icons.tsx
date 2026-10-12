import type { SVGProps } from "react";

const P = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    width={22}
    height={22}
    shapeRendering="crispEdges"
    fill="currentColor"
    aria-hidden
    {...p}
  />
);

export const PlayIcon = () => (
  <P><path d="M4 2h2v1h2v1h2v1h2v1h1v4h-1v1h-2v1H8v1H6v1H4z" /></P>
);
export const PauseIcon = () => (
  <P><path d="M3 2h4v12H3zM9 2h4v12H9z" /></P>
);
export const PrevIcon = () => (
  <P><path d="M2 3h2v10H2zM12 3h2v10h-2v-1h-2v-1H8v-1H6V6h2V5h2V4h2z" /></P>
);
export const NextIcon = () => (
  <P><path d="M12 3h2v10h-2zM2 3h2v1h2v1h2v1h2v4H8v1H6v1H4v1H2z" /></P>
);
export const Back10Icon = () => (
  <P><path d="M1 8h1V7h1V6h1V5h1v6H4v-1H3V9H2V8zM7 8h1V7h1V6h1V5h1v6h-1v-1H9V9H8V8zM12 5h3v6h-3z" opacity="1" /></P>
);
export const Fwd10Icon = () => (
  <P><path d="M1 5h3v6H1zM5 5h1v1h1v1h1v1h1v1H8v1H7v1H6v1H5zM10 5h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" /></P>
);
export const ShuffleIcon = () => (
  <P><path d="M1 4h3v1h1v1h1v1H5V6H4V5H1zM6 9h1v1h1v1h3V9h1v1h1v1h1v1h-1v1h-1v1h-1v-2H8v-1H7v-1H6zM8 6h1V5h2V3h1v1h1v1h1v1h-1v1h-1v1h-1V6H9v1H8zM1 11h3v-1h1V9h1v1H5v1H4v1H1z" /></P>
);
export const RepeatIcon = () => (
  <P><path d="M3 4h8V2h1v1h1v1h1v1h-1v1h-1v1h-1V5H4v4H3zM12 7h1v5H5v2H4v-1H3v-1H2v-1h1v-1h1V9h1v2h7z" /></P>
);
export const HeartIcon = () => (
  <P><path d="M2 4h1V3h4v1h2V3h4v1h1v4h-1v1h-1v1h-1v1h-1v1H9v1H7v-1H6v-1H5v-1H4V9H3V8H2z" /></P>
);
export const PlusIcon = () => (
  <svg viewBox="0 0 8 8" width={10} height={10} shapeRendering="crispEdges" fill="currentColor"><path d="M3 0h2v3h3v2H5v3H3V5H0V3h3z" /></svg>
);
export const MinusIcon = () => (
  <svg viewBox="0 0 8 8" width={10} height={10} shapeRendering="crispEdges" fill="currentColor"><path d="M0 3h8v2H0z" /></svg>
);

export const CdIcon = ({ spinning }: { spinning: boolean }) => (
  <svg
    viewBox="0 0 28 28"
    width={56}
    height={56}
    shapeRendering="crispEdges"
    className={spinning ? "cd-spin" : undefined}
  >
    <circle cx="14" cy="14" r="13" fill="#000" />
    <circle cx="14" cy="14" r="12" fill="#e6b422" />
    <path d="M14 3a11 11 0 0 1 9 5l-6 4a4 4 0 0 0-3-2z" fill="#fff3b0" />
    <path d="M14 25a11 11 0 0 1-9-5l6-4a4 4 0 0 0 3 2z" fill="#b8860b" />
    <circle cx="14" cy="14" r="4" fill="#000" />
    <circle cx="14" cy="14" r="3" fill="#c0c0c0" />
    <circle cx="14" cy="14" r="1.5" fill="#000" />
  </svg>
);

export const DeckIcon = () => (
  <svg viewBox="0 0 39 22" width={78} height={44} shapeRendering="crispEdges">
    <rect x="0" y="0" width="39" height="22" fill="#000" />
    <rect x="1" y="1" width="37" height="20" fill="#a8a8a8" />
    <rect x="1" y="1" width="37" height="1" fill="#fff" />
    <rect x="1" y="1" width="1" height="20" fill="#fff" />
    <rect x="4" y="6" width="26" height="4" fill="#000" />
    <rect x="5" y="7" width="24" height="2" fill="#555" />
    <rect x="4" y="14" width="10" height="2" fill="#7a7a7a" />
    <rect x="32" y="14" width="3" height="3" fill="#000" />
    <rect x="33" y="15" width="1" height="1" fill="#e01b1b" />
    <rect x="32" y="15" width="3" height="1" fill="#e01b1b" />
  </svg>
);

export const VinylArt = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
    <rect width="100" height="100" fill="#a9825a" />
    <circle cx="50" cy="50" r="42" fill="#2a1d12" />
    <circle cx="50" cy="50" r="34" fill="none" stroke="#3a2a1c" strokeWidth="1" />
    <circle cx="50" cy="50" r="26" fill="none" stroke="#3a2a1c" strokeWidth="1" />
    <circle cx="50" cy="50" r="14" fill="#a9825a" />
    <circle cx="50" cy="50" r="2.5" fill="#2a1d12" />
  </svg>
);
