# Third-party notices

The root MIT license covers the project's own contributions. Third-party components retain their existing terms.

| Component | Location | License and attribution |
| --- | --- | --- |
| Inter | `public/fonts/inter.woff2` | SIL Open Font License 1.1, copyright 2020 The Inter Project Authors. Full notice in `public/fonts/Inter-OFL.txt`. |
| shadcn UI and styling | `components/ui/`, `vendor/shadcn-tailwind-4.13.0.css` | MIT, copyright 2023 shadcn. Full notice in `vendor/shadcn-tailwind-4.13.0.LICENSE.md`. |
| Sites Vite integration | `scripts/vite/sites-vite-plugin.ts` and related starter tooling | The bundled plugin's MIT notice credits OpenAI. Retained in `scripts/vite/sites-vite-plugin.LICENSE`. |
| Lucide icons | Installed `lucide-react` dependency | ISC, copyright 2026 Lucide Icons and Contributors. Full upstream license, including its inherited Feather notice, retained in `vendor/lucide-LICENSE.txt`. |
| React and React DOM | Installed dependencies | MIT. Notices supplied by their packages. |
| Vinext | Installed `vinext` dependency | MIT, copyright Cloudflare, Inc. Full notice retained in `vendor/vinext-LICENSE.txt`. |
| Next.js | Installed `next` dependency | MIT. Notice supplied by the installed package. |
| Other packages | `package-lock.json` | Each package retains its upstream license. Review the package's actual license before redistribution. |

The application began with an OpenAI Sites Vinext starter. Its supporting components and development helpers remain in the repository so the exported app can build and run independently. The original hosted project's identifier, local database, generated build output, and runtime credentials are excluded.

The project-specific illustrations and original audio were created for this game. Their provenance and regeneration information are recorded in [the asset guide](docs/ASSETS.md). The Neko Pixel font uses the project's MIT terms and includes an adjacent copy of that license.

Thirty-One is also known as Scat and Blitz. The implemented house rules are documented in this repository. The traditional rules reference used during development is [Pagat's Thirty-One page](https://www.pagat.com/draw/scat.html).
