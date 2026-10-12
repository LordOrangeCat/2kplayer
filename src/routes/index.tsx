import { createFileRoute } from "@tanstack/react-router";
import { Player } from "@/components/Player";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "2kPlayer — lossless music player" },
      { name: "description", content: "Free, open-source, ad-free player for lossless and hi-res audio on your own computer." },
      { property: "og:title", content: "2kPlayer — lossless music player" },
      { property: "og:description", content: "Free, open-source, ad-free player for lossless and hi-res audio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <main className="min-h-screen px-2 pb-8">
      <Player />
    </main>
  ),
});
