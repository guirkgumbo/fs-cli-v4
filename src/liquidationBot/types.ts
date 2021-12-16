type Brand<Type, Name> = Type & { readonly __brand: Name };

export type Trader = Brand<string, "trader">;

export enum TraderAction {
  OpenPosition,
  ClosePosition,
}

export type LastTraderActions = {
  [key: Trader]: TraderAction;
};
