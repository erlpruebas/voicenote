export function estimateGeminiTranscriptionCostUsd(durationSeconds: number, outputText: string): number {
  const audioInputTokens = Math.max(0, durationSeconds) * 32;
  const outputTokens = Math.ceil(outputText.length / 4);
  const inputCost = audioInputTokens * (1 / 1_000_000);
  const outputCost = outputTokens * (2.5 / 1_000_000);
  return inputCost + outputCost;
}

export function formatUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
