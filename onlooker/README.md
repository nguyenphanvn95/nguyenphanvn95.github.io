# OnLooker Hosted Build

This folder is prepared for deployment to:

`https://nguyenphanvn95.github.io/onlooker/`

Main entry points:

- `userscript/onlooker.user.js`: Tampermonkey/Userscript loader
- `index.html`: hosted dashboard for settings/import/export
- `content.js`: in-page panel logic reused from the extension build
- `hosted-runtime.js`: userscript/web runtime bridge
- `engine/`: hosted engine iframe files and wasm assets

Suggested GitHub Pages layout:

- publish this `onlooker/` folder at repo root or Pages root
- install the userscript from `/onlooker/userscript/onlooker.user.js`
