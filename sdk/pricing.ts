interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

const PRICING: Record<string, ModelPrice> = {
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4.1": { inputPerM: 2.0, outputPerM: 8 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "o3-mini": { inputPerM: 1.1, outputPerM: 4.4 },
  "claude-sonnet-4": { inputPerM: 3, outputPerM: 15 },
  "claude-haiku-4": { inputPerM: 0.8, outputPerM: 4 },
  "deepseek-chat": { inputPerM: 0.27, outputPerM: 1.1 },
  "deepseek-reasoner": { inputPerM: 0.55, outputPerM: 2.19 },
};

function priceFor(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  if (PRICING[model]) return PRICING[model];
  let best: { key: string; price: ModelPrice } | undefined;
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best?.price;
}

export function costForUsage(
  model: string | undefined,
  promptTokens = 0,
  completionTokens = 0,
): number {
  const price = priceFor(model);
  if (!price) return 0;
  const cost =
    (promptTokens / 1_000_000) * price.inputPerM +
    (completionTokens / 1_000_000) * price.outputPerM;
  return Math.round(cost * 1e6) / 1e6;
}

export function isModelPriced(model: string | undefined): boolean {
  return priceFor(model) !== undefined;
}
