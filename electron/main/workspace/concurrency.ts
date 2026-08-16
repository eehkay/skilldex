/**
 * Tiny bounded-parallelism helper shared by the sync and categorization
 * paths — enough SSH sessions or LLM calls in flight to be quick, not enough
 * to hammer a machine or a provider.
 */

/** Map with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
