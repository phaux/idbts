# idbts

Strongly-typed IndexedDB with expressive queries and live updates.

This project is a monorepo. It contains the following packages:

| package                                | description                                      |
| -------------------------------------- | ------------------------------------------------ |
| [idbts](./idbts/README.md)             | Core library — Database, mutations, live queries |
| [idbts-react](./idbts-react/README.md) | React adapter — `useDBQuery` hook                |

## Developing

Run any of these in the project root or individual package directories:

- `npm run format` – Format code with Prettier.
- `npm run check` – Run type checks with TypeScript noEmit mode.
- `npm run lint` – Lint code with ESLint.
- `npm test` – Run tests and generate coverage report with Node test runner.
- `npm run prepare` – Build all packages using TypeScript compiler.
