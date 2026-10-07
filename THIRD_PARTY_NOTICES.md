# Third-party notices

The committed bundles `hooks/vendor/mermaid.js` and `renderer/svg.mjs` are
built by `npm run build` from these packages, unmodified:

| Package | Version | License | Bundled in | Source |
| --- | --- | --- | --- | --- |
| beautiful-mermaid | 1.1.3 | MIT | both | https://www.npmjs.com/package/beautiful-mermaid |
| elkjs | see package-lock.json | EPL-2.0 | `renderer/svg.mjs` | https://github.com/kieler/elkjs |
| entities | see package-lock.json | BSD-2-Clause | both | https://github.com/fb55/entities |

elkjs is distributed under the Eclipse Public License 2.0
(https://www.eclipse.org/legal/epl-2.0/); its source code is available at the
link above. The full license texts ship with each package in `node_modules`
after `npm ci`.
