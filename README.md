# vitest-clack

Vitest fixtures for testing CLIs built with
[`@clack/prompts`](https://github.com/bombshell-dev/clack). Drive prompts from a
fake terminal and assert on what your CLI asked, printed and received:

```ts
import { it as base, expect } from "vitest"
import { withClack } from "vitest-clack"

const it = withClack(base)

it("creates a project", async ({ terminal }) => {
  const { main } = await import("../lib/cli.ts")
  const done = main()

  await terminal.type("my-app")
  await terminal.press("enter")
  await done

  expect(terminal.steps()).toEqual([
    { type: "intro", message: "create-app" },
    { type: "text", message: "Project name?", state: "done", value: "my-app" },
    { type: "outro", message: "Created my-app" },
  ])
})
```

**See the [package README](./packages/vitest-clack/README.md) for installation,
usage and the API.**

## Repository

| Path                                               | Contents                       |
| -------------------------------------------------- | ------------------------------ |
| [`packages/vitest-clack`](./packages/vitest-clack) | The package, published to npm  |
| [`.github/workflows`](./.github/workflows)         | CI, releases and workflow lint |

The tooling configs (TypeScript, oxlint, oxfmt) extend
[`@smashercosmo/configs`](https://github.com/smashercosmo/configs). The
workflows call the reusable ones of
[`smashercosmo/actions`](https://github.com/smashercosmo/actions), pinned to the
commit of a release.

## Development

Install [pnpm](https://pnpm.io), in the version of `packageManager` in
`package.json`. pnpm downloads the Node.js of `devEngines.runtime` itself.

```sh
pnpm install
pnpm build    # dist/ with tsdown
pnpm test     # the Vitest suite
pnpm lint     # oxlint and type checks
pnpm format   # oxfmt
```

The package's source is in `lib/`, its tests in `tests/`. Within the package,
`#lib/*.js` and `#tests/*.js` import its own files (see `imports` in its
`package.json`). In the workspace, `vitest-clack` resolves to the TypeScript
source; the published package points to `dist/` instead (`publishConfig`).

Type checking runs on TypeScript 7 (`@typescript/native`). The `typescript`
package is TypeScript 6 because tsdown generates the declarations with its
JavaScript API, which TypeScript 7 doesn't have.

## Releasing

Releases are made from change intents, with pnpm's own versioning. Every pull
request has to add one, which CI checks:

```sh
pnpm change              # describe the change and its version bump
pnpm change --bump none  # for a change that doesn't need a release
```

On every push to `main`, the [release workflow](./.github/workflows/release.yml)
opens or updates a release PR, which applies the pending intents: it bumps the
version and writes `CHANGELOG.md`. Merging the release PR runs CI on the merge
commit and stages the new version on npm. Approve it with `pnpm stage approve`
(it asks for 2FA): once it's on npm, the workflow publishes its GitHub release,
which creates the `v<version>` tag.

### First release

The workflow can't publish a package that isn't on npm yet: pnpm releases an
unpublished version as it is, and the release PR refuses to release a version
that isn't on npm, so a first intent would fail it. npm's trusted publishing
also needs the package to exist. So publish the first version by hand, before
adding any change intent:

```sh
pnpm build
pnpm --filter vitest-clack publish
```

Then set up trusted publishing (below). The next run of the release workflow
creates the GitHub release of that version.

### Setup

The release workflow needs:

- A GitHub App installed on the repository, with `contents` and `pull-requests`
  write permissions. It opens the release PRs, so that CI runs for them.
- A repository variable `RELEASE_BOT_CLIENT_ID` with the App's client ID. It has
  to be a repository (or organization) variable, not one of the environment.
- An environment named `release`, with a secret `RELEASE_BOT_PRIVATE_KEY`: the
  App's private key.
- A trusted publisher for `vitest-clack` on npm: GitHub Actions, this
  repository, the workflow `release.yml` and the environment `release`.
- A ruleset for `main` that requires the `ci / changeset` and `ci / check`
  status checks and branches to be up to date before merging. Otherwise a
  release PR could be merged without the intents added since it was opened.

## License

[MIT](./LICENSE) © Vladislav Shkodin
