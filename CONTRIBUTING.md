# Contributing

Thank you for improving sidekick.

1. Use Node.js 20 or newer (`nvm use` selects the recommended version).
2. Install exactly the locked dependencies with `npm ci`.
3. Create a focused branch and include tests with behavior changes.
4. Run `npm run prepack`, which builds, tests, lints, and typechecks.
5. Use a conventional commit subject such as `fix: preserve Windows command paths`.

Keep runtime code dependency-free and cross-platform. Use `node:` APIs, path helpers, argv arrays, and filesystem events. Do not introduce shell command interpolation or assume `/proc`, Unix signals, or a `tail` executable. Tests that require engines must use `mock`.

Open an issue before a large architecture change. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
