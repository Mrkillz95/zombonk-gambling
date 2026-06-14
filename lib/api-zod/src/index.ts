export * from "./generated/api";
export * from "./generated/types";
// `getRound` has both a path param and a query param, so orval's zod client emits
// a `GetRoundParams` value while the types client emits a `GetRoundParams` type.
// Re-export the zod schema explicitly to resolve the `export *` ambiguity (TS2308).
export { GetRoundParams } from "./generated/api";
