export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitteredDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export async function typeWithDelay(
  sendFn: (data: Buffer) => void,
  text: string,
  minMs: number,
  maxMs: number,
): Promise<void> {
  for (const char of text) {
    sendFn(Buffer.from(char, "ascii"));
    await sleep(jitteredDelay(minMs, maxMs));
  }
}
