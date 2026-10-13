import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/upload-preview-v011")({
  head: () => ({
    meta: [
      { title: "2kPlayer v0.1.1 — interactive preview" },
      { name: "description", content: "Preview the uploaded 2kPlayer v0.1.1 local audio player, equalizer, playlists and YouTube search handoff." },
      { property: "og:title", content: "2kPlayer v0.1.1 — interactive preview" },
      { property: "og:description", content: "Try the v0.1.1 local music player with playlists, equalizer and external YouTube search." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <iframe
      src="/uploaded-player-v011/player.html"
      title="2kPlayer v0.1.1 interactive preview"
      className="block h-dvh w-full border-0"
      allow="autoplay"
    />
  ),
});