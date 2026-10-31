# Contributing

## Branches

Branch from `main` using a prefix:

- `feature/<short-name>` new functionality
- `fix/<short-name>` bug fixes
- `docs/<short-name>` documentation only
- `research/<short-name>` papers, model and data notes

## Pull requests

- Keep PRs small and focused.
- At least one review is required before merge.
- Fill in the PR template.

## Major decisions

Anything that shapes the project (tech stack, physics model, data sources, licensing) needs an Architecture Decision Record. Copy [`docs/adr/0000-template.md`](docs/adr/0000-template.md), number it, open it as a PR with status "Proposed", and discuss. It is only "Accepted" with team sign-off.

## Data

Check the license and terms of every data source **before** adding it. Record the source, version and license in [`data/README.md`](data/README.md). Never commit large data files.

## Claims

Describe the project as "physically grounded and validated against real historical fires", not as "exact" prediction.
