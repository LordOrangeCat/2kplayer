import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/upload-preview")({
  head: () => ({
    meta: [
      { title: "2kPlayer v0.1.0 — uploaded player preview" },
      { name: "description", content: "Interactive review of the uploaded 2kPlayer local music library, playlists and equalizer." },
      { property: "og:title", content: "2kPlayer v0.1.0 — uploaded player preview" },
      { property: "og:description", content: "Preview the uploaded local music player with its library, playlists and equalizer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadedPlayerPreview,
});

function UploadedPlayerPreview() {
  return (
    <iframe
      src="/uploaded-player/player.html"
      title="2kPlayer uploaded PWA interactive preview"
      className="block h-dvh w-full border-0"
      allow="autoplay"
    />
  );
}