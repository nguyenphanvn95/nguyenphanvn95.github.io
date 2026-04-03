# GitHub Pages Auto Deploy

This project already includes:

- `.github/workflows/deploy-pages.yml`
- `build-github-pages.ps1`
- `build-github-pages.bat`

The workflow builds a GitHub Pages package for:

- Base path: `/xiangqi/`
- Output folder: `dist/github-pages/xiangqi`

## Recommended repository

Use a repository named:

- `xiangqi`

under your GitHub account:

- `nguyenphanvn95`

Then your final URL will be:

- `https://nguyenphanvn95.github.io/xiangqi/`

## First-time setup

1. Create a new GitHub repository named `xiangqi`.
2. Copy the whole project into that repository.
3. Make sure these files exist in the repo:
   - `.github/workflows/deploy-pages.yml`
   - `build-github-pages.ps1`
   - the full app source and assets
4. Push to branch `main`.

## Enable GitHub Pages

1. Open the repository on GitHub.
2. Go to `Settings`.
3. Open `Pages`.
4. In `Build and deployment`, choose `GitHub Actions`.

## First deploy

1. Push code to `main`.
2. Open the `Actions` tab.
3. Wait for `Deploy Xiangqi To GitHub Pages` to finish.
4. Open:
   - `https://nguyenphanvn95.github.io/xiangqi/`

## If your default branch is `master`

The workflow already supports both:

- `main`
- `master`

## Local rebuild

If you want to generate the deploy package manually before pushing:

1. Run `build-github-pages.bat`
2. Check:
   - `dist/github-pages/xiangqi`
   - `dist/github-pages/xiangqi-github-pages.zip`

## Important note about API features

GitHub Pages is static hosting only.

That means:

- local proxy features from `local_server.py` are not used on GitHub Pages
- if `api.xiangqi.com` blocks cross-origin requests from `github.io`, cloud database or online analysis features may be limited

The UI, local assets, JS bundles, and WASM paths are already prepared for `/xiangqi/`.
