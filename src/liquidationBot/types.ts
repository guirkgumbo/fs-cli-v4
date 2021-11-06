type Brand<Type, Name> = Type & { readonly __brand: Name };

export type Trader = Brand<string, "trader">;
