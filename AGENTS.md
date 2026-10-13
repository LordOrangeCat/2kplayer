<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Uploaded standalone player reviews are isolated inside a TanStack preview route with static browser source, so their styles and local library do not replace the existing player.
- Additional uploaded versions use version-specific preview routes, storage names and window-command channels so testing one version cannot modify another version's library or playback.
- Uploaded review previews must omit app-shell service-worker registration and installation metadata, so inspecting an archive cannot cache or take over the Lovable preview.
