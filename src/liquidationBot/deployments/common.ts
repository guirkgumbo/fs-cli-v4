import type { TypedEvent, TypedEventFilter } from "@generated/commons";

export type GetTypedEventTypeFromFilter<Filter extends (...args: any) => any> =
  ReturnType<Filter> extends TypedEventFilter<infer ArgsArray, infer ArgsObject>
    ? ArgsArray extends Array<any>
      ? TypedEvent<ArgsArray & ArgsObject>
      : never
    : never;
